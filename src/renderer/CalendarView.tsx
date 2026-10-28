import { useEffect, useMemo, useRef, useState } from 'react'
import { layoutDay, occurrencesBetween, touchesDay, wallToMs, type CalEvent, type CalendarSource, type Occurrence } from '@core/calendar'
import { addDays, addMonths, dateStr, isNudgeOnly, occurrenceDatesBetween, parseDate } from '@core/reminders'
import type { Reminder } from '@core/types'

type View = 'day' | 'week' | 'month'

const HOUR_H = 52
const SNAP = 30
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const VIEW_KEY = 'ntp-calendar-view'

const hm = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
const mondayOf = (date: string) => addDays(date, -((parseDate(date).getDay() + 6) % 7))

interface RemItem {
  r: Reminder
  date: string
  start: number
  end: number
}

interface Props {
  calendars: CalendarSource[]
  events: CalEvent[]
  reminders: Reminder[]
  now: number
  onNewEvent: (start: number, end: number, allDay: boolean) => void
  onOpenEvent: (occ: Occurrence) => void
  onOpenReminder: (r: Reminder) => void
  onToggleCalendar: (c: CalendarSource) => void
  /** Khu vực dưới danh sách lịch (nút kết nối Google, thêm link iCal). */
  sidebarExtra?: React.ReactNode
}

export function CalendarView({ calendars, events, reminders, now, onNewEvent, onOpenEvent, onOpenReminder, onToggleCalendar, sidebarExtra }: Props) {
  const [view, setView] = useState<View>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY)
      return v === 'day' || v === 'week' || v === 'month' ? v : 'week'
    } catch {
      return 'week'
    }
  })
  const [anchor, setAnchor] = useState(() => dateStr(new Date(now)))
  const today = dateStr(new Date(now))
  const scroller = useRef<HTMLDivElement>(null)

  const changeView = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* không lưu được thì bỏ qua */
    }
  }

  // Khoảng ngày đang xem
  const days = useMemo(() => {
    if (view === 'day') return [anchor]
    if (view === 'week') {
      const m = mondayOf(anchor)
      return Array.from({ length: 7 }, (_, i) => addDays(m, i))
    }
    const first = anchor.slice(0, 8) + '01'
    const start = mondayOf(first)
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [view, anchor])

  const rangeStart = wallToMs(days[0], 0, null)
  const rangeEnd = wallToMs(addDays(days[days.length - 1], 1), 0, null)

  const visibleIds = useMemo(() => new Set(calendars.filter((c) => c.visible).map((c) => c.id)), [calendars])
  const colorOf = (id: string) => calendars.find((c) => c.id === id)?.color ?? '#7c6cf0'

  const occs = useMemo(
    () => occurrencesBetween(events.filter((e) => visibleIds.has(e.calendarId)), rangeStart, rangeEnd),
    [events, visibleIds, rangeStart, rangeEnd]
  )

  // Reminder có giờ cũng hiện trên lịch
  const remItems = useMemo<RemItem[]>(() => {
    const out: RemItem[] = []
    const from = addDays(days[0], -1)
    const to = days[days.length - 1]
    for (const r of reminders) {
      if (r.deletedAt || !r.date || !r.time || isNudgeOnly(r)) continue
      for (const date of occurrenceDatesBetween(r, from, to)) {
        const [h, m] = r.time.split(':').map(Number)
        const start = wallToMs(date, h * 60 + m, null)
        out.push({ r, date, start, end: start + 30 * 60_000 })
      }
    }
    return out
  }, [reminders, days])

  const dayOccs = (date: string): Occurrence[] => occs.filter((o) => touchesDay(o, date))

  // Điều hướng
  const shift = (dir: -1 | 1) => {
    if (view === 'month') setAnchor(addMonths(anchor.slice(0, 8) + '01', dir))
    else setAnchor(addDays(anchor, dir * (view === 'week' ? 7 : 1)))
  }
  const title =
    view === 'month'
      ? `Tháng ${Number(anchor.slice(5, 7))}, ${anchor.slice(0, 4)}`
      : view === 'week'
        ? `${parseDate(days[0]).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} – ${parseDate(days[6]).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
        : parseDate(anchor).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })

  // Lần đầu vào chế độ có lưới giờ: cuộn tới khoảng giờ làm việc
  useEffect(() => {
    if (view !== 'month' && scroller.current) scroller.current.scrollTop = 7 * HOUR_H
  }, [view])

  const clickSlot = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = Math.floor(((e.clientY - rect.top) / HOUR_H) * 60 / SNAP) * SNAP
    const start = wallToMs(date, minutes, null)
    onNewEvent(start, start + 60 * 60_000, false)
  }

  return (
    <div className="cal-page">
      <header className="main-head cal-head">
        <h1>Calendar</h1>
        <div className="cal-nav">
          <button onClick={() => setAnchor(today)}>Hôm nay</button>
          <button className="icon" onClick={() => shift(-1)} title="Trước">
            ‹
          </button>
          <button className="icon" onClick={() => shift(1)} title="Sau">
            ›
          </button>
          <b className="cal-title">{title}</b>
        </div>
        <div className="cal-actions">
          <div className="seg">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => changeView(v)}>
                {v === 'day' ? 'Ngày' : v === 'week' ? 'Tuần' : 'Tháng'}
              </button>
            ))}
          </div>
          <button
            className="primary"
            onClick={() => {
              const s = Math.ceil(Date.now() / 3_600_000) * 3_600_000
              onNewEvent(s, s + 3_600_000, false)
            }}
          >
            ＋ Sự kiện
          </button>
        </div>
      </header>

      <div className="cal-body">
        <aside className="cal-side">
          <b>Lịch</b>
          <ul>
            {calendars.map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={c.visible} onChange={() => onToggleCalendar(c)} style={{ accentColor: c.color }} />
                  <span className="dot" style={{ background: c.color }} />
                  <span className="name">{c.name}</span>
                  {c.readOnly && <small title="Chỉ đọc">🔒</small>}
                </label>
              </li>
            ))}
          </ul>
          {sidebarExtra}
        </aside>

        {view === 'month' ? (
          <MonthGrid
            days={days}
            month={anchor.slice(0, 7)}
            today={today}
            dayOccs={dayOccs}
            remItems={remItems}
            colorOf={colorOf}
            onOpenEvent={onOpenEvent}
            onOpenReminder={onOpenReminder}
            onPickDay={(d) => {
              setAnchor(d)
              changeView('day')
            }}
            onNewOnDay={(d) => {
              const s = wallToMs(d, 9 * 60, null)
              onNewEvent(s, s + 3_600_000, false)
            }}
          />
        ) : (
          <TimeGrid
            days={days}
            today={today}
            now={now}
            scroller={scroller}
            dayOccs={dayOccs}
            remItems={remItems}
            colorOf={colorOf}
            onOpenEvent={onOpenEvent}
            onOpenReminder={onOpenReminder}
            onClickSlot={clickSlot}
            onNewAllDay={(d) => onNewEvent(wallToMs(d, 0, null), wallToMs(addDays(d, 1), 0, null), true)}
          />
        )}
      </div>
    </div>
  )
}

interface GridCommon {
  days: string[]
  today: string
  dayOccs: (date: string) => Occurrence[]
  remItems: RemItem[]
  colorOf: (calendarId: string) => string
  onOpenEvent: (o: Occurrence) => void
  onOpenReminder: (r: Reminder) => void
}

function MonthGrid({
  days,
  month,
  today,
  dayOccs,
  remItems,
  colorOf,
  onOpenEvent,
  onOpenReminder,
  onPickDay,
  onNewOnDay
}: GridCommon & { month: string; onPickDay: (d: string) => void; onNewOnDay: (d: string) => void }) {
  return (
    <div className="cal-month">
      {WEEKDAYS.map((w, i) => (
        <div key={w} className={`wd ${i >= 5 ? 'we' : ''}`}>
          {w}
        </div>
      ))}
      {days.map((d) => {
        const items = [
          ...dayOccs(d).map((o) => ({ kind: 'event' as const, start: o.allDay ? -1 : o.start, o })),
          ...remItems.filter((x) => x.date === d).map((x) => ({ kind: 'rem' as const, start: x.start, x }))
        ].sort((a, b) => a.start - b.start)
        const shown = items.slice(0, 3)
        return (
          <div
            key={d}
            className={`cal-cell ${d.slice(0, 7) === month ? '' : 'out'} ${d === today ? 'today' : ''}`}
            onClick={() => onNewOnDay(d)}
          >
            <button className="num" onClick={(e) => (e.stopPropagation(), onPickDay(d))} title="Xem ngày này">
              {Number(d.slice(8))}
            </button>
            {shown.map((it) =>
              it.kind === 'event' ? (
                <button
                  key={it.o.key + d}
                  className={`chip ${it.o.allDay ? 'allday' : ''}`}
                  style={{ ['--c' as string]: colorOf(it.o.event.calendarId) }}
                  onClick={(e) => (e.stopPropagation(), onOpenEvent(it.o))}
                  title={it.o.event.title}
                >
                  {!it.o.allDay && <i>{hm(it.o.start)}</i>}
                  {it.o.event.title}
                </button>
              ) : (
                <button key={it.x.r.id + d} className="chip rem" onClick={(e) => (e.stopPropagation(), onOpenReminder(it.x.r))} title="Reminder">
                  <i>⏰ {hm(it.x.start)}</i>
                  {it.x.r.title}
                </button>
              )
            )}
            {items.length > 3 && (
              <button className="more" onClick={(e) => (e.stopPropagation(), onPickDay(d))}>
                +{items.length - 3} nữa
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TimeGrid({
  days,
  today,
  now,
  scroller,
  dayOccs,
  remItems,
  colorOf,
  onOpenEvent,
  onOpenReminder,
  onClickSlot,
  onNewAllDay
}: GridCommon & {
  now: number
  scroller: React.RefObject<HTMLDivElement | null>
  onClickSlot: (e: React.MouseEvent<HTMLDivElement>, date: string) => void
  onNewAllDay: (date: string) => void
}) {
  const nowDate = dateStr(new Date(now))
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const cols = `52px repeat(${days.length}, minmax(0, 1fr))`

  return (
    <div className="cal-time">
      <div className="cal-time-head" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((d) => (
          <div key={d} className={`dh ${d === today ? 'today' : ''}`}>
            <small>{WEEKDAYS[(parseDate(d).getDay() + 6) % 7]}</small>
            <b>{Number(d.slice(8))}</b>
          </div>
        ))}
      </div>
      <div className="cal-allday" style={{ gridTemplateColumns: cols }}>
        <span className="lbl">Cả ngày</span>
        {days.map((d) => (
          <div key={d} className="ad" onClick={() => onNewAllDay(d)}>
            {dayOccs(d)
              .filter((o) => o.allDay)
              .map((o) => (
                <button
                  key={o.key + d}
                  className="chip allday"
                  style={{ ['--c' as string]: colorOf(o.event.calendarId) }}
                  onClick={(e) => (e.stopPropagation(), onOpenEvent(o))}
                  title={o.event.title}
                >
                  {o.event.title}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="cal-scroll" ref={scroller}>
        <div className="cal-grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_H }}>
          <div className="hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR_H }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const dayStart = wallToMs(d, 0, null)
            const dayEnd = wallToMs(addDays(d, 1), 0, null)
            const timed = dayOccs(d)
              .filter((o) => !o.allDay)
              .map((o) => ({ ...o, start: Math.max(o.start, dayStart), end: Math.min(o.end, dayEnd) }))
            const placed = layoutDay(timed)
            const rems = remItems.filter((x) => x.date === d)
            return (
              <div key={d} className={`cal-col ${d === today ? 'today' : ''}`} onClick={(e) => onClickSlot(e, d)}>
                {placed.map((p) => {
                  const top = ((p.occ.start - dayStart) / 3_600_000) * HOUR_H
                  const height = Math.max(((p.occ.end - p.occ.start) / 3_600_000) * HOUR_H - 2, 20)
                  const orig = dayOccs(d).find((o) => o.key === p.occ.key)!
                  return (
                    <button
                      key={p.occ.key + d}
                      className="ev"
                      style={{
                        top,
                        height,
                        left: `${(p.column / p.columns) * 100}%`,
                        width: `calc(${100 / p.columns}% - 3px)`,
                        ['--c' as string]: colorOf(p.occ.event.calendarId)
                      }}
                      onClick={(e) => (e.stopPropagation(), onOpenEvent(orig))}
                      title={p.occ.event.title}
                    >
                      <b>{p.occ.event.title}</b>
                      {height > 34 && <small>{hm(orig.start)} – {hm(orig.end)}</small>}
                    </button>
                  )
                })}
                {rems.map((x) => {
                  const top = ((x.start - dayStart) / 3_600_000) * HOUR_H
                  return (
                    <button
                      key={x.r.id + x.date}
                      className="ev rem"
                      style={{ top, height: 22, left: 0, width: 'calc(100% - 3px)' }}
                      onClick={(e) => (e.stopPropagation(), onOpenReminder(x.r))}
                      title="Reminder"
                    >
                      ⏰ {x.r.title}
                    </button>
                  )
                })}
                {d === nowDate && <div className="now-line" style={{ top: (nowMin / 60) * HOUR_H }} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
