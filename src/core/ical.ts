// Đọc file iCal (.ics) thành sự kiện của app. Không phụ thuộc Electron.

import { wallToMs, type CalEvent, type CalendarSource } from './calendar'
import { addDays } from './reminders'
import { FORMAT_VERSION } from './types'

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

const unescapeText = (s: string): string => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

/** Dấu ':' đầu tiên nằm ngoài dấu nháy kép (giá trị tham số có thể chứa ':'). */
function findColon(line: string): number {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) return i
  }
  return -1
}

function parseLines(text: string): Prop[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const out: Prop[] = []
  for (const line of lines) {
    const colon = findColon(line)
    if (colon < 0) continue
    const [name, ...ps] = line.slice(0, colon).split(';')
    const params: Record<string, string> = {}
    for (const p of ps) {
      const eq = p.indexOf('=')
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
    }
    out.push({ name: name.toUpperCase(), params, value: line.slice(colon + 1) })
  }
  return out
}

function validTz(tz: string | undefined): string | null {
  if (!tz) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null // tên múi giờ của Windows hoặc không hợp lệ: coi như giờ trên máy này
  }
}

interface When {
  ms: number
  date: string
  allDay: boolean
  tz: string | null
}

function parseWhen(p: Prop): When | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(p.value.trim())
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (m[4] === undefined) return { ms: wallToMs(date, 0, null), date, allDay: true, tz: null }
  if (m[7]) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)), date, allDay: false, tz: null }
  const tz = validTz(p.params.TZID)
  return { ms: wallToMs(date, Number(m[4]) * 60 + Number(m[5]), tz) + Number(m[6] ?? 0) * 1000, date, allDay: false, tz }
}

function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return 0
  const ms = (+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400_000 + +(m[4] ?? 0) * 3_600_000 + +(m[5] ?? 0) * 60_000 + +(m[6] ?? 0) * 1000
  return m[1] === '-' ? -ms : ms
}

export function parseIcs(text: string, cal: CalendarSource): CalEvent[] {
  const blocks: Prop[][] = []
  let cur: Prop[] | null = null
  for (const p of parseLines(text)) {
    if (p.name === 'BEGIN' && p.value === 'VEVENT') cur = []
    else if (p.name === 'END' && p.value === 'VEVENT') {
      if (cur) blocks.push(cur)
      cur = null
    } else if (cur) cur.push(p)
  }

  const now = Date.now()
  const events: CalEvent[] = []
  const masters = new Map<string, CalEvent>()
  const overrides: { uid: string; at: When }[] = []

  for (const b of blocks) {
    const get = (n: string) => b.find((p) => p.name === n)
    if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') continue
    const startP = get('DTSTART')
    const start = startP && parseWhen(startP)
    if (!start) continue
    const uid = get('UID')?.value ?? `${start.ms}-${get('SUMMARY')?.value ?? ''}`
    const recId = get('RECURRENCE-ID')
    const endP = get('DTEND')
    const end = endP && parseWhen(endP)
    const dur = get('DURATION')

    let startMs = start.ms
    let endMs: number
    let startDate: string | null = null
    let endDate: string | null = null
    if (start.allDay) {
      const endExclusive = end?.date ?? addDays(start.date, 1)
      endDate = endExclusive > start.date ? addDays(endExclusive, -1) : start.date
      startDate = start.date
      startMs = wallToMs(start.date, 0, null)
      endMs = wallToMs(addDays(endDate, 1), 0, null)
    } else {
      endMs = end ? end.ms : dur ? startMs + parseDuration(dur.value) : startMs
    }

    const exdates: (string | number)[] = []
    for (const p of b.filter((x) => x.name === 'EXDATE')) {
      for (const v of p.value.split(',')) {
        const w = parseWhen({ ...p, value: v })
        if (w) exdates.push(start.allDay ? w.date : w.ms)
      }
    }

    const url = get('URL')?.value ?? ''
    const ev: CalEvent = {
      v: FORMAT_VERSION,
      id: `i:${cal.id}:${uid}${recId ? `#${recId.value}` : ''}`,
      calendarId: cal.id,
      title: unescapeText(get('SUMMARY')?.value ?? '') || '(Không có tiêu đề)',
      description: unescapeText(get('DESCRIPTION')?.value ?? ''),
      location: unescapeText(get('LOCATION')?.value ?? ''),
      allDay: start.allDay,
      start: startMs,
      end: Math.max(endMs, startMs),
      startDate,
      endDate,
      tz: start.allDay ? null : start.tz,
      rrule: recId ? null : (get('RRULE')?.value ?? null),
      exdates,
      reminderMinutes: null,
      attendees: [],
      link: /^https?:/i.test(url) ? url : '',
      remote: { id: uid, recurringId: recId ? uid : null },
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    }
    if (recId) {
      const at = parseWhen(recId)
      if (at) overrides.push({ uid, at })
    } else masters.set(uid, ev)
    events.push(ev)
  }

  // Một lần bị sửa riêng của chuỗi lặp: loại lần gốc ra khỏi chuỗi để không hiện hai lần.
  for (const o of overrides) {
    const m = masters.get(o.uid)
    if (m) m.exdates.push(m.allDay ? o.at.date : o.at.ms)
  }
  return events
}
