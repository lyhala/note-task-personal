import { addDays } from '@core/reminders'
import { wallToMs, type CalEvent, type CalendarSource, type EventAttendee } from '@core/calendar'
import { FORMAT_VERSION } from '@core/types'

// Client Google Calendar API và việc chuyển đổi qua lại giữa sự kiện Google và CalEvent. Không phụ thuộc Electron.

const API = 'https://www.googleapis.com/calendar/v3'
const RETRY_DELAYS = [500, 1500, 3500]

export interface GCalendarListItem {
  id: string
  summary: string
  summaryOverride?: string
  backgroundColor?: string
  accessRole: string
  primary?: boolean
}

interface GTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GEvent {
  id: string
  etag?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  hangoutLink?: string
  start: GTime
  end: GTime
  recurringEventId?: string
  recurrence?: string[]
  attendees?: { email: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean }[]
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] }
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'GoogleApiError'
  }
}

export const isReadOnlyRole = (role: string): boolean => role === 'reader' || role === 'freeBusyReader'

/** Mã sự kiện lưu trong app: gộp mã lịch và mã sự kiện Google để không đụng nhau giữa các lịch. */
export const localEventId = (calendar: CalendarSource, googleId: string): string => `g:${calendar.id}:${googleId}`

export function fromGoogle(calendar: CalendarSource, g: GEvent): CalEvent {
  const allDay = !!g.start.date
  const link = g.hangoutLink ?? g.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? ''
  const popup = g.reminders && !g.reminders.useDefault ? (g.reminders.overrides ?? []).find((o) => o.method === 'popup') : undefined
  const attendees: EventAttendee[] = (g.attendees ?? []).map((a) => ({
    email: a.email,
    name: a.displayName,
    response: a.responseStatus as EventAttendee['response'],
    organizer: a.organizer,
    self: a.self
  }))
  const now = Date.now()
  let startDate: string | null = null
  let endDate: string | null = null
  let start: number
  let end: number
  if (allDay) {
    startDate = g.start.date!
    const endExclusive = g.end.date ?? addDays(startDate, 1)
    endDate = endExclusive > startDate ? addDays(endExclusive, -1) : startDate // Google: ngày kết thúc loại trừ
    start = wallToMs(startDate, 0, null)
    end = wallToMs(addDays(endDate, 1), 0, null)
  } else {
    start = Date.parse(g.start.dateTime!)
    end = Date.parse(g.end.dateTime ?? g.start.dateTime!)
  }
  return {
    v: FORMAT_VERSION,
    id: localEventId(calendar, g.id),
    calendarId: calendar.id,
    title: g.summary ?? '(Không có tiêu đề)',
    description: g.description ?? '',
    location: g.location ?? link,
    allDay,
    start,
    end,
    startDate,
    endDate,
    tz: allDay ? null : (g.start.timeZone ?? null),
    rrule: null, // Google đã tách chuỗi lặp thành từng lần (singleEvents)
    exdates: [],
    reminderMinutes: g.reminders?.useDefault === false ? (popup ? popup.minutes : -1) : null,
    attendees,
    link,
    remote: { id: g.id, etag: g.etag, recurringId: g.recurringEventId ?? null },
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  }
}

/** Thân yêu cầu gửi lên Google. Chỉ tạo mới mới gửi quy tắc lặp (sửa một lần của chuỗi thì không đổi chuỗi). */
export function toGoogleBody(e: CalEvent, opts: { includeRecurrence: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: e.title, description: e.description, location: e.location }
  if (e.allDay && e.startDate) {
    body.start = { date: e.startDate }
    body.end = { date: addDays(e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate, 1) }
  } else {
    const tz = e.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    body.start = { dateTime: new Date(e.start).toISOString(), timeZone: tz }
    body.end = { dateTime: new Date(e.end).toISOString(), timeZone: tz }
  }
  if (e.reminderMinutes === null) body.reminders = { useDefault: true }
  else if (e.reminderMinutes < 0) body.reminders = { useDefault: false, overrides: [] }
  else body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: e.reminderMinutes }] }
  if (opts.includeRecurrence && e.rrule) body.recurrence = [`RRULE:${e.rrule}`]
  return body
}

export class GoogleCalendarClient {
  /** `getToken(force)`: access token; force = true buộc làm mới (khi bị 401). */
  constructor(private getToken: (force: boolean) => Promise<string>) {}

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let force = false
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken(force)
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }
      })
      if (res.ok) return res
      if (res.status === 401 && !force) {
        force = true
        continue
      }
      if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]))
        continue
      }
      const text = await res.text().catch(() => '')
      let msg = text.slice(0, 200)
      try {
        msg = JSON.parse(text).error?.message ?? msg
      } catch {
        /* giữ nguyên nội dung */
      }
      throw new GoogleApiError(res.status, `Google Calendar lỗi ${res.status}: ${msg}`)
    }
  }

  async listCalendars(): Promise<GCalendarListItem[]> {
    const out: GCalendarListItem[] = []
    let page: string | undefined
    do {
      const q = new URLSearchParams({ minAccessRole: 'reader', maxResults: '250' })
      if (page) q.set('pageToken', page)
      const r = (await (await this.request(`${API}/users/me/calendarList?${q}`)).json()) as { items?: GCalendarListItem[]; nextPageToken?: string }
      out.push(...(r.items ?? []))
      page = r.nextPageToken
    } while (page)
    return out
  }

  /** Các lần xảy ra trong khoảng [timeMin, timeMax), chuỗi lặp đã được Google tách ra từng lần. */
  async listEvents(calendarId: string, timeMinMs: number, timeMaxMs: number): Promise<GEvent[]> {
    const out: GEvent[] = []
    let page: string | undefined
    do {
      const q = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        showDeleted: 'false',
        maxResults: '2500',
        timeMin: new Date(timeMinMs).toISOString(),
        timeMax: new Date(timeMaxMs).toISOString()
      })
      if (page) q.set('pageToken', page)
      const r = (await (await this.request(`${API}/calendars/${encodeURIComponent(calendarId)}/events?${q}`)).json()) as {
        items?: GEvent[]
        nextPageToken?: string
      }
      out.push(...(r.items ?? []).filter((g) => g.status !== 'cancelled' && (g.start?.date || g.start?.dateTime)))
      page = r.nextPageToken
    } while (page)
    return out
  }

  async insertEvent(calendarId: string, body: Record<string, unknown>): Promise<GEvent> {
    return (await (await this.request(`${API}/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) })).json()) as GEvent
  }

  async patchEvent(calendarId: string, eventId: string, body: Record<string, unknown>): Promise<GEvent> {
    return (await (
      await this.request(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) })
    ).json()) as GEvent
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.request(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' })
    } catch (e) {
      // 404/410: đã bị xóa ở nơi khác, coi như xong.
      if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e
    }
  }
}
