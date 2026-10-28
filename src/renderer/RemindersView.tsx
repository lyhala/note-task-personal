import { useMemo, useState } from 'react'
import {
  SNOOZE_LABELS,
  addDays,
  bucketOf,
  dateStr,
  describeDue,
  describeRepeat,
  displayOccurrence,
  isDoneNow,
  isNudgeOnly,
  isRepeating,
  occurrenceDatesBetween,
  parseDate,
  sortReminders,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  type Bucket,
  type SnoozeOption
} from '@core/reminders'
import cheerCard from './assets/cheer-card.webp'
import { attendeeNames, formatRange, withoutPushedDuplicates, occurrencesBetween, touchesDay, wallToMs, type CalEvent, type CalendarSource, type Occurrence } from '@core/calendar'
import { MiniCalendar } from './MiniCalendar'
import { displayTitle, newId, newReminder, type Note, type RepeatKind, type RepeatUnit, type Reminder } from '@core/types'

export interface RowActions {
  onToggle: (r: Reminder) => void
  onStar: (r: Reminder) => void
  onSnooze: (r: Reminder, option: SnoozeOption) => void
  onEdit: (r: Reminder) => void
  onDelete: (r: Reminder) => void
  onOpenNote: (noteId: string) => void
  /** Tạo một note từ reminder này để thêm nội dung. */
  onCreateNote: (r: Reminder) => void
  /** Thông báo ngắn (toast). */
  onNotice: (msg: string) => void
}

const formatSize = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

interface RowProps {
  r: Reminder
  now: number
  a: RowActions
  /** Hiển thị một lần xuất hiện cụ thể (reminder lặp trong danh sách "ngày tới"). */
  occDate?: string
  /** Lần xuất hiện sau này của reminder lặp: chỉ để xem, chưa tick hay hoãn được. */
  readOnly?: boolean
}

export function ReminderRow({ r, now, a, occDate, readOnly }: RowProps) {
  const today = dateStr(new Date(now))
  const done = !readOnly && isDoneNow(r, today)
  const bucket = readOnly ? 'upcoming' : bucketOf(r, now)
  const due = describeDue(r, now, occDate)
  const repeat = describeRepeat(r)
  return (
    <li className={`rem ${done ? 'done' : ''} ${bucket === 'overdue' ? 'late' : ''} ${readOnly ? 'future' : ''}`}>
      <input type="checkbox" checked={done} disabled={readOnly} onChange={() => a.onToggle(r)} title={done ? 'Mở lại' : 'Đánh dấu xong'} />
      <button className={`star ${r.starred ? 'on' : ''}`} onClick={() => a.onStar(r)} title="Ngôi sao">
        {r.starred ? '★' : '☆'}
      </button>
      <div className="rem-main" onDoubleClick={() => a.onEdit(r)}>
        <span className="rem-title">{r.title}</span>
        <span className="rem-meta">
          {due && <span className={bucket === 'overdue' ? 'late' : ''}>{due}</span>}
          {repeat && <span>🔁 {repeat}</span>}
          {r.dailyNudge && !isNudgeOnly(r) && <span>⏰ Nhắc hàng ngày</span>}
          {r.snoozeUntil && r.snoozeUntil > now && (
            <span>😴 Hoãn đến {new Date(r.snoozeUntil).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
          )}
          {r.noteId && (
            <button className="linkish" onClick={() => a.onOpenNote(r.noteId!)}>
              📝 Note gốc
            </button>
          )}
          {r.link && (
            <a href={r.link} target="_blank" rel="noreferrer">
              🔗 Link
            </a>
          )}
          {(r.attachments ?? []).map((att) => (
            <button key={att.id} className="linkish" title={att.name} onClick={() => void window.api.attachments.open(att).then((x) => !x.ok && x.error && a.onNotice(x.error))}>
              📎 {att.name.length > 22 ? att.name.slice(0, 20) + '…' : att.name}
            </button>
          ))}
        </span>
        {r.notes && <span className="rem-notes">{r.notes}</span>}
      </div>
      <div className="rem-actions">
        {!done && !readOnly && (
          <select
            value=""
            title="Hoãn nhắc"
            onChange={(e) => e.target.value && a.onSnooze(r, e.target.value as SnoozeOption)}
          >
            <option value="">Hoãn…</option>
            {(Object.keys(SNOOZE_LABELS) as SnoozeOption[]).map((k) => (
              <option key={k} value={k}>
                {SNOOZE_LABELS[k]}
              </option>
            ))}
          </select>
        )}
        {!r.noteId && (
          <button title="Tạo note từ reminder này để thêm nội dung" onClick={() => a.onCreateNote(r)}>
            📝
          </button>
        )}
        <button title="Sửa" onClick={() => a.onEdit(r)}>
          ✎
        </button>
        <button title="Xóa" onClick={() => a.onDelete(r)}>
          🗑
        </button>
      </div>
    </li>
  )
}

type Tab = Bucket | 'all'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'today', label: 'Hôm nay' },
  { id: 'upcoming', label: 'Sắp tới' },
  { id: 'nodue', label: 'Không hạn' },
  { id: 'overdue', label: 'Quá hạn' },
  { id: 'done', label: 'Đã xong' }
]

interface ViewProps {
  reminders: Reminder[]
  now: number
  a: RowActions
  onNew: () => void
}

export function RemindersView({ reminders, now, a, onNew }: ViewProps) {
  const [tab, setTab] = useState<Tab>('all')
  const groups = useMemo(() => {
    const g: Record<Tab, Reminder[]> = { all: [], today: [], upcoming: [], nodue: [], overdue: [], done: [] }
    for (const r of reminders.filter((x) => !x.deletedAt)) g[bucketOf(r, now)].push(r)
    for (const k of Object.keys(g) as Tab[]) g[k] = sortReminders(g[k], now)
    // Tất cả: quá hạn, hôm nay, sắp tới, không hạn, rồi đã xong ở cuối.
    g.all = [...g.overdue, ...g.today, ...g.upcoming, ...g.nodue, ...g.done]
    return g
  }, [reminders, now])

  const list = groups[tab]
  return (
    <div className="reminders">
      <header className="main-head">
        <h1>Reminder</h1>
        <button className="primary" onClick={onNew}>
          ＋ Reminder mới
        </button>
      </header>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`${tab === t.id ? 'on' : ''} ${t.id === 'overdue' && groups.overdue.length ? 'warn' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {groups[t.id].length > 0 && <span className="count">{groups[t.id].length}</span>}
          </button>
        ))}
      </div>
      <ul className="rem-list">
        {list.map((r) => (
          <ReminderRow key={r.id} r={r} now={now} a={a} />
        ))}
      </ul>
      {list.length === 0 && <p className="empty">Không có reminder nào ở mục này.</p>}
    </div>
  )
}

interface MyDayProps {
  reminders: Reminder[]
  now: number
  a: RowActions
  compact: boolean
  /** Số ngày tới hiển thị (0 = chỉ hôm nay). */
  days: number
  name?: string
  events: CalEvent[]
  calendars: CalendarSource[]
  onOpenEvent: (o: Occurrence) => void
  onExpand: () => void
  onNew: () => void
}

interface DayGroup {
  date: string
  items: { r: Reminder; readOnly: boolean }[]
}

export function MyDay({ reminders, now, a, compact, days, name, events, calendars, onOpenEvent, onExpand, onNew }: MyDayProps) {
  const groups = useMemo(() => {
    const live = reminders.filter((r) => !r.deletedAt)
    const pick = (b: Bucket) => sortReminders(live.filter((r) => bucketOf(r, now) === b), now)
    // Reminder của các ngày tới (tối đa UPCOMING_DAYS ngày), gom theo ngày.
    const today = dateStr(new Date(now))
    const until = addDays(today, days)
    const byDate = new Map<string, DayGroup['items']>()
    for (const r of days > 0 ? live : []) {
      const next = displayOccurrence(r, today)?.date
      for (const date of occurrenceDatesBetween(r, today, until)) {
        const list = byDate.get(date) ?? []
        // Lần xuất hiện kế tiếp tick được; các lần sau của reminder lặp chỉ để xem.
        list.push({ r, readOnly: isRepeating(r) && date !== next })
        byDate.set(date, list)
      }
    }
    const upcoming: DayGroup[] = [...byDate.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([date, items]) => ({
        date,
        items: items.sort((p, q) => Number(q.r.starred) - Number(p.r.starred) || (p.r.time ?? '99:99').localeCompare(q.r.time ?? '99:99'))
      }))
    return { overdue: pick('overdue'), today: pick('today'), upcoming }
  }, [reminders, now, days])
  const d = new Date(now)
  const label = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
  const todayStr = dateStr(d)
  const dayLabel = (date: string) => {
    const base = parseDate(date).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })
    return date === addDays(todayStr, 1) ? `Ngày mai · ${base}` : base
  }
  const empty = groups.overdue.length + groups.today.length + groups.upcoming.length === 0
  // Lịch hôm nay: sự kiện của các lịch đang bật, kèm người tham dự
  const colorOf = (id: string) => calendars.find((c) => c.id === id)?.color ?? '#7c6cf0'
  const agenda = useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id))
    const t = dateStr(new Date(now))
    return occurrencesBetween(
      events.filter((e) => visible.has(e.calendarId)),
      wallToMs(t, 0, null),
      wallToMs(addDays(t, 1), 0, null)
    ).filter((o) => touchesDay(o, t))
  }, [events, calendars, now])
  const hour = d.getHours()
  const greeting = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
  return (
    <div className="myday">
      <header className="main-head">
        <div>
          <h1>{greeting}{name?.trim() ? `, ${name.trim()}` : ''}! ☁️</h1>
          <small className="muted">My day · {label}</small>
        </div>
        <div className="head-actions">
          <button className="primary" onClick={onNew}>
            ＋ Reminder
          </button>
          {compact && <button onClick={onExpand}>Expand ⤢</button>}
        </div>
      </header>
      <div className="myday-body">
        <div className="myday-main">
          {agenda.length > 0 && (
            <section className="card tint-agenda">
              <h2>Lịch hôm nay</h2>
              <ul className="agenda">
                {agenda.map((o) => {
                  const who = attendeeNames(o.event, 3)
                  const ended = !o.allDay && o.end < now
                  return (
                    <li key={o.key} className={ended ? 'past' : ''} onClick={() => onOpenEvent(o)}>
                      <span className="bar" style={{ background: colorOf(o.event.calendarId) }} />
                      <div>
                        <b>{o.event.title}</b>
                        <small>
                          {formatRange(o)}
                          {o.event.location ? ` · ${/^https?:\/\//.test(o.event.location) ? 'Link họp' : o.event.location}` : ''}
                        </small>
                        {who.text && (
                          <small>
                            👥 {who.text}
                            {who.more ? ` +${who.more}` : ''}
                          </small>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          {groups.overdue.length > 0 && (
            <section className="card tint-late">
              <h2 className="late">Quá hạn</h2>
              <ul className="rem-list">
                {groups.overdue.map((r) => (
                  <ReminderRow key={r.id} r={r} now={now} a={a} />
                ))}
              </ul>
            </section>
          )}
          <section className="card tint-today">
            <h2>Hôm nay</h2>
            <ul className="rem-list">
              {groups.today.map((r) => (
                <ReminderRow key={r.id} r={r} now={now} a={a} />
              ))}
            </ul>
            {groups.today.length === 0 && !empty && <p className="muted none">Hôm nay không có reminder nào.</p>}
            {empty && <p className="empty">{days > 0 ? `Chưa có gì cần nhớ hôm nay và ${days} ngày tới 🎉` : 'Hôm nay chưa có gì cần nhớ 🎉'}</p>}
          </section>
          {groups.upcoming.length > 0 && (
            <section className="card tint-sky">
              <h2>{days} ngày tới</h2>
              {groups.upcoming.map((g) => (
                <div key={g.date} className="day-group">
                  <h3>{dayLabel(g.date)}</h3>
                  <ul className="rem-list">
                    {g.items.map(({ r, readOnly }) => (
                      <ReminderRow key={`${r.id}-${g.date}`} r={r} now={now} a={a} occDate={g.date} readOnly={readOnly} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </div>
        {!compact && (
          <aside className="myday-side">
            <MiniCalendar reminders={withoutPushedDuplicates(reminders, events, calendars)} now={now} events={events} calendars={calendars} />
            <div className="cheer-wrap">
              <img className="cheer-card" src={cheerCard} alt="You're doing amazing! Keep up the good work" draggable={false} />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

const REPEATS: { id: RepeatKind; label: string }[] = [
  { id: 'none', label: 'Không lặp' },
  { id: 'daily', label: 'Hằng ngày' },
  { id: 'weekly', label: 'Hằng tuần' },
  { id: 'monthly', label: 'Hằng tháng' },
  { id: 'custom', label: 'Tùy chọn…' }
]

interface FormProps {
  initial: Reminder | null
  notes: Note[]
  onSave: (r: Reminder) => void
  onCancel: () => void
}

export function ReminderForm({ initial, notes, onSave, onCancel }: FormProps) {
  const [r, setR] = useState<Reminder>(initial ?? newReminder())
  const set = (patch: Partial<Reminder>) => setR((x) => ({ ...x, ...patch }))
  const today = dateStr(new Date())
  const ok = r.title.trim().length > 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ok) return
    let date = r.date
    // Có giờ hoặc có lặp lại thì bắt buộc có ngày.
    if (!date && (r.time || r.repeat !== 'none')) date = today
    const weekdays = r.repeat === 'weekly' && !r.weekdays?.length ? [parseDate(date ?? today).getDay()] : r.weekdays
    for (const old of initial?.attachments ?? []) if (!(r.attachments ?? []).some((x) => x.id === old.id)) void window.api.attachments.discard(old)
    onSave({ ...r, weekdays, dailyNudge: r.repeat === 'none' ? r.dailyNudge : false, title: r.title.trim(), date, time: date ? r.time : null, updatedAt: Date.now() })
  }

  /** Đổi kiểu lặp: điền sẵn giá trị hợp lý từ ngày bắt đầu, và bỏ nhắc 9:00 (chỉ dành cho reminder không lặp). */
  const changeRepeat = (repeat: RepeatKind) => {
    const date = r.date ?? (repeat === 'none' ? null : today)
    const d = date ? parseDate(date) : new Date()
    set({
      repeat,
      date,
      dailyNudge: repeat === 'none' ? r.dailyNudge : false,
      weekdays: repeat === 'weekly' ? (r.weekdays?.length ? r.weekdays : [d.getDay()]) : r.weekdays,
      monthlyMode: repeat === 'monthly' ? (r.monthlyMode ?? 'day') : r.monthlyMode,
      monthlyDay: repeat === 'monthly' ? (r.monthlyDay ?? d.getDate()) : r.monthlyDay
    })
  }

  const [attachMsg, setAttachMsg] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

  const addFiles = async () => {
    setAttachMsg('')
    const res = await window.api.attachments.pick()
    if (!res.ok) return setAttachMsg(res.error)
    if (res.items.length) setR((x) => ({ ...x, attachments: [...(x.attachments ?? []), ...res.items] }))
    if (res.warning) setAttachMsg(res.warning)
  }
  const addLink = () => {
    const url = linkUrl.trim()
    const name = linkName.trim() || url.replace(/^https?:\/\//i, '').slice(0, 40)
    setR((x) => ({ ...x, attachments: [...(x.attachments ?? []), { id: newId(), name, size: 0, kind: 'link', url }] }))
    setLinkName('')
    setLinkUrl('')
    setAddingLink(false)
  }
  const removeAttachment = (id: string) => {
    const att = (r.attachments ?? []).find((x) => x.id === id)
    // File vừa thêm trong lần mở form này mà gỡ ngay thì xóa luôn; file đã lưu từ trước chỉ xóa khi bấm Lưu.
    if (att && !(initial?.attachments ?? []).some((x) => x.id === id)) void window.api.attachments.discard(att)
    setR((x) => ({ ...x, attachments: (x.attachments ?? []).filter((y) => y.id !== id) }))
  }

  /** Hủy form: bỏ các file vừa thêm mà chưa lưu. */
  const cancel = () => {
    for (const att of r.attachments ?? []) if (!(initial?.attachments ?? []).some((x) => x.id === att.id)) void window.api.attachments.discard(att)
    onCancel()
  }

  const importNote = (id: string) => {
    const n = notes.find((x) => x.id === id)
    if (!n) return
    set({ noteId: n.id, notes: n.body.trim() ? n.body : r.notes, title: r.title.trim() ? r.title : displayTitle(n) })
  }

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form className="dialog" onSubmit={submit}>
        <h2>{initial ? 'Sửa reminder' : 'Reminder mới'}</h2>
        <label>
          Tiêu đề
          <input autoFocus value={r.title} onChange={(e) => set({ title: e.target.value })} placeholder="Cần nhớ việc gì?" />
        </label>
        <label>
          Ghi chú
          <textarea value={r.notes} rows={3} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <label>
          Lấy nội dung từ note
          <select value={r.noteId ?? ''} onChange={(e) => importNote(e.target.value)}>
            <option value="">— Không —</option>
            {notes
              .filter((n) => !n.deletedAt)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {displayTitle(n)}
                </option>
              ))}
          </select>
        </label>
        <div className="row2">
          <label>
            {r.repeat === 'none' ? 'Ngày' : 'Bắt đầu từ ngày'}
            <input type="date" value={r.date ?? ''} onChange={(e) => set({ date: e.target.value || null, time: e.target.value ? r.time : null })} />
          </label>
          <label>
            {r.repeat === 'none' ? 'Giờ (tùy chọn)' : 'Giờ nhắc'}
            <input type="time" value={r.time ?? ''} disabled={!r.date} onChange={(e) => set({ time: e.target.value || null })} />
          </label>
        </div>
        <label>
          Lặp lại
          <select value={r.repeat} onChange={(e) => changeRepeat(e.target.value as RepeatKind)}>
            {REPEATS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        {r.repeat === 'weekly' && (
          <div className="repeat-box">
            <span>Lặp vào các thứ</span>
            <div className="wd-chips">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = (r.weekdays ?? []).includes(d)
                return (
                  <button
                    type="button"
                    key={d}
                    className={on ? 'wd-chip on' : 'wd-chip'}
                    onClick={() => set({ weekdays: on ? (r.weekdays ?? []).filter((x) => x !== d) : [...(r.weekdays ?? []), d] })}
                  >
                    {WEEKDAY_SHORT[d]}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {r.repeat === 'monthly' && (
          <div className="repeat-box">
            <label className="check">
              <input type="radio" checked={r.monthlyMode !== 'nth'} onChange={() => set({ monthlyMode: 'day' })} />
              Vào ngày
              <input
                type="number"
                min={1}
                max={31}
                value={r.monthlyDay ?? 1}
                disabled={r.monthlyMode === 'nth'}
                onChange={(e) => set({ monthlyMode: 'day', monthlyDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
              />
              mỗi tháng
            </label>
            <label className="check">
              <input type="radio" checked={r.monthlyMode === 'nth'} onChange={() => set({ monthlyMode: 'nth', monthlyNth: r.monthlyNth ?? 1, monthlyWeekday: r.monthlyWeekday ?? 1 })} />
              Vào
              <select value={r.monthlyNth ?? 1} disabled={r.monthlyMode !== 'nth'} onChange={(e) => set({ monthlyNth: Number(e.target.value) })}>
                <option value={1}>thứ đầu tiên</option>
                <option value={2}>thứ hai</option>
                <option value={3}>thứ ba</option>
                <option value={4}>thứ tư</option>
                <option value={-1}>thứ cuối cùng</option>
              </select>
              <select value={r.monthlyWeekday ?? 1} disabled={r.monthlyMode !== 'nth'} onChange={(e) => set({ monthlyWeekday: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_NAMES[d]}
                  </option>
                ))}
              </select>
              của tháng
            </label>
          </div>
        )}
        {r.repeat === 'custom' && (
          <label>
            Mỗi
            <span className="inline">
              <input type="number" min={1} max={365} value={r.repeatEvery} onChange={(e) => set({ repeatEvery: Math.max(1, Number(e.target.value) || 1) })} />
              <select value={r.repeatUnit} onChange={(e) => set({ repeatUnit: e.target.value as RepeatUnit })}>
                <option value="day">ngày</option>
                <option value="week">tuần</option>
                <option value="month">tháng</option>
              </select>
            </span>
          </label>
        )}
        {r.repeat === 'none' && (
          <label className="check">
            <input type="checkbox" checked={r.dailyNudge} onChange={(e) => set({ dailyNudge: e.target.checked })} />
            Nếu chưa tick: nhắc thêm mỗi sáng lúc 9:00 (kể từ ngày hạn)
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={r.starred} onChange={(e) => set({ starred: e.target.checked })} />
          ★ Quan trọng
        </label>
        <label className="check">
          <input type="checkbox" checked={!!r.pushToCalendar} onChange={(e) => set({ pushToCalendar: e.target.checked })} />
          Hiện cả trên Google Calendar (cần đã kết nối)
        </label>
        <div className="attach-box">
          <span>File đính kèm</span>
          {(r.attachments ?? []).map((att) => (
            <div key={att.id} className="attach-row">
              <span>
                {att.kind === 'file' ? '📎' : '🔗'} {att.name}
                {att.kind === 'file' && <small> {formatSize(att.size)}</small>}
              </span>
              <button type="button" className="icon" title="Gỡ" onClick={() => removeAttachment(att.id)}>
                ✕
              </button>
            </div>
          ))}
          {attachMsg && <small className="bad">{attachMsg}</small>}
          <div className="pop-actions">
            <button type="button" onClick={() => void addFiles()}>
              📎 Chọn file
            </button>
            <button type="button" onClick={() => setAddingLink((x) => !x)}>
              🔗 Thêm link
            </button>
          </div>
          {addingLink && (
            <div className="attach-link">
              <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Tên hiển thị" />
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="Link Google Drive hoặc trang web (https://…)" />
              <button type="button" className="primary" disabled={!/^https?:\/\//i.test(linkUrl.trim())} onClick={addLink}>
                Thêm
              </button>
            </div>
          )}
          <small className="muted">File tối đa 10 MB được lưu trong app và đồng bộ qua Drive. File lớn hơn: tải lên Google Drive rồi dán link.</small>
        </div>
        <label>
          Link đính kèm
          <input value={r.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://..." />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={cancel}>
            Hủy
          </button>
          <button className="primary" type="submit" disabled={!ok}>
            Lưu
          </button>
        </div>
      </form>
    </div>
  )
}
