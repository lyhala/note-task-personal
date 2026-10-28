// Logic hạn, lặp lại và nhắc của Reminder. Hàm thuần, không phụ thuộc Electron hay giao diện,
// để bản mobile sau này dùng lại. Mọi ngày giờ tính theo giờ địa phương của máy.

import { newId, FORMAT_VERSION, type AppNotification, type NotifyKind, type Reminder } from './types'

export const DAILY_HOUR = 9
const DAY = 86_400_000
/** Mốc nhắc trễ hơn khoảng này (app đang đóng) được coi là "lỡ". */
export const MISSED_AFTER_MS = 2 * 60_000
/** Chỉ lục lại tối đa bấy nhiêu ngày khi tìm mốc nhắc bị bỏ lỡ. */
const LOOKBACK_DAYS = 7

// ---- Ngày giờ ----

const pad = (n: number) => String(n).padStart(2, '0')
export const dateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (s: string, n: number): string => {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return dateStr(d)
}
/** Cộng tháng, giữ ngày trong tháng của mốc gốc (31 → cuối tháng ngắn hơn). */
export const addMonths = (s: string, n: number): string => {
  const d = parseDate(s)
  const day = d.getDate()
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  t.setDate(Math.min(day, last))
  return dateStr(t)
}
const daysBetween = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY)
const monthsBetween = (a: string, b: string) => {
  const x = parseDate(a)
  const y = parseDate(b)
  return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth())
}

/** Thời điểm (ms) của một ngày và giờ 'HH:mm'. */
export function atTime(date: string, time: string): number {
  const [h, m] = time.split(':').map(Number)
  const d = parseDate(date)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
export const endOfDay = (date: string): number => atTime(date, '23:59') + 59_999
export const nineAm = (date: string): number => atTime(date, `${pad(DAILY_HOUR)}:00`)

// ---- Lặp lại ----

/** 'pattern': lặp theo quy tắc (thứ trong tuần, ngày/thứ trong tháng), kiểm tra từng ngày. */
type Step = { kind: 'day' | 'month'; n: number } | { kind: 'pattern'; test: (date: string) => boolean }
export const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
export const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
/** Thứ n của tháng: 1-4 = thứ n, -1 = thứ cuối cùng. */
const nthOfMonth = (d: Date, nth: number): boolean => (nth === -1 ? d.getDate() + 7 > daysInMonth(d) : Math.ceil(d.getDate() / 7) === nth)

function stepOf(r: Reminder): Step | null {
  switch (r.repeat) {
    case 'daily':
      return { kind: 'day', n: 1 }
    case 'weekly': {
      if (!r.weekdays?.length) return { kind: 'day', n: 7 }
      const set = new Set(r.weekdays)
      return { kind: 'pattern', test: (s) => set.has(parseDate(s).getDay()) }
    }
    case 'monthly': {
      if (r.monthlyMode === 'nth') {
        const wd = r.monthlyWeekday ?? 1
        const nth = r.monthlyNth ?? 1
        return { kind: 'pattern', test: (s) => { const d = parseDate(s); return d.getDay() === wd && nthOfMonth(d, nth) } }
      }
      if (r.monthlyMode === 'day') {
        const day = Math.min(31, Math.max(1, r.monthlyDay ?? 1))
        return { kind: 'pattern', test: (s) => { const d = parseDate(s); return d.getDate() === Math.min(day, daysInMonth(d)) } }
      }
      return { kind: 'month', n: 1 }
    }
    case 'custom': {
      const n = Math.max(1, Math.floor(r.repeatEvery) || 1)
      return r.repeatUnit === 'month' ? { kind: 'month', n } : { kind: 'day', n: r.repeatUnit === 'week' ? n * 7 : n }
    }
    default:
      return null
  }
}

/** Ngày xuất hiện thứ k của reminder lặp (k = 0 là ngày gốc). */
function occurrenceAt(anchor: string, step: Step & { kind: 'day' | 'month' }, k: number): string {
  return step.kind === 'day' ? addDays(anchor, k * step.n) : addMonths(anchor, k * step.n)
}

/** Lần xuất hiện mới nhất không sau `today`; nếu mốc gốc còn ở tương lai thì trả về chính mốc gốc. */
const SCAN_LIMIT = 1500

/** Quy tắc: ngày khớp đầu tiên không trước `from` (ngày gốc cũng phải khớp quy tắc). */
function patternFirst(step: Step & { kind: 'pattern' }, from: string): string {
  let d = from
  for (let i = 0; i < SCAN_LIMIT && !step.test(d); i++) d = addDays(d, 1)
  return d
}
function patternLatest(step: Step & { kind: 'pattern' }, anchor: string, today: string): string {
  const first = patternFirst(step, anchor)
  if (first >= today) return first
  let d = today
  for (let i = 0; i < SCAN_LIMIT && d > first && !step.test(d); i++) d = addDays(d, -1)
  return d < first ? first : d
}
function patternNext(step: Step & { kind: 'pattern' }, anchor: string, after: string): string {
  const first = patternFirst(step, anchor)
  return first > after ? first : patternFirst(step, addDays(after, 1))
}

function latestOccurrence(anchor: string, step: Step, today: string): string {
  if (step.kind === 'pattern') return patternLatest(step, anchor, today)
  if (anchor >= today) return anchor
  let k =
    step.kind === 'day'
      ? Math.floor(daysBetween(anchor, today) / step.n)
      : Math.floor(monthsBetween(anchor, today) / step.n)
  while (k > 0 && occurrenceAt(anchor, step, k) > today) k--
  while (occurrenceAt(anchor, step, k + 1) <= today) k++
  return occurrenceAt(anchor, step, k)
}

function nextOccurrence(anchor: string, step: Step, after: string): string {
  if (step.kind === 'pattern') return patternNext(step, anchor, after)
  let k = latestIndex(anchor, step, after)
  while (occurrenceAt(anchor, step, k) <= after) k++
  return occurrenceAt(anchor, step, k)
}
function latestIndex(anchor: string, step: Step & { kind: 'day' | 'month' }, day: string): number {
  if (anchor >= day) return 0
  let k = step.kind === 'day' ? Math.floor(daysBetween(anchor, day) / step.n) : Math.floor(monthsBetween(anchor, day) / step.n)
  while (k > 0 && occurrenceAt(anchor, step, k) > day) k--
  return k
}

/** Mọi ngày xuất hiện trong khoảng (from, to] của reminder lặp. */
function occurrencesBetween(anchor: string, step: Step, from: string, to: string): string[] {
  const out: string[] = []
  let d = nextOccurrence(anchor, step, from < anchor ? addDays(anchor, -1) : from)
  while (d <= to && out.length < 400) {
    out.push(d)
    d = nextOccurrence(anchor, step, d)
  }
  return out
}

export const isRepeating = (r: Reminder): boolean => r.repeat !== 'none'
/** Chỉ có "nhắc hàng ngày", không có ngày hạn. */
export const isNudgeOnly = (r: Reminder): boolean => !r.date && r.dailyNudge

export interface Occurrence {
  date: string
  time: string | null
}

/** Lần xuất hiện đang áp dụng ở thời điểm `today` (chưa tính đã tick hay chưa). */
export function currentOccurrence(r: Reminder, today: string): Occurrence | null {
  if (!r.date) return null
  const step = stepOf(r)
  if (!step) return { date: r.date, time: r.time }
  return { date: latestOccurrence(r.date, step, today), time: r.time }
}

/** Lần xuất hiện hiển thị: reminder lặp đã tick xong lần hiện tại thì chuyển sang lần kế tiếp. */
export function displayOccurrence(r: Reminder, today: string): Occurrence | null {
  const occ = currentOccurrence(r, today)
  if (!occ || !isRepeating(r)) return occ
  if (occ.date < today && r.doneDates.includes(occ.date)) {
    const step = stepOf(r)!
    return { date: nextOccurrence(r.date!, step, occ.date), time: r.time }
  }
  return occ
}

/** Đã tick cho lần xuất hiện / ngày hôm nay chưa. */
export function isDoneNow(r: Reminder, today: string): boolean {
  if (isNudgeOnly(r)) return r.doneDates.includes(today)
  if (isRepeating(r)) {
    const occ = displayOccurrence(r, today)
    return !!occ && r.doneDates.includes(occ.date)
  }
  return r.done
}

export type Bucket = 'overdue' | 'today' | 'upcoming' | 'nodue' | 'done'

export function bucketOf(r: Reminder, now: number): Bucket {
  const today = dateStr(new Date(now))
  if (!isRepeating(r) && !isNudgeOnly(r) && r.done) return 'done'
  if (isNudgeOnly(r)) return 'today'
  const occ = displayOccurrence(r, today)
  if (!occ) return 'nodue'
  const done = isDoneNow(r, today)
  const dueMs = occ.time ? atTime(occ.date, occ.time) : endOfDay(occ.date)
  if (!done && dueMs < now) return 'overdue'
  if (occ.date > today) return 'upcoming'
  return 'today'
}

/** Mô tả hạn để hiển thị, ví dụ "Hôm nay 14:30". */
export function describeDue(r: Reminder, now: number, occDate?: string): string {
  const today = dateStr(new Date(now))
  if (isNudgeOnly(r)) return 'Nhắc hàng ngày 9:00'
  const occ = displayOccurrence(r, today)
  const date = occDate ?? occ?.date
  if (!occ || !date) return ''
  const label =
    date === today ? 'Hôm nay' : date === addDays(today, 1) ? 'Ngày mai' : date === addDays(today, -1) ? 'Hôm qua' : parseDate(date).toLocaleDateString('vi-VN')
  return occ.time ? `${label} ${occ.time}` : label
}

/** My day hiện reminder của hôm nay và bấy nhiêu ngày tới. */
export const UPCOMING_DAYS = 3

/**
 * Các ngày xuất hiện của reminder trong khoảng (fromExcl, toIncl], chưa tick.
 * Reminder lặp có thể có nhiều ngày trong khoảng (ví dụ hằng ngày thì mỗi ngày một lần).
 */
export function occurrenceDatesBetween(r: Reminder, fromExcl: string, toIncl: string): string[] {
  if (r.deletedAt || !r.date || isNudgeOnly(r)) return []
  const step = stepOf(r)
  if (!step) return !r.done && r.date > fromExcl && r.date <= toIncl ? [r.date] : []
  return occurrencesBetween(r.date, step, fromExcl, toIncl).filter((d) => !r.doneDates.includes(d))
}

export function describeRepeat(r: Reminder): string {
  switch (r.repeat) {
    case 'daily':
      return 'Hằng ngày'
    case 'weekly':
      return r.weekdays?.length ? `Hằng tuần (${[...r.weekdays].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((d) => WEEKDAY_SHORT[d]).join(', ')})` : 'Hằng tuần'
    case 'monthly':
      if (r.monthlyMode === 'day') return `Hằng tháng, ngày ${r.monthlyDay ?? 1}`
      if (r.monthlyMode === 'nth') return `Hằng tháng, ${WEEKDAY_NAMES[r.monthlyWeekday ?? 1].toLowerCase()} ${r.monthlyNth === -1 ? 'tuần cuối' : `tuần ${r.monthlyNth ?? 1}`}`
      return 'Hằng tháng'
    case 'custom':
      return `Mỗi ${r.repeatEvery} ${r.repeatUnit === 'day' ? 'ngày' : r.repeatUnit === 'week' ? 'tuần' : 'tháng'}`
    default:
      return ''
  }
}

// ---- Tick, hoãn ----

/** Tick xong hoặc mở lại. Reminder lặp / nhắc hàng ngày chỉ gạch cho lần xuất hiện (ngày) hiện tại. */
export function toggleDone(r: Reminder, now: number): Reminder {
  const today = dateStr(new Date(now))
  const base = { ...r, snoozeUntil: null, updatedAt: now }
  if (isNudgeOnly(r) || isRepeating(r)) {
    const key = isNudgeOnly(r) ? today : displayOccurrence(r, today)!.date
    const has = r.doneDates.includes(key)
    return { ...base, doneDates: has ? r.doneDates.filter((d) => d !== key) : [...r.doneDates, key].slice(-400) }
  }
  return { ...base, done: !r.done, doneAt: r.done ? null : now }
}

export type SnoozeOption = '10m' | '1h' | 'tomorrow'
export const SNOOZE_LABELS: Record<SnoozeOption, string> = { '10m': '10 phút', '1h': '1 giờ', tomorrow: 'Ngày mai' }

export function snoozeUntil(option: SnoozeOption, now: number): number {
  if (option === '10m') return now + 10 * 60_000
  if (option === '1h') return now + 60 * 60_000
  return nineAm(addDays(dateStr(new Date(now)), 1))
}

export function snooze(r: Reminder, option: SnoozeOption, now: number): Reminder {
  return { ...r, snoozeUntil: snoozeUntil(option, now), updatedAt: now }
}

// ---- Mốc nhắc ----

export interface Trigger {
  at: number
  kind: NotifyKind
}

/**
 * Các mốc nhắc đã đến hạn (trong khoảng (firedAt, now]) của một reminder.
 * Gồm: đến hạn (giờ đã đặt, hoặc 9:00 nếu chỉ có ngày), nhắc hàng ngày 9:00, quá hạn 9:00 mỗi ngày.
 * Đang hoãn thì chưa có mốc nào; hết hoãn thì có một mốc "đến hạn".
 */
export function dueTriggers(r: Reminder, now: number): Trigger[] {
  if (r.deletedAt) return []
  if (!isRepeating(r) && !isNudgeOnly(r) && r.done) return []
  const from = r.firedAt ?? r.createdAt
  const today = dateStr(new Date(now))
  const out: Trigger[] = []

  if (r.snoozeUntil) {
    if (now < r.snoozeUntil) return []
    if (r.snoozeUntil > from) out.push({ at: r.snoozeUntil, kind: 'due' })
  }

  const lookStart = addDays(today, -LOOKBACK_DAYS)
  const fromDay = dateStr(new Date(Math.max(from, parseDate(lookStart).getTime())))
  const dueAt = (date: string) => (r.time ? atTime(date, r.time) : nineAm(date))
  const doneOn = (date: string) => (isRepeating(r) || isNudgeOnly(r) ? r.doneDates.includes(date) : r.done)

  // Đến hạn
  if (r.date) {
    const step = stepOf(r)
    const dates = step ? occurrencesBetween(r.date, step, addDays(fromDay, -1), today) : r.date >= fromDay && r.date <= today ? [r.date] : []
    for (const d of dates) {
      const t = dueAt(d)
      if (t > from && t <= now && !doneOn(d)) out.push({ at: t, kind: 'due' })
    }
  }

  // Nhắc hàng ngày 9:00
  if (r.dailyNudge) {
    for (let d = fromDay; d <= today; d = addDays(d, 1)) {
      const t = nineAm(d)
      if (t > from && t <= now && !doneOn(d) && !out.some((o) => o.at === t)) out.push({ at: t, kind: 'daily' })
    }
  }

  // Quá hạn: 9:00 các ngày sau hạn, khi vẫn chưa tick
  if (r.date && !isNudgeOnly(r)) {
    const occ = currentOccurrence(r, today)
    if (occ && !doneOn(occ.date)) {
      const dueMs = occ.time ? atTime(occ.date, occ.time) : endOfDay(occ.date)
      if (dueMs < now) {
        for (let d = addDays(occ.date, 1); d <= today; d = addDays(d, 1)) {
          const t = nineAm(d)
          if (t > from && t <= now && t > dueMs && !out.some((o) => o.at === t)) out.push({ at: t, kind: 'overdue' })
        }
      }
    }
  }

  return out.sort((a, b) => a.at - b.at)
}

export interface FirePlan {
  /** Mốc cần thông báo ngay (app đang chạy). */
  live: Trigger[]
  /** Mốc đã trễ (lỡ khi app đóng): chỉ ghi vào trung tâm thông báo. */
  missed: Trigger[]
  /** Giá trị firedAt mới sau khi xử lý. */
  firedAt: number
}

export function planFire(r: Reminder, now: number): FirePlan | null {
  const all = dueTriggers(r, now)
  if (!all.length) return null
  const live = all.filter((t) => now - t.at <= MISSED_AFTER_MS).slice(-1)
  const missed = all.filter((t) => now - t.at > MISSED_AFTER_MS).slice(-3)
  return { live, missed, firedAt: now }
}

// ---- Giờ yên lặng ----

export interface QuietHours {
  enabled: boolean
  from: string
  to: string
}

export function inQuietHours(q: QuietHours, now: number): boolean {
  if (!q.enabled) return false
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  const [fh, fm] = q.from.split(':').map(Number)
  const [th, tm] = q.to.split(':').map(Number)
  const from = fh * 60 + fm
  const to = th * 60 + tm
  if (from === to) return false
  return from < to ? cur >= from && cur < to : cur >= from || cur < to
}

// ---- Thông báo trong app ----

export function makeNotification(r: Reminder, kind: NotifyKind, at: number): AppNotification {
  return { v: FORMAT_VERSION, id: newId(), reminderId: r.id, kind, title: r.title, at, readAt: null }
}

export const NOTIFY_LABELS: Record<NotifyKind, string> = {
  due: 'Đến giờ',
  daily: 'Nhắc hàng ngày',
  overdue: 'Quá hạn',
  missed: 'Đã lỡ',
  event: 'Sự kiện'
}

/** Sắp xếp danh sách: ngôi sao lên đầu, rồi theo hạn gần nhất. */
export function sortReminders(list: Reminder[], now: number): Reminder[] {
  const today = dateStr(new Date(now))
  const key = (r: Reminder) => {
    const occ = displayOccurrence(r, today)
    return occ ? `${occ.date} ${occ.time ?? '99:99'}` : '9999'
  }
  return [...list].sort((a, b) => Number(b.starred) - Number(a.starred) || key(a).localeCompare(key(b)) || a.createdAt - b.createdAt)
}
