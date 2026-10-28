import { randomUUID } from 'node:crypto'
import { RemoteNotFoundError, type RemoteChanges, type RemoteFile, type RemoteStore } from '@core/sync/engine'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const RETRY_DELAYS = [500, 1500, 3500]

/** Kho từ xa là thư mục ẩn appDataFolder trên Google Drive của người dùng (chỉ app này thấy). */
export class DriveAppDataRemote implements RemoteStore {
  /** `getToken(force)`: trả access token; force = true buộc làm mới (khi bị 401). */
  constructor(private getToken: (force: boolean) => Promise<string>) {}

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let force = false
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken(force)
      const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } })
      if (res.ok) return res
      if (res.status === 401 && !force) {
        force = true
        continue
      }
      if (res.status === 404) throw new RemoteNotFoundError()
      const retryable = res.status === 429 || res.status >= 500
      if (retryable && attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]))
        continue
      }
      const detail = await res.text().catch(() => '')
      throw new Error(`Google Drive lỗi ${res.status}: ${detail.slice(0, 200)}`)
    }
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(url, init)).json()) as T
  }

  async listChanges(token: string | null): Promise<RemoteChanges> {
    if (token === null) {
      // Lấy mốc thay đổi TRƯỚC khi liệt kê để không sót thay đổi xảy ra giữa chừng.
      const start = await this.json<{ startPageToken: string }>(`${API}/changes/startPageToken`)
      const files: RemoteFile[] = []
      let page: string | undefined
      do {
        const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,name)' })
        if (page) q.set('pageToken', page)
        const r = await this.json<{ files?: RemoteFile[]; nextPageToken?: string }>(`${API}/files?${q}`)
        files.push(...(r.files ?? []))
        page = r.nextPageToken
      } while (page)
      return { files, removed: [], nextToken: start.startPageToken }
    }

    const latest = new Map<string, { removed: boolean; file?: RemoteFile }>()
    let page = token
    let next = token
    for (;;) {
      const q = new URLSearchParams({
        pageToken: page,
        spaces: 'appDataFolder',
        pageSize: '1000',
        includeRemoved: 'true',
        fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,trashed))'
      })
      const r = await this.json<{
        nextPageToken?: string
        newStartPageToken?: string
        changes?: { fileId: string; removed?: boolean; file?: { id: string; name: string; trashed?: boolean } }[]
      }>(`${API}/changes?${q}`)
      for (const c of r.changes ?? []) {
        const gone = !!c.removed || !!c.file?.trashed
        latest.set(c.fileId, { removed: gone, file: c.file ? { id: c.file.id, name: c.file.name } : undefined })
      }
      if (r.nextPageToken) page = r.nextPageToken
      else {
        next = r.newStartPageToken ?? page
        break
      }
    }
    const files: RemoteFile[] = []
    const removed: string[] = []
    for (const [id, c] of latest) {
      if (c.removed) removed.push(id)
      else if (c.file) files.push(c.file)
    }
    return { files, removed, nextToken: next }
  }

  async read(fileId: string): Promise<string> {
    return (await this.request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).text()
  }

  async create(name: string, content: string): Promise<RemoteFile> {
    const boundary = `ntp-${randomUUID()}`
    const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' })
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`
    const f = await this.json<RemoteFile>(`${UPLOAD}/files?uploadType=multipart&fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    })
    return { id: f.id, name: f.name }
  }

  async update(fileId: string, content: string): Promise<void> {
    await this.request(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: content
    })
  }

  async remove(fileId: string): Promise<void> {
    await this.request(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' })
  }
}
