// Định dạng file đồng bộ trên Drive (thư mục ẩn appDataFolder). Không phụ thuộc Electron hay giao diện,
// để bản mobile sau này đọc được. Mỗi note, folder, reminder là một file JSON riêng, có số phiên bản định dạng.

export const REMOTE_FORMAT_VERSION = 1

export type SyncKind = 'note' | 'folder' | 'reminder' | 'calendar' | 'event'
export const SYNC_KINDS: SyncKind[] = ['note', 'folder', 'reminder', 'calendar', 'event']

/** Phần chung của mọi thực thể đồng bộ được (Note, Folder, Reminder đều có các trường này). */
export interface SyncEntity {
  id: string
  updatedAt: number
  deletedAt: number | null
}

/** Các trường còn lại của thực thể, đọc không cần biết kiểu cụ thể. */
export const fieldsOf = (e: SyncEntity): Record<string, unknown> => e as unknown as Record<string, unknown>

export interface SyncRecord {
  format: number
  kind: SyncKind
  id: string
  updatedAt: number
  deletedAt: number | null
  data: SyncEntity
}

export const keyOf = (kind: SyncKind, id: string): string => `${kind}:${id}`
export const remoteNameOf = (kind: SyncKind, id: string): string => `${kind}-${id}.json`

export function parseRemoteName(name: string): { kind: SyncKind; id: string } | null {
  const m = /^(note|folder|reminder|calendar|event)-(.+)\.json$/.exec(name)
  return m ? { kind: m[1] as SyncKind, id: m[2] } : null
}

/**
 * Mã hóa một thực thể thành nội dung file. Mốc nhắc của từng máy (firedAt, snoozeUntil) không đồng bộ:
 * mỗi máy tự nhắc và tự hoãn, nên không để máy này làm im thông báo của máy kia.
 */
export function encodeRecord(kind: SyncKind, entity: SyncEntity): string {
  const data: SyncEntity = kind === 'reminder' ? ({ ...fieldsOf(entity), firedAt: null, snoozeUntil: null } as unknown as SyncEntity) : entity
  const rec: SyncRecord = {
    format: REMOTE_FORMAT_VERSION,
    kind,
    id: entity.id,
    updatedAt: entity.updatedAt,
    deletedAt: entity.deletedAt ?? null,
    data
  }
  return JSON.stringify(rec)
}

export type DecodeResult = { ok: true; record: SyncRecord } | { ok: false; reason: 'newer' | 'invalid' }

export function decodeRecord(text: string): DecodeResult {
  try {
    const r = JSON.parse(text)
    if (!r || typeof r !== 'object' || typeof r.format !== 'number') return { ok: false, reason: 'invalid' }
    // File do bản app mới hơn ghi: không đọc, không ghi đè, để người dùng cập nhật app.
    if (r.format > REMOTE_FORMAT_VERSION) return { ok: false, reason: 'newer' }
    if (!SYNC_KINDS.includes(r.kind) || typeof r.id !== 'string' || !r.data || typeof r.data.id !== 'string') {
      return { ok: false, reason: 'invalid' }
    }
    if (typeof r.data.updatedAt !== 'number') return { ok: false, reason: 'invalid' }
    return { ok: true, record: r as SyncRecord }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
