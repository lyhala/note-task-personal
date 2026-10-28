// Lịch: mô hình sự kiện, múi giờ, sự kiện lặp (RRULE) và bố cục hiển thị. Không phụ thuộc Electron hay giao diện.

import { addDays, addMonths, dateStr, parseDate } from './reminders'
import { FORMAT_VERSION, newId, type AppNotification } from './types'

export type CalendarKind = 'local' | 'google' | 'ical'

export const CALENDAR_COLORS = ['#7c6cf0', '#ef6c8a', '#2fb38a', '#e8a02c', '#4f8def', '#9b59b6', '#e57373', '#26a69a']

export interface CalendarSource {
  v: number
  id: string
  kind: CalendarKind
  name: string
  color: string
  visible: boolean
  /** Lịch chỉ đọc (link iCal, hoặc lịch Google mà người dùng không có quyền sửa). */
  readOnly: boolean
  /** Google: email tài khoản; mã lịch bên Google nằm ở remoteId. */
  account: string | null
  remoteId: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface EventAttendee {
  email: string
  name?: string
  response?: 'accepted' | 'declined' | 'tentative' | 'needsAction'
  organizer?: boolean
  self?: boolean
}

/** Giờ nhắc: null = dùng mặc định trong cài đặt, -1 = không nhắc, còn lại là số phút trước giờ bắt đầu. */
export const NO_REMINDER = -1

export interface CalEvent {
  v: number
  id: string
  calendarId: string
  title: string
  description: string
  /** Địa điểm hoặc link họp. */
  location: string
  allDay: boolean
  /** Sự kiện có giờ: thời điểm bắt đầu và kết thúc (ms, UTC). */
  start: number
  end: number
  /** Sự kiện cả ngày: 'YYYY-MM-DD'; endDate là ngày CUỐI CÙNG còn bao gồm (khác Google, nơi ngày kết thúc loại trừ). */
  startDate: string | null
  endDate: string | null
  /** Múi giờ IANA của sự kiện (dùng để lặp lại đúng giờ qua đổi giờ mùa hè); null = múi giờ của máy. */
  tz: string | null
  /** Quy tắc lặp, không có tiền tố "RRULE:" (ví dụ "FREQ=WEEKLY;BYDAY=MO,WE"). */
  rrule: string | null
  /** Các lần bị loại khỏi chuỗi lặp (ms bắt đầu của lần đó, hoặc ngày với sự kiện cả ngày). */
  exdates: (number | string)[]
  reminderMinutes: number | null
  attendees: EventAttendee[]
  /** Link họp (Google Meet, Zoom...). */
  link: string
  /** Sự kiện đến từ Google hoặc link iCal: nhận dạng bên kia. Sự kiện của lịch trong app thì null. */
  remote: { id: string; etag?: string; recurringId?: string | null } | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * Reminder đã đẩy sang Google Calendar thì sự kiện bên Google đã hiện trên lịch rồi:
 * ẩn bản reminder khỏi lịch để không bị trùng hai cái. (Chỉ ẩn khi sự kiện Google đang hiển thị.)
 */
export function withoutPushedDuplicates<R extends { pushToCalendar?: boolean; googleEventId?: string | null }>(reminders: R[], events: CalEvent[], calendars: CalendarSource[]): R[] {
  const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id))
  const shown = new Set<string>()
  for (const e of events) if (e.remote && visible.has(e.calendarId)) shown.add(e.remote.recurringId ?? e.remote.id)
  return reminders.filter((r) => !(r.pushToCalendar && r.googleEventId && shown.has(r.googleEventId)))
}

export function newCalendar(partial: Partial<CalendarSource> = {}): CalendarSource {
  const now = Date.now()
  return {
    v: FORMAT_VERSION,
    id: newId(),
    kind: 'local',
    name: 'Lịch của tôi',
    color: CALENDAR_COLORS[0],
    visible: true,
    readOnly: false,
    account: null,
    remoteId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...partial
  }
}

export function newEvent(partial: Partial<CalEvent> = {}): CalEvent {
  const now = Date.now()
  const start = Math.ceil(now / 3_600_000) * 3_600_000
  return {
    v: FORMAT_VERSION,
    id: newId(),
    calendarId: '',
    title: '',
    description: '',
    location: '',
    allDay: false,
    start,
    end: start + 3_600_000,
    startDate: null,
    endDate: null,
    tz: null,
    rrule: null,
    exdates: [],
    reminderMinutes: null,
    attendees: [],
    link: '',
    remote: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...partial
  }
}

// ---- Múi giờ ----

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    dtfCache.set(tz, f)
  }
  return f
}

/** Độ lệch (ms) của múi giờ so với UTC tại một thời điểm. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p: Record<string, string> = {}
  for (const part of formatter(tz).formatToParts(new Date(ms))) p[part.type] = part.value
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** Giờ trên đồng hồ tường (ngày + giờ phút) trong một múi giờ → thời điểm UTC (ms). tz = null: múi giờ của máy. */
export function wallToMs(date: string, minutes: number, tz: string | null): number {
  const [y, m, d] = date.split('-').map(Number)
  const hh = Math.floor(minutes / 60)
  const mm = minutes % 60
  if (!tz) return new Date(y, m - 1, d, hh, mm).getTime()
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  let ms = guess - tzOffsetMs(guess, tz)
  const again = guess - tzOffsetMs(ms, tz) // qua ranh giới đổi giờ thì tính lại một lần
  if (again !== ms) ms = again
  return ms
}

/** Thời điểm UTC (ms) → ngày và số phút trong ngày theo đồng hồ tường của múi giờ. */
export function msToWall(ms: number, tz: string | null): { date: string; minutes: number } {
  if (!tz) {
    const d = new Date(ms)
    return { date: dateStr(d), minutes: d.getHours() * 60 + d.getMinutes() }
  }
  const p: Record<string, string> = {}
  for (const part of formatter(tz).formatToParts(new Date(ms))) p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour % 24) * 60 + +p.minute }
}

// ---- Quy tắc lặp (RRULE) ----

interface ByDay {
  /** 0 = không có số thứ tự (mọi ngày đó trong kỳ); 1..5 hoặc -1..-5 = lần thứ n trong tháng. */
  n: number
  /** 0 = Chủ nhật ... 6 = Thứ bảy (giống Date.getDay). */
  wd: number
}

export interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count: number | null
  until: string | null
  byday: ByDay[]
  bymonthday: number[]
  bymonth: number[]
  /** Ngày bắt đầu tuần (0 = Chủ nhật, 1 = Thứ hai...). */
  wkst: number
}

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export function parseRule(text: string): Rule | null {
  const parts: Record<string, string> = {}
  for (const seg of text.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = seg.split('=')
    if (k && v) parts[k.toUpperCase()] = v
  }
  const freq = parts.FREQ as Rule['freq'] | undefined
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  let until: string | null = null
  if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(parts.UNTIL)
    if (m) until = `${m[1]}-${m[2]}-${m[3]}`
  }
  const byday: ByDay[] = []
  for (const tok of (parts.BYDAY ?? '').split(',').filter(Boolean)) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(tok.trim())
    if (m) byday.push({ n: m[1] ? parseInt(m[1], 10) : 0, wd: WD.indexOf(m[2].toUpperCase()) })
  }
  const nums = (s?: string) => (s ?? '').split(',').filter(Boolean).map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x))
  return {
    freq,
    interval: Math.max(1, parseInt(parts.INTERVAL ?? '1', 10) || 1),
    count: parts.COUNT ? parseInt(parts.COUNT, 10) || null : null,
    until,
    byday,
    bymonthday: nums(parts.BYMONTHDAY),
    bymonth: nums(parts.BYMONTH),
    wkst: Math.max(0, WD.indexOf((parts.WKST ?? 'MO').toUpperCase()))
  }
}

const weekday = (date: string) => parseDate(date).getDay()
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate() // m: 1..12
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Các ngày của một tháng khớp quy tắc BYMONTHDAY / BYDAY (đã sắp tăng dần). */
function monthDays(r: Rule, y: number, m: number, fallbackDay: number): string[] {
  const dim = daysInMonth(y, m)
  const out = new Set<number>()
  if (r.bymonthday.length) {
    for (const d of r.bymonthday) {
      const day = d > 0 ? d : dim + d + 1
      if (day >= 1 && day <= dim) out.add(day)
    }
  } else if (r.byday.length) {
    for (const b of r.byday) {
      const days: number[] = []
      for (let d = 1; d <= dim; d++) if (new Date(y, m - 1, d).getDay() === b.wd) days.push(d)
      if (b.n === 0) days.forEach((d) => out.add(d))
      else {
        const pick = b.n > 0 ? days[b.n - 1] : days[days.length + b.n]
        if (pick) out.add(pick)
      }
    }
  } else if (fallbackDay <= dim) out.add(fallbackDay)
  return [...out].sort((a, b) => a - b).map((d) => ymd(y, m, d))
}

/** Dãy ngày tăng dần của chuỗi lặp, bắt đầu từ ngày gốc. Dừng sau `to` hoặc khi hết COUNT / UNTIL. */
function* ruleDates(r: Rule, startDate: string, to: string): Generator<string> {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  let emitted = 0
  const limit = 20_000
  const ok = (d: string) => d >= startDate && (!r.until || d <= r.until)

  if (r.freq === 'DAILY') {
    for (let k = 0, d = startDate; k < limit && d <= to; k++, d = addDays(d, r.interval)) {
      if (r.until && d > r.until) return
      if (r.byday.length && !r.byday.some((b) => b.wd === weekday(d))) continue
      yield d
      if (r.count && ++emitted >= r.count) return
    }
    return
  }

  if (r.freq === 'WEEKLY') {
    const wds = r.byday.length ? r.byday.map((b) => b.wd) : [weekday(startDate)]
    const offsetOf = (wd: number) => (wd - r.wkst + 7) % 7
    const sorted = [...new Set(wds)].sort((a, b) => offsetOf(a) - offsetOf(b))
    const weekStart = addDays(startDate, -offsetOf(weekday(startDate)))
    for (let k = 0; k < limit; k++) {
      const base = addDays(weekStart, 7 * r.interval * k)
      if (base > to) return
      for (const wd of sorted) {
        const d = addDays(base, offsetOf(wd))
        if (d < startDate) continue
        if (r.until && d > r.until) return
        yield d
        if (r.count && ++emitted >= r.count) return
      }
    }
    return
  }

  if (r.freq === 'MONTHLY') {
    for (let k = 0; k < limit; k++) {
      const first = addMonths(ymd(sy, sm, 1), r.interval * k)
      if (first > to) return
      const [y, m] = first.split('-').map(Number)
      for (const d of monthDays(r, y, m, sd)) {
        if (!ok(d)) {
          if (r.until && d > r.until) return
          continue
        }
        yield d
        if (r.count && ++emitted >= r.count) return
      }
    }
    return
  }

  // YEARLY
  const months = r.bymonth.length ? [...r.bymonth].sort((a, b) => a - b) : [sm]
  for (let k = 0; k < limit; k++) {
    const y = sy + r.interval * k
    if (y > Number(to.slice(0, 4))) return
    for (const m of months) {
      const days = r.bymonthday.length || r.byday.length ? monthDays(r, y, m, sd) : daysInMonth(y, m) >= sd ? [ymd(y, m, sd)] : []
      for (const d of days) {
        if (!ok(d)) {
          if (r.until && d > r.until) return
          continue
        }
        yield d
        if (r.count && ++emitted >= r.count) return
      }
    }
  }
}

// ---- Các lần xảy ra của sự kiện ----

export interface Occurrence {
  /** "idSựKiện@bắtĐầu" (duy nhất cho từng lần của chuỗi lặp). */
  key: string
  event: CalEvent
  start: number
  end: number
  allDay: boolean
}

const DAY_MS = 86_400_000

function allDaySpan(startDate: string, endDate: string): { start: number; end: number } {
  return { start: wallToMs(startDate, 0, null), end: wallToMs(addDays(endDate, 1), 0, null) }
}

/** Mọi lần xảy ra của các sự kiện trong khoảng [fromMs, toMs), đã sắp theo giờ bắt đầu. */
export function occurrencesBetween(events: CalEvent[], fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = []
  const push = (e: CalEvent, start: number, end: number): void => {
    if (end <= fromMs && !(start === end && start >= fromMs)) return
    if (start >= toMs) return
    out.push({ key: `${e.id}@${start}`, event: e, start, end, allDay: e.allDay })
  }

  for (const e of events) {
    if (e.deletedAt) continue
    const rule = e.rrule ? parseRule(e.rrule) : null

    if (e.allDay && e.startDate) {
      const endDate = e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate
      const spanDays = Math.round((parseDate(endDate).getTime() - parseDate(e.startDate).getTime()) / DAY_MS)
      if (!rule) {
        const s = allDaySpan(e.startDate, endDate)
        push(e, s.start, s.end)
        continue
      }
      const from = addDays(dateStr(new Date(fromMs)), -spanDays - 1)
      const to = dateStr(new Date(toMs))
      for (const d of ruleDates(rule, e.startDate, to)) {
        if (d < from) continue
        if (e.exdates.includes(d)) continue
        const s = allDaySpan(d, addDays(d, spanDays))
        push(e, s.start, s.end)
      }
      continue
    }

    if (!rule) {
      push(e, e.start, e.end)
      continue
    }
    const wall = msToWall(e.start, e.tz)
    const duration = e.end - e.start
    const from = dateStr(new Date(fromMs - duration - 2 * DAY_MS))
    const to = dateStr(new Date(toMs + DAY_MS))
    for (const d of ruleDates(rule, wall.date, to)) {
      if (d < from) continue
      const start = wallToMs(d, wall.minutes, e.tz)
      if (e.exdates.includes(start)) continue
      push(e, start, start + duration)
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

// ---- Bố cục hiển thị ----

export interface Placed {
  occ: Occurrence
  /** Cột (0..columns-1) trong cụm sự kiện chồng nhau. */
  column: number
  columns: number
}

/** Xếp các sự kiện có giờ của một ngày thành cột để không đè nhau (kiểu Google Calendar). */
export function layoutDay(occs: Occurrence[]): Placed[] {
  const sorted = [...occs].sort((a, b) => a.start - b.start || b.end - a.end)
  const placed: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = -Infinity
  const flush = (): void => {
    const cols = cluster.reduce((m, p) => Math.max(m, p.column + 1), 1)
    cluster.forEach((p) => (p.columns = cols))
    placed.push(...cluster)
    cluster = []
  }
  for (const occ of sorted) {
    if (occ.start >= clusterEnd) {
      flush()
      clusterEnd = -Infinity
    }
    const used = new Set(cluster.filter((p) => p.occ.end > occ.start).map((p) => p.column))
    let column = 0
    while (used.has(column)) column++
    cluster.push({ occ, column, columns: 1 })
    clusterEnd = Math.max(clusterEnd, occ.end)
  }
  flush()
  return placed
}

/** Lần xảy ra có chạm vào ngày `date` (theo múi giờ của máy) không. */
export function touchesDay(o: Occurrence, date: string): boolean {
  const s = wallToMs(date, 0, null)
  const e = wallToMs(addDays(date, 1), 0, null)
  return o.start < e && (o.end > s || o.start === s)
}

export function formatRange(o: Occurrence): string {
  if (o.allDay) return 'Cả ngày'
  const t = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${t(o.start)} – ${t(o.end)}`
}


/** Mục thông báo "Sự kiện sắp bắt đầu" (reminderId giữ id của sự kiện). */
export function makeEventNotification(e: CalEvent, at: number): AppNotification {
  return { v: FORMAT_VERSION, id: newId(), reminderId: e.id, kind: 'event', title: e.title, at, readAt: null }
}

/** Tên người tham dự để hiển thị gọn (bỏ chính mình), ví dụ "Lan, Minh". */
export function attendeeNames(e: CalEvent, max = 3): { text: string; more: number } {
  const others = e.attendees.filter((a) => !a.self)
  const names = others.slice(0, max).map((a) => a.name || a.email.split('@')[0])
  return { text: names.join(', '), more: Math.max(0, others.length - max) }
}
