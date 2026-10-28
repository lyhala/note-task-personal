import { useMemo, useState } from 'react'
import { NO_REMINDER, msToWall, newEvent, wallToMs, type CalEvent, type CalendarSource } from '@core/calendar'
import { addDays } from '@core/reminders'

const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Mặc định' },
  { value: NO_REMINDER, label: 'Không nhắc' },
  { value: 0, label: 'Đúng giờ bắt đầu' },
  { value: 5, label: 'Trước 5 phút' },
  { value: 10, label: 'Trước 10 phút' },
  { value: 15, label: 'Trước 15 phút' },
  { value: 30, label: 'Trước 30 phút' },
  { value: 60, label: 'Trước 1 giờ' },
  { value: 1440, label: 'Trước 1 ngày' }
]

type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

const WEEKDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const systemTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

function repeatOf(rrule: string | null): Repeat {
  if (!rrule) return 'none'
  const r = rrule.replace(/^RRULE:/i, '')
  if (/^FREQ=DAILY$/i.test(r)) return 'daily'
  if (/^FREQ=WEEKLY(;BYDAY=[A-Z]{2})?$/i.test(r)) return 'weekly'
  if (/^FREQ=MONTHLY$/i.test(r)) return 'monthly'
  if (/^FREQ=YEARLY$/i.test(r)) return 'yearly'
  return 'custom'
}

function ruleFor(repeat: Repeat, date: string, keep: string | null): string | null {
  const wd = WEEKDAY[new Date(date + 'T00:00:00').getDay()]
  switch (repeat) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${wd}`
    case 'monthly':
      return 'FREQ=MONTHLY'
    case 'yearly':
      return 'FREQ=YEARLY'
    case 'custom':
      return keep
    default:
      return null
  }
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export interface EventDraft {
  /** Sự kiện đang sửa; null = tạo mới. */
  event: CalEvent | null
  /** Gợi ý khi tạo mới (bấm vào ô trên lưới). */
  start?: number
  end?: number
  allDay?: boolean
  calendarId?: string
  /** Lần xảy ra đang mở (để xóa riêng một lần của chuỗi lặp). */
  occurrenceStart?: number
}

interface Props {
  draft: EventDraft
  calendars: CalendarSource[]
  defaultReminder: number
  onSave: (e: CalEvent) => void
  onDelete: (e: CalEvent, scope: 'all' | 'this', occurrenceStart?: number) => void
  onCancel: () => void
}

export function EventDialog({ draft, calendars, defaultReminder, onSave, onDelete, onCancel }: Props) {
  const base = useMemo<CalEvent>(() => {
    if (draft.event) return draft.event
    const start = draft.start ?? Math.ceil(Date.now() / 3_600_000) * 3_600_000
    const e = newEvent({ start, end: draft.end ?? start + 3_600_000, allDay: !!draft.allDay, tz: systemTz() })
    if (e.allDay) {
      const w = msToWall(start, null)
      e.startDate = w.date
      e.endDate = w.date
    }
    return e
  }, [draft])

  const writable = calendars.filter((c) => !c.readOnly)
  const cal = calendars.find((c) => c.id === (draft.event?.calendarId ?? draft.calendarId ?? writable[0]?.id))
  const readOnly = !!draft.event && !!calendars.find((c) => c.id === draft.event!.calendarId)?.readOnly

  const [title, setTitle] = useState(base.title)
  const [calendarId, setCalendarId] = useState(cal?.id ?? writable[0]?.id ?? '')
  const [allDay, setAllDay] = useState(base.allDay)
  const startWall = msToWall(base.start, null)
  const endWall = msToWall(base.end, null)
  const [startDate, setStartDate] = useState(base.allDay ? (base.startDate ?? startWall.date) : startWall.date)
  const [startTime, setStartTime] = useState(hhmm(startWall.minutes))
  // Sự kiện mới: ngày kết thúc mặc định bằng ngày bắt đầu (kể cả khi bắt đầu lúc 23:xx), người dùng muốn thì sửa sau.
  const isNew = !draft.event
  const [endDate, setEndDate] = useState(base.allDay ? (base.endDate ?? base.startDate ?? startWall.date) : isNew ? startWall.date : endWall.date)
  const [endTime, setEndTime] = useState(hhmm(isNew && endWall.date !== startWall.date ? 23 * 60 + 59 : endWall.minutes))
  const [location, setLocation] = useState(base.location)
  const [description, setDescription] = useState(base.description)
  const [repeat, setRepeat] = useState<Repeat>(repeatOf(base.rrule))
  const [reminder, setReminder] = useState<number | null>(base.reminderMinutes)
  const [error, setError] = useState('')

  const recurring = !!base.rrule
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (readOnly) return
    if (!title.trim()) return setError('Hãy nhập tiêu đề')
    if (!calendarId) return setError('Chưa có lịch nào để lưu sự kiện')
    const tz = base.tz ?? systemTz()
    let start: number
    let end: number
    let sDate: string | null = null
    let eDate: string | null = null
    if (allDay) {
      if (endDate < startDate) return setError('Ngày kết thúc phải sau ngày bắt đầu')
      sDate = startDate
      eDate = endDate
      start = wallToMs(startDate, 0, null)
      end = wallToMs(addDays(endDate, 1), 0, null)
    } else {
      start = wallToMs(startDate, toMinutes(startTime), tz)
      end = wallToMs(endDate, toMinutes(endTime), tz)
      if (end <= start) return setError('Giờ kết thúc phải sau giờ bắt đầu')
    }
    onSave({
      ...base,
      title: title.trim(),
      calendarId,
      allDay,
      start,
      end,
      startDate: sDate,
      endDate: eDate,
      tz: allDay ? null : tz,
      location,
      description,
      rrule: ruleFor(repeat, startDate, base.rrule),
      reminderMinutes: reminder,
      updatedAt: Date.now()
    })
  }

  const attendees = base.attendees

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog event-dialog" onSubmit={submit}>
        <h2>{readOnly ? 'Sự kiện (chỉ đọc)' : draft.event ? 'Sửa sự kiện' : 'Sự kiện mới'}</h2>
        <label>
          Tiêu đề
          <input autoFocus={!draft.event} value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} placeholder="Tên sự kiện" />
        </label>

        <label>
          Lịch
          <select value={calendarId} disabled={readOnly || !!draft.event} onChange={(e) => setCalendarId(e.target.value)}>
            {(readOnly ? calendars : writable).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="check">
          <input type="checkbox" checked={allDay} disabled={readOnly} onChange={(e) => setAllDay(e.target.checked)} />
          Cả ngày
        </label>
        <div className="row2">
          <label>
            Bắt đầu
            <input
              type="date"
              value={startDate}
              disabled={readOnly}
              onChange={(e) => {
                // Ngày kết thúc đi theo ngày bắt đầu nếu đang trùng nhau (hoặc bị bỏ lại phía trước).
                if (endDate === startDate || e.target.value > endDate) setEndDate(e.target.value)
                setStartDate(e.target.value)
              }}
            />
          </label>
          {!allDay && (
            <label>
              Giờ
              <input type="time" value={startTime} disabled={readOnly} onChange={(e) => setStartTime(e.target.value)} />
            </label>
          )}
        </div>
        <div className="row2">
          <label>
            Kết thúc
            <input type="date" value={endDate} min={startDate} disabled={readOnly} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          {!allDay && (
            <label>
              Giờ
              <input type="time" value={endTime} disabled={readOnly} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          )}
        </div>

        <label>
          Địa điểm hoặc link họp
          <input value={location} disabled={readOnly} onChange={(e) => setLocation(e.target.value)} placeholder="Phòng họp, hoặc https://meet.google.com/..." />
        </label>
        {/^https?:\/\//.test(location.trim()) && (
          <a className="meet-link" href={location.trim()} target="_blank" rel="noreferrer">
            Mở link họp ↗
          </a>
        )}

        <div className="row2">
          <label>
            Lặp lại
            <select value={repeat} disabled={readOnly} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              <option value="none">Không lặp</option>
              <option value="daily">Hằng ngày</option>
              <option value="weekly">Hằng tuần</option>
              <option value="monthly">Hằng tháng</option>
              <option value="yearly">Hằng năm</option>
              {repeat === 'custom' && <option value="custom">Tùy chỉnh (giữ nguyên)</option>}
            </select>
          </label>
          <label>
            Nhắc
            <select value={String(reminder)} disabled={readOnly} onChange={(e) => setReminder(e.target.value === 'null' ? null : Number(e.target.value))}>
              {REMINDER_OPTIONS.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.value === null ? `Mặc định (${defaultReminder} phút)` : o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Mô tả
          <textarea rows={3} value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {attendees.length > 0 && (
          <div className="attendees">
            <span className="lbl">Người tham dự ({attendees.length})</span>
            <ul>
              {attendees.map((a) => (
                <li key={a.email} className={a.response ?? ''}>
                  {a.name || a.email}
                  {a.organizer && <small> · người tổ chức</small>}
                  {a.response === 'declined' && <small> · từ chối</small>}
                  {a.response === 'accepted' && <small> · đã nhận</small>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="bad">{error}</p>}
        <div className="dialog-actions">
          {draft.event && !readOnly && (
            <>
              {recurring && draft.occurrenceStart !== undefined && (
                <button type="button" className="danger" onClick={() => onDelete(base, 'this', draft.occurrenceStart)}>
                  Xóa lần này
                </button>
              )}
              <button type="button" className="danger" onClick={() => onDelete(base, 'all')}>
                {recurring ? 'Xóa cả chuỗi' : 'Xóa'}
              </button>
            </>
          )}
          <span className="grow" />
          <button type="button" onClick={onCancel}>
            {readOnly ? 'Đóng' : 'Hủy'}
          </button>
          {!readOnly && (
            <button className="primary" type="submit">
              Lưu
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

