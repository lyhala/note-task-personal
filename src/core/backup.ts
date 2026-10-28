// Xuất / nhập toàn bộ dữ liệu ra một file JSON. Không phụ thuộc Electron.
// Chỉ gồm dữ liệu của chính người dùng: note, folder, reminder, lịch trong app và sự kiện của chúng.
// Không gồm lịch Google/iCal (chỉ là bản đệm), token hay link iCal bí mật.

import type { CalEvent, CalendarSource } from './calendar'
import { FORMAT_VERSION, type Folder, type Note, type Reminder, type Settings } from './types'

export const BACKUP_APP = 'note-task-personal'

export interface BackupData {
  app: typeof BACKUP_APP
  format: number
  exportedAt: number
  notes: Note[]
  folders: Folder[]
  reminders: Reminder[]
  calendars: CalendarSource[]
  events: CalEvent[]
  settings: Settings
}

export interface BackupSource {
  notes: Note[]
  folders: Folder[]
  reminders: Reminder[]
  calendars: CalendarSource[]
  events: CalEvent[]
  settings: Settings
}

export function buildBackup(src: BackupSource, now = Date.now()): BackupData {
  const localCals = src.calendars.filter((c) => c.kind === 'local' && !c.deletedAt)
  const ids = new Set(localCals.map((c) => c.id))
  return {
    app: BACKUP_APP,
    format: FORMAT_VERSION,
    exportedAt: now,
    notes: src.notes.filter((n) => !n.deletedAt),
    folders: src.folders.filter((f) => !f.deletedAt),
    reminders: src.reminders.filter((r) => !r.deletedAt),
    calendars: localCals,
    events: src.events.filter((e) => !e.deletedAt && ids.has(e.calendarId)),
    settings: src.settings
  }
}

export class BackupError extends Error {}

/** Đọc và kiểm tra file nhập; ném BackupError với lời giải thích dễ hiểu nếu file không đúng. */
export function parseBackup(text: string): BackupData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('File không phải JSON hợp lệ')
  }
  const b = raw as Partial<BackupData> | null
  if (!b || b.app !== BACKUP_APP) throw new BackupError('Đây không phải file sao lưu của app này')
  if (typeof b.format !== 'number' || b.format > FORMAT_VERSION) throw new BackupError('File sao lưu từ phiên bản app mới hơn, hãy cập nhật app trước')
  const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])
  return {
    app: BACKUP_APP,
    format: b.format,
    exportedAt: b.exportedAt ?? 0,
    notes: list<Note>(b.notes).filter((n) => n && typeof n.id === 'string'),
    folders: list<Folder>(b.folders).filter((f) => f && typeof f.id === 'string'),
    reminders: list<Reminder>(b.reminders).filter((r) => r && typeof r.id === 'string'),
    calendars: list<CalendarSource>(b.calendars).filter((c) => c && typeof c.id === 'string'),
    events: list<CalEvent>(b.events).filter((e) => e && typeof e.id === 'string'),
    settings: b.settings as Settings
  }
}

export interface ImportPlan {
  notes: Note[]
  folders: Folder[]
  reminders: Reminder[]
  calendars: CalendarSource[]
  events: CalEvent[]
}

/**
 * Gộp (không ghi đè mù): mục chưa có thì thêm; mục đã có thì chỉ lấy bản trong file khi mới hơn.
 * Mục đã bị xóa trên máy này (trong thùng rác) mà có trong file thì được khôi phục nếu file mới hơn.
 */
export function planImport(
  data: BackupData,
  current: { notes: Note[]; folders: Folder[]; reminders: Reminder[]; calendars: CalendarSource[]; events: CalEvent[] }
): ImportPlan {
  const pick = <T extends { id: string; updatedAt: number }>(incoming: T[], have: T[]): T[] => {
    const byId = new Map(have.map((x) => [x.id, x]))
    return incoming.filter((x) => {
      const cur = byId.get(x.id)
      return !cur || x.updatedAt > cur.updatedAt
    })
  }
  return {
    notes: pick(data.notes, current.notes),
    folders: pick(data.folders, current.folders),
    reminders: pick(data.reminders, current.reminders),
    calendars: pick(data.calendars, current.calendars),
    events: pick(data.events, current.events)
  }
}
