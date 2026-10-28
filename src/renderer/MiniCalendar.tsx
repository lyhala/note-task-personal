import { useMemo, useState } from 'react'
import { addDays, dateStr, occurrenceDatesBetween } from '@core/reminders'
import { occurrencesBetween, wallToMs, type CalEvent, type CalendarSource } from '@core/calendar'
import type { Reminder } from '@core/types'

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

interface Props {
  reminders: Reminder[]
  now: number
  events?: CalEvent[]
  calendars?: CalendarSource[]
}

/** Lịch tháng nhỏ ở My day: đánh dấu hôm nay, và chấm những ngày có reminder chưa xong. */
export function MiniCalendar({ reminders, now, events = [], calendars = [] }: Props) {
  const today = dateStr(new Date(now))
  const [shown, setShown] = useState(() => {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  // Lưới 6 tuần, tuần bắt đầu từ thứ Hai.
  const cells = useMemo(() => {
    const offset = (shown.getDay() + 6) % 7
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(shown.getFullYear(), shown.getMonth(), 1 - offset + i)
      return { date: dateStr(d), day: d.getDate(), inMonth: d.getMonth() === shown.getMonth(), weekend: i % 7 >= 5 }
    })
  }, [shown])

  const marks = useMemo(() => {
    const m = new Map<string, number>()
    const from = addDays(cells[0].date, -1)
    const to = cells[41].date
    for (const r of reminders) for (const d of occurrenceDatesBetween(r, from, to)) m.set(d, (m.get(d) ?? 0) + 1)
    // Sự kiện lịch của các lịch đang bật cũng đánh dấu ngày (sự kiện nhiều ngày thì đánh dấu từng ngày)
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id))
    const occs = occurrencesBetween(events.filter((e) => visible.has(e.calendarId)), wallToMs(cells[0].date, 0, null), wallToMs(addDays(to, 1), 0, null))
    for (const o of occs) {
      let d = dateStr(new Date(o.start))
      const last = dateStr(new Date(Math.max(o.start, o.end - 1)))
      for (let i = 0; i < 31 && d <= last; i++, d = addDays(d, 1)) m.set(d, (m.get(d) ?? 0) + 1)
    }
    return m
  }, [reminders, cells, events, calendars])

  const go = (delta: number) => setShown((s) => new Date(s.getFullYear(), s.getMonth() + delta, 1))
  const isCurrent = shown.getFullYear() === new Date(now).getFullYear() && shown.getMonth() === new Date(now).getMonth()

  return (
    <section className="minical card">
      <div className="minical-head">
        <b>Lịch</b>
        {!isCurrent && (
          <button className="today-btn" onClick={() => setShown(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1))}>
            Hôm nay
          </button>
        )}
      </div>
      <div className="minical-nav">
        <button className="icon" onClick={() => go(-1)} title="Tháng trước">
          ‹
        </button>
        <span>
          Tháng {shown.getMonth() + 1}, {shown.getFullYear()}
        </span>
        <button className="icon" onClick={() => go(1)} title="Tháng sau">
          ›
        </button>
      </div>
      <div className="minical-grid">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={`wd ${i >= 5 ? 'we' : ''}`}>
            {w}
          </span>
        ))}
        {cells.map((c) => {
          const n = marks.get(c.date) ?? 0
          return (
            <span
              key={c.date}
              className={`day ${c.inMonth ? '' : 'out'} ${c.weekend ? 'we' : ''} ${c.date === today ? 'today' : ''}`}
              title={n ? `${n} reminder` : undefined}
            >
              {c.day}
              {n > 0 && <i />}
            </span>
          )
        })}
      </div>
    </section>
  )
}
