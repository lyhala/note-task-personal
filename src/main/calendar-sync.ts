import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseIcs } from '@core/ical'
import { newCalendar, type CalEvent, type CalendarSource } from '@core/calendar'
import { addDays } from '@core/reminders'
import type { Reminder } from '@core/types'
import {
  AuthExpiredError,
  getAccessToken,
  getAccount,
  googleConfigured,
  markNeedsReauth,
  signIn,
  signOut,
  type AccountInfo
} from './google-auth'
import { GoogleApiError, GoogleCalendarClient, fromGoogle, isReadOnlyRole, toGoogleBody, type GEvent } from './google-calendar'
import type { SqliteStorage } from './sqlite-storage'

export interface CalendarConnStatus {
  configured: boolean
  account: AccountInfo | null
  syncing: boolean
  lastSyncAt: number | null
  lastError: string | null
}

export type WriteResult = { ok: true; id?: string | null } | { ok: false; error: string }

// Link iCal bí mật coi như mật khẩu: lưu mã hóa bằng kho khóa của hệ điều hành, không đưa vào SQLite hay Drive.
const icalFile = (): string => join(app.getPath('userData'), 'ical-links.json')
function readLinks(): Record<string, { v: string; enc: boolean }> {
  try {
    return existsSync(icalFile()) ? JSON.parse(readFileSync(icalFile(), 'utf8')) : {}
  } catch {
    return {}
  }
}
function saveLink(calId: string, url: string | null): void {
  const all = readLinks()
  if (url === null) delete all[calId]
  else all[calId] = safeStorage.isEncryptionAvailable() ? { v: safeStorage.encryptString(url).toString('base64'), enc: true } : { v: url, enc: false }
  writeFileSync(icalFile(), JSON.stringify(all))
}
function loadLink(calId: string): string | null {
  const x = readLinks()[calId]
  if (!x) return null
  return x.enc ? safeStorage.decryptString(Buffer.from(x.v, 'base64')) : x.v
}

const DAY = 86_400_000
const WINDOW_BACK = 45 * DAY
const WINDOW_FORWARD = 180 * DAY
const START_DELAY_MS = 6_000
const INTERVAL_MS = 3 * 60_000

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(msg)) return 'Không kết nối được tới Google, kiểm tra mạng rồi thử lại'
  if (/insufficient authentication scopes|insufficientPermissions/i.test(msg)) {
    markNeedsReauth('calendar')
    return 'Google chưa cấp quyền Google Calendar cho app. Hãy đăng nhập lại và tick đủ các ô quyền.'
  }
  return msg
}

/** Kết nối Google Calendar: lấy danh sách lịch, đọc sự kiện trong một khoảng quanh hôm nay (lưu đệm), và ghi thẳng lên Google. */
export class CalendarSyncManager {
  private running = false
  private lastError: string | null = null
  private lastSyncAt: number | null = null
  private timer: NodeJS.Timeout | undefined

  constructor(
    private storage: SqliteStorage,
    private emit: (channel: string, payload: unknown) => void
  ) {}

  status(): CalendarConnStatus {
    return { configured: googleConfigured(), account: getAccount('calendar'), syncing: this.running, lastSyncAt: this.lastSyncAt, lastError: this.lastError }
  }

  private publish(): void {
    this.emit('calendar:status', this.status())
  }

  private changed(): void {
    this.emit('calendar:changed', null)
  }

  private client(): GoogleCalendarClient {
    return new GoogleCalendarClient((force) => getAccessToken('calendar', force))
  }

  private ready(): AccountInfo | null {
    const a = getAccount('calendar')
    return a && !a.expired && googleConfigured() ? a : null
  }

  start(): void {
    setTimeout(() => void this.refresh(), START_DELAY_MS)
    this.timer = setInterval(() => void this.refresh(), INTERVAL_MS)
  }

  stop(): void {
    clearInterval(this.timer)
  }

  async connect(): Promise<CalendarConnStatus> {
    this.lastError = null
    try {
      await signIn('calendar')
    } catch (e) {
      this.lastError = describe(e)
      this.publish()
      return this.status()
    }
    this.publish()
    return this.refresh()
  }

  async disconnect(): Promise<CalendarConnStatus> {
    await signOut('calendar')
    for (const c of (await this.storage.listCalendars()).filter((x) => x.kind === 'google')) this.storage.removeCalendarData(c.id)
    this.lastError = null
    this.lastSyncAt = null
    this.changed()
    this.publish()
    return this.status()
  }

  /** Thêm lịch từ link iCal bí mật (chỉ đọc). */
  async addIcal(name: string, url: string): Promise<WriteResult> {
    const link = url.trim().replace(/^webcal:/i, 'https:')
    if (!/^https:\/\//i.test(link)) return { ok: false, error: 'Link iCal phải bắt đầu bằng https:// (hoặc webcal://)' }
    const cal = newCalendar({ kind: 'ical', name: name.trim() || 'Lịch iCal', readOnly: true, color: '#2fb38a' })
    try {
      await this.fetchIcal(cal, link)
    } catch (e) {
      return { ok: false, error: describe(e) }
    }
    saveLink(cal.id, link)
    await this.storage.saveCalendar(cal)
    await this.fetchIcal(cal, link).catch(() => undefined)
    this.changed()
    return { ok: true, id: cal.id }
  }

  async removeIcal(calId: string): Promise<void> {
    saveLink(calId, null)
    this.storage.removeCalendarData(calId)
    this.changed()
  }

  private async fetchIcal(cal: CalendarSource, url: string): Promise<void> {
    const res = await fetch(url, { headers: { Accept: 'text/calendar' } })
    if (!res.ok) throw new Error(`Không tải được link iCal (lỗi ${res.status})`)
    const text = await res.text()
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Link này không phải lịch iCal')
    this.storage.replaceRemoteEvents(cal.id, parseIcs(text, cal), 0, Number.MAX_SAFE_INTEGER)
  }

  private async refreshIcals(): Promise<void> {
    for (const c of (await this.storage.listCalendars()).filter((x) => x.kind === 'ical' && x.visible)) {
      const link = loadLink(c.id)
      if (!link) continue
      try {
        await this.fetchIcal(c, link)
      } catch (e) {
        this.lastError = describe(e)
      }
    }
    this.changed()
  }

  /** Làm mới danh sách lịch và sự kiện của các lịch đang bật. */
  async refresh(): Promise<CalendarConnStatus> {
    const account = this.ready()
    if (this.running) return this.status()
    if (!account) {
      await this.refreshIcals()
      return this.status()
    }
    this.running = true
    this.publish()
    try {
      const client = this.client()
      await this.refreshCalendarList(client, account.email)
      for (const c of (await this.storage.listCalendars()).filter((x) => x.kind === 'google' && x.account === account.email && x.visible)) {
        await this.refreshEvents(client, c)
      }
      this.lastError = null
      await this.refreshIcals()
      this.lastSyncAt = Date.now()
    } catch (e) {
      this.lastError = e instanceof AuthExpiredError ? e.message : describe(e)
    } finally {
      this.running = false
      this.changed()
      this.publish()
    }
    return this.status()
  }

  private async refreshCalendarList(client: GoogleCalendarClient, email: string): Promise<void> {
    const remote = await client.listCalendars()
    const existing = (await this.storage.listCalendars()).filter((c) => c.kind === 'google' && c.account === email)
    const seen = new Set<string>()
    for (const r of remote) {
      seen.add(r.id)
      const cur = existing.find((c) => c.remoteId === r.id)
      const base = {
        name: r.summaryOverride ?? r.summary,
        color: r.backgroundColor ?? '#4f8def',
        readOnly: isReadOnlyRole(r.accessRole)
      }
      if (cur) {
        if (cur.name !== base.name || cur.color !== base.color || cur.readOnly !== base.readOnly) {
          await this.storage.saveCalendar({ ...cur, ...base, updatedAt: Date.now() })
        }
      } else {
        // Lịch mới: chỉ lịch chính bật sẵn, các lịch khác để người dùng tự bật.
        await this.storage.saveCalendar(newCalendar({ kind: 'google', account: email, remoteId: r.id, visible: !!r.primary, ...base }))
      }
    }
    for (const c of existing) if (c.remoteId && !seen.has(c.remoteId)) this.storage.removeCalendarData(c.id)
  }

  private async refreshEvents(client: GoogleCalendarClient, cal: CalendarSource): Promise<void> {
    if (!cal.remoteId) return
    const from = Date.now() - WINDOW_BACK
    const to = Date.now() + WINDOW_FORWARD
    const events = (await client.listEvents(cal.remoteId, from, to)).map((g: GEvent) => fromGoogle(cal, g))
    this.storage.replaceRemoteEvents(cal.id, events, from, to)
  }

  private async calendarOf(e: CalEvent): Promise<CalendarSource> {
    const cal = (await this.storage.listCalendars()).find((c) => c.id === e.calendarId)
    if (!cal || cal.kind !== 'google' || !cal.remoteId) throw new Error('Lịch này không phải lịch Google')
    if (cal.readOnly) throw new Error('Lịch này chỉ đọc')
    return cal
  }

  private async afterWrite(cal: CalendarSource): Promise<void> {
    try {
      await this.refreshEvents(this.client(), cal)
    } catch {
      /* ghi thành công rồi, lần làm mới định kỳ sẽ cập nhật sau */
    }
    this.changed()
  }

  async saveEvent(e: CalEvent): Promise<WriteResult> {
    try {
      const cal = await this.calendarOf(e)
      const client = this.client()
      if (e.remote) await client.patchEvent(cal.remoteId!, e.remote.id, toGoogleBody(e, { includeRecurrence: false }))
      else await client.insertEvent(cal.remoteId!, toGoogleBody(e, { includeRecurrence: true }))
      await this.afterWrite(cal)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: describe(err) }
    }
  }

  /** scope 'this' chỉ xóa lần đó của chuỗi lặp; 'all' xóa cả chuỗi (xóa sự kiện gốc). */
  async deleteEvent(e: CalEvent, scope: 'all' | 'this'): Promise<WriteResult> {
    try {
      const cal = await this.calendarOf(e)
      if (!e.remote) throw new Error('Sự kiện chưa có mã Google')
      const id = scope === 'all' ? (e.remote.recurringId ?? e.remote.id) : e.remote.id
      await this.client().deleteEvent(cal.remoteId!, id)
      await this.afterWrite(cal)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: describe(err) }
    }
  }

  /** Đẩy reminder sang Google Calendar thành sự kiện trong lịch chính (tạo, cập nhật, hoặc xóa). Trả về mã sự kiện, hoặc null khi đã xóa. */
  async pushReminder(r: Reminder): Promise<WriteResult> {
    try {
      const account = this.ready()
      if (!account) throw new Error('Chưa kết nối Google Calendar')
      const cals = (await this.storage.listCalendars()).filter((c) => c.kind === 'google' && c.account === account.email && !c.readOnly)
      const cal = cals.find((c) => c.remoteId === account.email) ?? cals[0]
      if (!cal?.remoteId) throw new Error('Không tìm thấy lịch Google để ghi')
      const client = this.client()

      const wantEvent = !!r.pushToCalendar && !r.deletedAt && !!r.date
      if (!wantEvent) {
        if (r.googleEventId) await client.deleteEvent(cal.remoteId, r.googleEventId)
        await this.afterWrite(cal)
        return { ok: true, id: null }
      }

      const body: Record<string, unknown> = { summary: r.title, description: [r.notes, r.link].filter(Boolean).join('\n') }
      if (r.time) {
        const [h, m] = r.time.split(':').map(Number)
        const start = new Date(`${r.date}T00:00:00`)
        start.setHours(h, m, 0, 0)
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        body.start = { dateTime: start.toISOString(), timeZone: tz }
        body.end = { dateTime: new Date(start.getTime() + 30 * 60_000).toISOString(), timeZone: tz }
      } else {
        body.start = { date: r.date }
        body.end = { date: addDays(r.date!, 1) }
      }
      const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
      if (r.repeat === 'daily') body.recurrence = ['RRULE:FREQ=DAILY']
      else if (r.repeat === 'weekly') {
        body.recurrence = [`RRULE:FREQ=WEEKLY${r.weekdays?.length ? `;BYDAY=${r.weekdays.map((d) => BYDAY[d]).join(',')}` : ''}`]
      } else if (r.repeat === 'monthly') {
        const rule =
          r.monthlyMode === 'nth'
            ? `;BYDAY=${r.monthlyNth ?? 1}${BYDAY[r.monthlyWeekday ?? 1]}`
            : r.monthlyMode === 'day'
              ? `;BYMONTHDAY=${r.monthlyDay ?? 1}`
              : ''
        body.recurrence = [`RRULE:FREQ=MONTHLY${rule}`]
      } else if (r.repeat === 'custom') {
        const f = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY' }[r.repeatUnit]
        body.recurrence = [`RRULE:FREQ=${f};INTERVAL=${Math.max(1, r.repeatEvery)}`]
      }

      let id = r.googleEventId ?? null
      if (id) {
        try {
          await client.patchEvent(cal.remoteId, id, body)
        } catch (e) {
          if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) id = null // sự kiện đã bị xóa bên Google: tạo lại
          else throw e
        }
      }
      if (!id) id = (await client.insertEvent(cal.remoteId, body)).id
      await this.afterWrite(cal)
      return { ok: true, id }
    } catch (err) {
      return { ok: false, error: describe(err) }
    }
  }
}

