// Engine đồng bộ giữa dữ liệu trên máy và kho từ xa (Google Drive appDataFolder). Không phụ thuộc Electron.
// Quy tắc xung đột (theo spec):
// - Trường đơn giản (hạn, tick xong...) và mọi thay đổi của folder, reminder: bản sửa sau cùng thắng.
// - Nội dung note (tiêu đề, chữ, nét vẽ): nếu hai máy cùng sửa thì giữ cả hai, bản trên máy này thành
//   một note riêng đánh dấu `conflictOf` để người dùng chọn.
// - Xóa là đánh dấu deletedAt (để máy khác biết); dọn hẳn sau TRASH_DAYS ngày.

import { TRASH_DAYS, newId as defaultNewId } from '../types'
import {
  SYNC_KINDS,
  decodeRecord,
  encodeRecord,
  fieldsOf,
  keyOf,
  parseRemoteName,
  remoteNameOf,
  type SyncEntity,
  type SyncKind
} from './format'

export interface RemoteFile {
  /** Mã file do kho từ xa cấp (Drive file id). */
  id: string
  name: string
}

export interface RemoteChanges {
  /** File mới hoặc đã đổi kể từ token (hoặc toàn bộ file nếu token = null). */
  files: RemoteFile[]
  /** Mã các file đã bị xóa khỏi kho từ xa. */
  removed: string[]
  /** Token để lần sau chỉ lấy thay đổi mới. */
  nextToken: string
}

/** Kho từ xa. Triển khai thật dùng Drive API; bản thử dùng bộ nhớ. */
export interface RemoteStore {
  listChanges(token: string | null): Promise<RemoteChanges>
  read(fileId: string): Promise<string>
  create(name: string, content: string): Promise<RemoteFile>
  /** Ném RemoteNotFoundError nếu file không còn. */
  update(fileId: string, content: string): Promise<void>
  remove(fileId: string): Promise<void>
}

export class RemoteNotFoundError extends Error {
  constructor(message = 'Không tìm thấy file trên kho từ xa') {
    super(message)
    this.name = 'RemoteNotFoundError'
  }
}

/** Truy cập dữ liệu trên máy. */
export interface SyncLocal {
  listAll(): Promise<Record<SyncKind, SyncEntity[]>>
  /** Ghi (thêm hoặc thay) một thực thể đúng như đã cho, không đổi updatedAt. */
  put(kind: SyncKind, entity: SyncEntity): Promise<void>
  /** Xóa hẳn khỏi máy (đã quá hạn thùng rác). */
  purge(kind: SyncKind, id: string): Promise<void>
}

export interface SyncState {
  /** Token thay đổi của kho từ xa; null = chưa đồng bộ lần nào. */
  token: string | null
  /** Theo "loại:id": file trên kho từ xa và updatedAt đã khớp ở lần đồng bộ gần nhất. */
  items: Record<string, { fileId: string; synced: number }>
}

export interface SyncStateStore {
  load(): Promise<SyncState>
  save(state: SyncState): Promise<void>
}

export interface SyncResult {
  pulled: number
  pushed: number
  conflicts: number
  purged: number
  /** File do bản app mới hơn ghi, bị bỏ qua. */
  skippedNewer: number
}

export const EMPTY_STATE: SyncState = { token: null, items: {} }

const DAY = 86_400_000

interface Deps {
  local: SyncLocal
  remote: RemoteStore
  state: SyncStateStore
  now?: () => number
  newId?: () => string
}

/** Áp bản từ xa lên máy này. Mốc nhắc của reminder là của riêng từng máy nên giữ nguyên bản trên máy. */
function applyRemote(kind: SyncKind, remote: SyncEntity, local: SyncEntity | undefined, now: number): SyncEntity {
  if (kind !== 'reminder') return remote
  // Reminder mới nhận về lần đầu coi như đã nhắc rồi, để máy mới không dồn một loạt thông báo "đã lỡ".
  const own = local ? fieldsOf(local) : null
  return { ...fieldsOf(remote), firedAt: own ? (own.firedAt ?? null) : now, snoozeUntil: own ? (own.snoozeUntil ?? null) : null } as unknown as SyncEntity
}

function noteContentDiffers(a: SyncEntity, b: SyncEntity): boolean {
  const x = fieldsOf(a)
  const y = fieldsOf(b)
  return x.title !== y.title || x.body !== y.body || JSON.stringify(x.strokes ?? []) !== JSON.stringify(y.strokes ?? [])
}

export async function runSync(deps: Deps): Promise<SyncResult> {
  const { local, remote, state: store } = deps
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? defaultNewId
  const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, purged: 0, skippedNewer: 0 }

  const state = await store.load()
  const all = await local.listAll()
  const entities = new Map<string, { kind: SyncKind; e: SyncEntity }>()
  for (const kind of SYNC_KINDS) for (const e of all[kind] ?? []) entities.set(keyOf(kind, e.id), { kind, e })

  const changes = await remote.listChanges(state.token)

  // File đã bị xóa phía từ xa: bỏ liên kết, bản trên máy sẽ được đẩy lên lại nếu còn.
  const keyByFile = new Map(Object.entries(state.items).map(([k, v]) => [v.fileId, k]))
  for (const fid of changes.removed) {
    const k = keyByFile.get(fid)
    if (k) delete state.items[k]
  }

  try {
    // 1. Kéo thay đổi từ xa về
    for (const file of changes.files) {
      const parsed = parseRemoteName(file.name)
      if (!parsed) continue
      const { kind } = parsed
      const key = keyOf(kind, parsed.id)
      const decoded = decodeRecord(await remote.read(file.id))
      if (!decoded.ok) {
        if (decoded.reason === 'newer') result.skippedNewer++
        continue
      }
      const R = decoded.record.data
      const cur = entities.get(key)
      const L = cur?.e
      const s = state.items[key]

      if (!L) {
        const applied = applyRemote(kind, R, undefined, now())
        await local.put(kind, applied)
        entities.set(key, { kind, e: applied })
        state.items[key] = { fileId: file.id, synced: R.updatedAt }
        result.pulled++
        continue
      }
      if (L.updatedAt === R.updatedAt) {
        state.items[key] = { fileId: file.id, synced: R.updatedAt }
        continue
      }

      const localChanged = !s || L.updatedAt !== s.synced
      const remoteChanged = !s || R.updatedAt !== s.synced

      const takeRemote = async (): Promise<void> => {
        const applied = applyRemote(kind, R, L, now())
        await local.put(kind, applied)
        entities.set(key, { kind, e: applied })
        state.items[key] = { fileId: file.id, synced: R.updatedAt }
        result.pulled++
      }

      if (localChanged && !remoteChanged) {
        // Chỉ máy này sửa: giữ nguyên, bước đẩy phía dưới sẽ cập nhật lên từ xa.
        state.items[key] = { fileId: file.id, synced: s!.synced }
      } else if (!localChanged && remoteChanged) {
        await takeRemote()
      } else if (kind === 'note' && !L.deletedAt && !R.deletedAt && noteContentDiffers(L, R)) {
        // Hai máy cùng sửa nội dung: giữ cả hai. Bản trên máy này thành một note riêng, bản từ xa vào note gốc.
        const t = now()
        const copy = {
          ...fieldsOf(L),
          id: newId(),
          title: `${String(fieldsOf(L).title ?? '').trim() || 'Không có tiêu đề'} (bản trên máy này)`,
          conflictOf: L.id,
          pinnedAt: null,
          createdAt: t,
          updatedAt: t
        } as unknown as SyncEntity
        await local.put('note', copy)
        entities.set(keyOf('note', copy.id), { kind: 'note', e: copy })
        await takeRemote()
        result.conflicts++
      } else if (R.updatedAt >= L.updatedAt) {
        await takeRemote()
      } else {
        // Bản trên máy này mới hơn: ghi nhận file từ xa, bước đẩy sẽ ghi đè lên.
        state.items[key] = { fileId: file.id, synced: R.updatedAt }
      }
    }

    // 2. Đẩy thay đổi của máy này lên, dọn những mục đã quá hạn thùng rác
    for (const [key, { kind, e }] of entities) {
      const s = state.items[key]
      if (e.deletedAt && e.deletedAt < now() - TRASH_DAYS * DAY) {
        if (s) {
          try {
            await remote.remove(s.fileId)
          } catch (err) {
            if (!(err instanceof RemoteNotFoundError)) throw err
          }
          delete state.items[key]
        }
        await local.purge(kind, e.id)
        result.purged++
        continue
      }
      if (s && s.synced === e.updatedAt) continue

      const content = encodeRecord(kind, e)
      let fileId: string | undefined = s?.fileId
      if (fileId) {
        try {
          await remote.update(fileId, content)
        } catch (err) {
          if (!(err instanceof RemoteNotFoundError)) throw err
          fileId = undefined
        }
      }
      if (!fileId) fileId = (await remote.create(remoteNameOf(kind, e.id), content)).id
      state.items[key] = { fileId, synced: e.updatedAt }
      result.pushed++
    }

    state.token = changes.nextToken
  } finally {
    // Lưu cả khi lỗi giữa chừng để không đẩy trùng; token chỉ tiến lên khi cả lượt thành công.
    await store.save(state)
  }
  return result
}
