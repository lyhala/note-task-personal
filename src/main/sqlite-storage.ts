import type { DatabaseSync } from 'node:sqlite'
import type { CalEvent, CalendarSource } from '@core/calendar'
import type { Storage } from '@core/storage'
import type { SyncLocal, SyncState, SyncStateStore } from '@core/sync/engine'
import type { SyncEntity, SyncKind } from '@core/sync/format'
import { DEFAULT_SETTINGS, type AppNotification, type Folder, type Note, type Reminder, type Settings } from '@core/types'

// node:sqlite có sẵn trong Node của Electron, không cần build native.
const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')

export class SqliteStorage implements Storage {
  private db: DatabaseSync

  constructor(file: string) {
    this.db = new Database(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted_at INTEGER);
      CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted_at INTEGER);
      CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted_at INTEGER);
      CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS calendars (id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted_at INTEGER);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted_at INTEGER, cal TEXT NOT NULL, start_ms INTEGER, end_ms INTEGER);
      CREATE INDEX IF NOT EXISTS events_cal ON events (cal);
      CREATE TABLE IF NOT EXISTS event_alerts (k TEXT PRIMARY KEY, at INTEGER NOT NULL);
    `)
  }

  async listNotes(): Promise<Note[]> {
    // Note cũ (giai đoạn 1) chưa có strokes.
    return this.db.prepare('SELECT data FROM notes WHERE deleted_at IS NULL OR deleted_at > 1').all().map((r) => ({ strokes: [], ...JSON.parse(r.data as string) }))
  }

  async saveNote(n: Note): Promise<void> {
    this.db
      .prepare('INSERT INTO notes (id, data, deleted_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted_at = excluded.deleted_at')
      .run(n.id, JSON.stringify(n), n.deletedAt)
  }

  async listFolders(): Promise<Folder[]> {
    return this.db.prepare('SELECT data FROM folders').all().map((r) => JSON.parse(r.data as string))
  }

  async saveFolder(f: Folder): Promise<void> {
    this.db
      .prepare('INSERT INTO folders (id, data, deleted_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted_at = excluded.deleted_at')
      .run(f.id, JSON.stringify(f), f.deletedAt)
  }

  async getSettings(): Promise<Settings> {
    const row = this.db.prepare("SELECT data FROM settings WHERE k = 'main'").get()
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.data as string) : {}) }
  }

  async saveSettings(s: Settings): Promise<void> {
    this.db
      .prepare("INSERT INTO settings (k, data) VALUES ('main', ?) ON CONFLICT(k) DO UPDATE SET data = excluded.data")
      .run(JSON.stringify(s))
  }

  async purgeTrash(before: number): Promise<number> {
    const n = this.db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(before)
    const r = this.db.prepare('DELETE FROM reminders WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(before)
    this.db.prepare('DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(before)
    this.db.prepare('DELETE FROM events WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(before)
    this.db.prepare('DELETE FROM calendars WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(before)
    this.db.prepare('DELETE FROM event_alerts WHERE at < ?').run(before)
    this.db.prepare('DELETE FROM notifications WHERE at < ?').run(before)
    return Number(n.changes) + Number(r.changes)
  }

  async deleteNoteForever(id: string): Promise<void> {
    // Không xóa dòng ngay: giữ một dấu "đã dọn" (deletedAt = 1) để lần đồng bộ tới xóa nốt trên Drive và các máy khác.
    const row = this.db.prepare('SELECT data FROM notes WHERE id = ? AND deleted_at IS NOT NULL').get(id)
    if (!row) return
    const n = { ...JSON.parse(row.data as string), deletedAt: 1 }
    this.db.prepare('UPDATE notes SET data = ?, deleted_at = 1 WHERE id = ?').run(JSON.stringify(n), id)
  }

  async listReminders(): Promise<Reminder[]> {
    return this.db.prepare('SELECT data FROM reminders').all().map((r) => JSON.parse(r.data as string))
  }

  async saveReminder(r: Reminder): Promise<void> {
    this.db
      .prepare('INSERT INTO reminders (id, data, deleted_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted_at = excluded.deleted_at')
      .run(r.id, JSON.stringify(r), r.deletedAt)
  }

  async listNotifications(): Promise<AppNotification[]> {
    return this.db.prepare('SELECT data FROM notifications ORDER BY at DESC LIMIT 200').all().map((r) => JSON.parse(r.data as string))
  }

  async saveNotification(n: AppNotification): Promise<void> {
    this.db
      .prepare('INSERT INTO notifications (id, data, at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, at = excluded.at')
      .run(n.id, JSON.stringify(n), n.at)
  }

  async markAllNotificationsRead(at: number): Promise<void> {
    const rows = this.db.prepare('SELECT data FROM notifications').all()
    const upd = this.db.prepare('UPDATE notifications SET data = ? WHERE id = ?')
    for (const row of rows) {
      const n = JSON.parse(row.data as string) as AppNotification
      if (!n.readAt) upd.run(JSON.stringify({ ...n, readAt: at }), n.id)
    }
  }

  // ---- Đồng bộ (không đưa vào Storage để renderer không gọi trực tiếp) ----

  private readonly tables: Record<SyncKind, string> = { note: 'notes', folder: 'folders', reminder: 'reminders', calendar: 'calendars', event: 'events' }

  /** Truy cập dữ liệu trên máy cho engine đồng bộ. Ghi đúng như đã cho, không đổi updatedAt. */
  syncLocal(): SyncLocal {
    const rows = (table: string): SyncEntity[] =>
      this.db.prepare(`SELECT data FROM ${table}`).all().map((r) => JSON.parse(r.data as string) as SyncEntity)
    return {
      listAll: async () => ({
        note: rows('notes').map((n) => ({ strokes: [], ...n }) as SyncEntity),
        folder: rows('folders'),
        reminder: rows('reminders'),
        // Chỉ lịch trong app (và sự kiện của chúng) đi qua Drive; lịch Google và iCal tự lấy từ nguồn của chúng.
        calendar: this.db
          .prepare("SELECT data FROM calendars WHERE json_extract(data, '$.kind') = 'local'")
          .all()
          .map((r) => JSON.parse(r.data as string) as SyncEntity),
        event: this.db
          .prepare("SELECT data FROM events WHERE cal IN (SELECT id FROM calendars WHERE json_extract(data, '$.kind') = 'local')")
          .all()
          .map((r) => JSON.parse(r.data as string) as SyncEntity)
      }),
      put: async (kind, e) => {
        if (kind === 'event') {
          this.writeEvent(e as unknown as CalEvent)
          return
        }
        this.db
          .prepare(`INSERT INTO ${this.tables[kind]} (id, data, deleted_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted_at = excluded.deleted_at`)
          .run(e.id, JSON.stringify(e), e.deletedAt)
      },
      purge: async (kind, id) => {
        this.db.prepare(`DELETE FROM ${this.tables[kind]} WHERE id = ?`).run(id)
      }
    }
  }

  /** Trạng thái đồng bộ riêng cho từng tài khoản (đổi tài khoản thì đồng bộ lại từ đầu). */
  syncStateStore(accountKey: string): SyncStateStore {
    const k = `sync-state:${accountKey}`
    return {
      load: async (): Promise<SyncState> => {
        const row = this.db.prepare('SELECT data FROM settings WHERE k = ?').get(k)
        return row ? (JSON.parse(row.data as string) as SyncState) : { token: null, items: {} }
      },
      save: async (state: SyncState): Promise<void> => {
        this.db.prepare('INSERT INTO settings (k, data) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET data = excluded.data').run(k, JSON.stringify(state))
      }
    }
  }

  // ---- Lịch ----

  async listCalendars(): Promise<CalendarSource[]> {
    return this.db.prepare('SELECT data FROM calendars WHERE deleted_at IS NULL').all().map((r) => JSON.parse(r.data as string))
  }

  async saveCalendar(c: CalendarSource): Promise<void> {
    this.db
      .prepare('INSERT INTO calendars (id, data, deleted_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted_at = excluded.deleted_at')
      .run(c.id, JSON.stringify(c), c.deletedAt)
  }

  async listEvents(): Promise<CalEvent[]> {
    return this.db.prepare('SELECT data FROM events WHERE deleted_at IS NULL').all().map((r) => JSON.parse(r.data as string))
  }

  async saveEvent(e: CalEvent): Promise<void> {
    this.writeEvent(e)
  }

  private writeEvent(e: CalEvent): void {
    this.db
      .prepare(
        'INSERT INTO events (id, data, deleted_at, cal, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted_at = excluded.deleted_at, cal = excluded.cal, start_ms = excluded.start_ms, end_ms = excluded.end_ms'
      )
      .run(e.id, JSON.stringify(e), e.deletedAt, e.calendarId, e.start, e.end)
  }

  // Các hàm dưới đây chỉ dành cho main (đồng bộ lịch từ xa, nhắc sự kiện), không mở cho giao diện.

  /** Thay các sự kiện đã lưu đệm của một lịch từ xa trong khoảng [from, to) bằng danh sách mới lấy về. */
  replaceRemoteEvents(calendarId: string, events: CalEvent[], fromMs: number, toMs: number): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM events WHERE cal = ? AND end_ms > ? AND start_ms < ?').run(calendarId, fromMs, toMs)
      for (const e of events) this.writeEvent(e)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** Xóa hẳn một lịch cùng sự kiện của nó (ngắt kết nối Google hoặc iCal). */
  removeCalendarData(calendarId: string): void {
    this.db.prepare('DELETE FROM events WHERE cal = ?').run(calendarId)
    this.db.prepare('DELETE FROM calendars WHERE id = ?').run(calendarId)
  }

  hasEventAlert(key: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM event_alerts WHERE k = ?').get(key)
  }

  markEventAlert(key: string, at: number): void {
    this.db.prepare('INSERT OR IGNORE INTO event_alerts (k, at) VALUES (?, ?)').run(key, at)
  }
}
