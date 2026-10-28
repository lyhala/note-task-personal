import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { newId, type Attachment } from '@core/types'
import { getAccessToken, getAccount } from './google-auth'

/** File lớn hơn mức này không lưu trong app: dán link Google Drive thay vào. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

const dir = (): string => {
  const d = join(app.getPath('userData'), 'attachments')
  mkdirSync(d, { recursive: true })
  return d
}
const localPath = (a: Attachment): string => join(dir(), a.id)
const remoteName = (a: Attachment): string => `att-${a.id}.bin`

export type PickResult = { ok: true; items: Attachment[]; warning?: string } | { ok: false; error: string }

const signedIn = (): boolean => {
  const a = getAccount('sync')
  return !!a && !a.expired
}

async function drive(url: string, init: RequestInit = {}): Promise<Response> {
  let force = false
  for (;;) {
    const token = await getAccessToken('sync', force)
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } })
    if (res.status === 401 && !force) {
      force = true
      continue
    }
    if (!res.ok) throw new Error(`Google Drive lỗi ${res.status}`)
    return res
  }
}

async function findRemote(name: string): Promise<string | null> {
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${name}'`, fields: 'files(id)' })
  const r = (await (await drive(`${API}/files?${q}`)).json()) as { files?: { id: string }[] }
  return r.files?.[0]?.id ?? null
}

async function upload(a: Attachment, data: Buffer): Promise<void> {
  const boundary = `ntp-${randomUUID()}`
  const meta = JSON.stringify({ name: remoteName(a), parents: ['appDataFolder'] })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`)
  ])
  await drive(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
}

/** Chọn file từ máy, chép vào thư mục dữ liệu của app và (nếu đã đăng nhập Google) đẩy lên thư mục ẩn trên Drive. */
export async function pickAndAdd(win: BrowserWindow | null): Promise<PickResult> {
  const r = win ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }) : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
  if (r.canceled || !r.filePaths.length) return { ok: true, items: [] }
  const items: Attachment[] = []
  let offline = false
  for (const p of r.filePaths) {
    const { size } = await stat(p)
    if (size > MAX_FILE_BYTES) {
      return { ok: false, error: `"${basename(p)}" lớn hơn ${MAX_FILE_BYTES / 1024 / 1024} MB. File lớn hãy tải lên Google Drive rồi dán link vào mục "Thêm link".` }
    }
    const att: Attachment = { id: newId(), name: basename(p), size, kind: 'file' }
    await copyFile(p, localPath(att))
    if (signedIn()) {
      try {
        await upload(att, await readFile(localPath(att)))
      } catch {
        offline = true
      }
    } else offline = true
    items.push(att)
  }
  return { ok: true, items, warning: offline ? 'File mới chỉ lưu trên máy này (chưa đăng nhập Google hoặc không có mạng), máy khác sẽ chưa mở được.' : undefined }
}

/** Mở file bằng chương trình mặc định; nếu máy này chưa có thì tải về từ Drive trước. */
export async function openAttachment(a: Attachment): Promise<{ ok: boolean; error?: string }> {
  if (a.kind === 'link') {
    if (a.url && /^https?:\/\//i.test(a.url)) await shell.openExternal(a.url)
    return { ok: true }
  }
  const p = localPath(a)
  if (!existsSync(p)) {
    if (!signedIn()) return { ok: false, error: 'File này chưa có trên máy. Đăng nhập Google để tải về.' }
    try {
      const id = await findRemote(remoteName(a))
      if (!id) return { ok: false, error: 'Không tìm thấy file trên Drive (máy gốc chưa kịp tải lên).' }
      const res = await drive(`${API}/files/${encodeURIComponent(id)}?alt=media`)
      await writeFile(p, Buffer.from(await res.arrayBuffer()))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Không tải được file' }
    }
  }
  // Giữ tên gốc để chương trình mở đúng loại file: chép ra thư mục tạm kèm đuôi.
  const tmp = join(app.getPath('temp'), `ntp-${a.id}-${a.name}`)
  await copyFile(p, tmp)
  const err = await shell.openPath(tmp)
  return err ? { ok: false, error: err } : { ok: true }
}

/** Xóa file khỏi máy và khỏi Drive (khi gỡ khỏi reminder). */
export async function discardAttachment(a: Attachment): Promise<void> {
  if (a.kind !== 'file') return
  await unlink(localPath(a)).catch(() => undefined)
  if (!signedIn()) return
  try {
    const id = await findRemote(remoteName(a))
    if (id) await drive(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    /* không xóa được trên Drive thì để đó, không ảnh hưởng dữ liệu */
  }
}
