import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  THEME_COLORS,
  type ThemeColorId,
  displayTitle,
  newFolder,
  newNote,
  newReminder,
  type AppNotification,
  type Folder,
  type Note,
  type Reminder,
  type Settings,
  type ThemeMode
} from '@core/types'
import { bucketOf, dateStr, isDoneNow, snooze, toggleDone } from '@core/reminders'
import type { DesktopSettings, Shortcuts } from '../desktop-shared/types'
import { NavIcon } from './Icons'
import { CalendarView } from './CalendarView'
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog'
import { EventDialog, type EventDraft } from './EventDialog'
import { newCalendar, type CalEvent, type CalendarSource, type Occurrence } from '@core/calendar'
import { NotificationsPage } from './NotificationPanel'
import { ProfileHead, ProfilePopover } from './Profile'
import { SyncCard } from './SyncCard'
import { withoutPushedDuplicates } from '@core/calendar'
import { CalendarCard } from './CalendarCard'
import { SearchDialog } from './SearchDialog'
import { BackupError, buildBackup, parseBackup, planImport } from '@core/backup'
import type { SearchHit } from '@core/search'
import { NoteBadge, NotePaper } from './NotePaper'
import { MyDay, ReminderForm, RemindersView, type RowActions } from './RemindersView'
import { useNow } from './useNow'
import { applyTheme, isDarkMode, normalizeSettings, themeBase } from './theme'

type View = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'trash' }

/** Chữ thường, bỏ dấu tiếng Việt: gõ "nguyen" vẫn tìm thấy "Nguyễn". */
const fold = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()

const storage = window.api.storage

type Section = 'myday' | 'note' | 'reminder' | 'calendar' | 'notif' | 'settings'

export function App({ compactStart = false }: { compactStart?: boolean }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [view, setView] = useState<View>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<Section>('myday')
  const [compact, setCompact] = useState(compactStart)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const [showProfile, setShowProfile] = useState(false)
  const [calendars, setCalendars] = useState<CalendarSource[]>([])
  const [events, setEvents] = useState<CalEvent[]>([])
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const [form, setForm] = useState<{ reminder: Reminder | null } | null>(null)
  const [focusNote, setFocusNote] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState('')
  const now = useNow()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const timers = useRef(new Map<string, number>())
  const latest = useRef(notes)
  latest.current = notes

  useEffect(() => {
    void Promise.all([storage.listNotes(), storage.listFolders(), storage.getSettings(), storage.listReminders(), storage.listNotifications(), storage.listCalendars(), storage.listEvents()]).then(
      ([n, f, s, r, nf, cals, evs]) => {
        setNotes(n)
        setFolders(f.filter((x) => !x.deletedAt))
        const fixed = normalizeSettings(s)
        setSettings(fixed.settings)
        if (fixed.changed) void storage.saveSettings(fixed.settings)
        setReminders(r)
        setNotifs(nf)
        setCalendars(cals)
        setEvents(evs)
        // Lịch trong app luôn có một lịch mặc định; id cố định để các máy gộp làm một khi đồng bộ.
        if (!cals.some((c) => c.kind === 'local')) {
          const c = newCalendar({ id: 'local-default', name: 'Lịch của tôi' })
          setCalendars((all) => [...all, c])
          void storage.saveCalendar(c)
        }
      }
    )
  }, [])

  // Nhận thay đổi từ các cửa sổ khác (sticky, phím tắt tạo note mới).
  useEffect(
    () =>
      window.api.desktop.onNoteChanged((incoming) =>
        setNotes((all) => {
          const cur = all.find((n) => n.id === incoming.id)
          if (!cur) return [incoming, ...all]
          return incoming.updatedAt >= cur.updatedAt ? all.map((n) => (n.id === incoming.id ? incoming : n)) : all
        })
      ),
    []
  )

  // Dữ liệu vừa đổi do kéo từ Drive về: lưu nốt phần đang gõ dở rồi nạp lại danh sách.
  useEffect(
    () =>
      window.api.sync.onApplied(() => {
        const pending = [...timers.current.keys()]
          .map((id) => latest.current.find((x) => x.id === id))
          .filter((n): n is Note => !!n)
          .map((n) => storage.saveNote(n))
        timers.current.forEach((t) => window.clearTimeout(t))
        timers.current.clear()
        void (async () => {
          await Promise.all(pending)
          const [n, f, r, c, e] = await Promise.all([storage.listNotes(), storage.listFolders(), storage.listReminders(), storage.listCalendars(), storage.listEvents()])
          setNotes(n)
          setFolders(f.filter((x) => !x.deletedAt))
          setReminders(r)
          setCalendars(c)
          setEvents(e)
        })()
      }),
    []
  )

  // Lịch hoặc sự kiện vừa đổi (cửa sổ khác, hoặc lấy từ Google/iCal): nạp lại.
  useEffect(
    () =>
      window.api.desktop.onCalendarChanged(() => {
        void Promise.all([storage.listCalendars(), storage.listEvents()]).then(([c, e]) => {
          setCalendars(c)
          setEvents(e)
        })
      }),
    []
  )

  // Reminder và thông báo do bộ lập lịch (main) hoặc cửa sổ nhắc việc thay đổi.
  useEffect(
    () =>
      window.api.desktop.onReminderChanged((incoming) =>
        setReminders((all) => (all.some((x) => x.id === incoming.id) ? all.map((x) => (x.id === incoming.id ? incoming : x)) : [incoming, ...all]))
      ),
    []
  )
  useEffect(
    () => window.api.desktop.onNotificationAdded((n) => setNotifs((all) => (all.some((x) => x.id === n.id) ? all : [n, ...all]))),
    []
  )

  useEffect(() => {
    applyTheme(settings)
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const fn = () => applyTheme(settings)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [settings])

  const patchNote = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((all) => all.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)))
    window.clearTimeout(timers.current.get(id))
    timers.current.set(
      id,
      window.setTimeout(() => {
        const n = latest.current.find((x) => x.id === id)
        if (n) void storage.saveNote(n)
      }, 300)
    )
  }, [])

  // Lưu ngay những thay đổi còn chờ khi đóng cửa sổ.
  useEffect(() => {
    const flush = () => {
      timers.current.forEach((t, id) => {
        window.clearTimeout(t)
        const n = latest.current.find((x) => x.id === id)
        if (n) void storage.saveNote(n)
      })
      timers.current.clear()
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  const saveNow = (n: Note) => {
    setNotes((all) => all.map((x) => (x.id === n.id ? n : x)))
    void storage.saveNote(n)
  }

  const flash = (msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(''), 2500)
  }

  const saveReminder = (r: Reminder) => {
    setReminders((all) => (all.some((x) => x.id === r.id) ? all.map((x) => (x.id === r.id ? r : x)) : [r, ...all]))
    void storage.saveReminder(r)
    // Đẩy sang Google Calendar khi bật; chỉ đẩy lại khi đổi nội dung chính, hoặc khi vừa tắt/xóa để gỡ sự kiện.
    const prev = reminders.find((x) => x.id === r.id)
    const wants = !!r.pushToCalendar && !r.deletedAt && !r.done
    const changed =
      !prev || prev.title !== r.title || prev.date !== r.date || prev.time !== r.time || prev.repeat !== r.repeat || JSON.stringify([prev.weekdays, prev.monthlyMode, prev.monthlyDay, prev.monthlyNth, prev.monthlyWeekday]) !== JSON.stringify([r.weekdays, r.monthlyMode, r.monthlyDay, r.monthlyNth, r.monthlyWeekday]) || prev.notes !== r.notes || !!prev.pushToCalendar !== !!r.pushToCalendar || !!prev.deletedAt !== !!r.deletedAt || prev.done !== r.done
    if (changed && (wants || r.googleEventId)) {
      void window.api.calendar.pushReminder({ ...r, pushToCalendar: wants }).then((res) => {
        if (!res.ok) return flash(res.error)
        const id = res.id ?? null
        if (id !== (r.googleEventId ?? null)) {
          const next = { ...r, googleEventId: id }
          setReminders((all) => all.map((x) => (x.id === r.id ? { ...x, googleEventId: id } : x)))
          void storage.saveReminder(next)
        }
      })
    }
  }

  /** Mở note gốc của reminder: chuyển sang mục Note, mở lại nếu đang thu nhỏ, cuộn tới và nhấp nháy. */
  const openNote = (id: string) => {
    const n = notes.find((x) => x.id === id)
    if (!n || n.deletedAt) return flash('Note gốc đã bị xóa')
    setSection('note')
    setView({ kind: 'all' })
    setQuery('')
    if (n.minimized) patchNote(n.id, { minimized: false })
    setFocusNote(id)
  }
  useEffect(() => window.api.desktop.onUpdateMessage((m) => flash(m)), [])

  // Ctrl/Cmd+K mở tìm kiếm toàn cục.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const exportData = async () => {
    const data = buildBackup({ notes, folders, reminders, calendars, events, settings })
    const name = `note-task-backup-${dateStr(new Date())}.json`
    const path = await window.api.desktop.saveFile(name, JSON.stringify(data, null, 2))
    if (path) flash('Đã xuất dữ liệu')
  }
  const importData = async () => {
    const text = await window.api.desktop.openTextFile()
    if (text === null) return
    try {
      const plan = planImport(parseBackup(text), { notes, folders, reminders, calendars, events })
      for (const n of plan.notes) await storage.saveNote(n)
      for (const f of plan.folders) await storage.saveFolder(f)
      for (const r of plan.reminders) await storage.saveReminder(r)
      for (const c of plan.calendars) await storage.saveCalendar(c)
      for (const e of plan.events) await storage.saveEvent(e)
      const [n, f, r, c, e] = await Promise.all([storage.listNotes(), storage.listFolders(), storage.listReminders(), storage.listCalendars(), storage.listEvents()])
      setNotes(n)
      setFolders(f.filter((x) => !x.deletedAt))
      setReminders(r)
      setCalendars(c)
      setEvents(e)
      flash(`Đã nhập ${plan.notes.length} note, ${plan.reminders.length} reminder, ${plan.events.length} sự kiện`)
    } catch (err) {
      flash(err instanceof BackupError ? err.message : 'Không nhập được file này')
    }
  }

  const pickHit = (h: SearchHit) => {
    setSearchOpen(false)
    if (h.kind === 'note') openNote(h.id)
    else if (h.kind === 'reminder') {
      const r = reminders.find((x) => x.id === h.id)
      if (r) {
        setSection('reminder')
        setForm({ reminder: r })
      }
    } else {
      const ev = events.find((x) => x.id === h.id)
      if (ev) {
        setSection('calendar')
        setEventDraft({ event: ev, occurrenceStart: ev.start })
      }
    }
  }

  useEffect(() => {
    if (!focusNote) return
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-note-id="${focusNote}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.classList.add('flash')
      window.setTimeout(() => el?.classList.remove('flash'), 1800)
      setFocusNote(null)
    }, 150)
    return () => window.clearTimeout(t)
  }, [focusNote])

  const rowActions: RowActions = {
    onToggle: (r) => saveReminder(toggleDone(r, Date.now())),
    onStar: (r) => saveReminder({ ...r, starred: !r.starred, updatedAt: Date.now() }),
    onSnooze: (r, o) => saveReminder(snooze(r, o, Date.now())),
    onNotice: flash,
    onEdit: (r) => setForm({ reminder: r }),
    onDelete: (r) =>
      setConfirmReq({
        title: 'Xóa reminder?',
        message: `"${r.title}" sẽ bị xóa.`,
        confirmLabel: 'Xóa',
        danger: true,
        onConfirm: () => saveReminder({ ...r, deletedAt: Date.now(), updatedAt: Date.now() })
      }),
    onOpenNote: openNote,
    onCreateNote: (r) => createNoteFromReminder(r)
  }

  /** Tạo note từ reminder (tiêu đề, ghi chú), gắn lại với reminder rồi mở note để thêm nội dung. */
  const createNoteFromReminder = (r: Reminder) => {
    const n = newNote({ title: r.title, body: r.notes })
    setNotes((all) => [n, ...all])
    void storage.saveNote(n)
    saveReminder({ ...r, noteId: n.id, updatedAt: Date.now() })
    setSection('note')
    setView({ kind: 'all' })
    setQuery('')
    setFocusNote(n.id)
    flash('Đã tạo note từ reminder')
  }

  /** Giải quyết xung đột đồng bộ: giữ bản trên máy này (thay vào note gốc) hoặc giữ bản gốc (bỏ bản này). */
  const resolveConflict = (copy: Note, keep: 'copy' | 'original') => {
    const now = Date.now()
    const orig = notes.find((n) => n.id === copy.conflictOf && !n.deletedAt)
    const cleanTitle = copy.title.replace(/ \(bản trên máy này\)$/, '')
    if (keep === 'copy' && orig) {
      saveNow({ ...orig, title: cleanTitle, body: copy.body, strokes: copy.strokes, updatedAt: now })
      saveNow({ ...copy, conflictOf: null, deletedAt: now, updatedAt: now })
    } else if (keep === 'copy') {
      saveNow({ ...copy, title: cleanTitle, conflictOf: null, updatedAt: now }) // note gốc không còn: giữ bản này như note thường
    } else {
      saveNow({ ...copy, conflictOf: null, deletedAt: now, updatedAt: now })
    }
  }

  // ---- Lịch ----
  const isGoogle = (e: CalEvent) => calendars.find((c) => c.id === e.calendarId)?.kind === 'google'
  const saveEvent = (e: CalEvent) => {
    if (isGoogle(e)) {
      // Lịch Google: ghi thẳng lên Google (cần mạng), danh sách tự cập nhật sau khi ghi xong.
      setEventDraft(null)
      void window.api.calendar.saveEvent(e).then((r) => flash(r.ok ? 'Đã lưu lên Google Calendar' : r.error))
      return
    }
    setEvents((all) => (all.some((x) => x.id === e.id) ? all.map((x) => (x.id === e.id ? e : x)) : [...all, e]))
    void storage.saveEvent(e)
    setEventDraft(null)
  }
  const deleteEvent = (e: CalEvent, scope: 'all' | 'this', occurrenceStart?: number) => {
    const now = Date.now()
    if (isGoogle(e)) {
      // Sự kiện Google trong app là từng lần đã tách sẵn: luôn chỉ xóa đúng lần này.
      setEventDraft(null)
      void window.api.calendar.deleteEvent(e, 'this').then((r) => flash(r.ok ? 'Đã xóa trên Google Calendar' : r.error))
      return
    }
    if (scope === 'this' && occurrenceStart !== undefined) {
      // Chỉ bỏ một lần của chuỗi lặp: ghi vào danh sách loại trừ.
      const key = e.allDay ? dateStr(new Date(occurrenceStart)) : occurrenceStart
      saveEvent({ ...e, exdates: [...e.exdates, key], updatedAt: now })
    } else {
      saveEvent({ ...e, deletedAt: now, updatedAt: now })
    }
  }
  const toggleCalendar = (c: CalendarSource) => {
    const next = { ...c, visible: !c.visible, updatedAt: Date.now() }
    setCalendars((all) => all.map((x) => (x.id === c.id ? next : x)))
    void storage.saveCalendar(next).then(() => {
      if (next.kind === 'google' && next.visible) void window.api.calendar.refresh()
    })
  }
  const openOccurrence = (o: Occurrence) => setEventDraft({ event: o.event, occurrenceStart: o.start })

  const createFromNote = (n: Note, when: { date: string; time: string | null }) => {
    saveReminder(newReminder({ title: displayTitle(n), noteId: n.id, date: when.date, time: when.time }))
    flash('Đã tạo reminder từ note')
  }

  const openFromNotification = (n: AppNotification) => {
    setNotifs((all) => all.map((x) => (x.id === n.id ? { ...x, readAt: x.readAt ?? Date.now() } : x)))
    if (!n.readAt) void storage.saveNotification({ ...n, readAt: Date.now() })
    setSection(n.kind === 'event' ? 'calendar' : 'reminder')
  }
  const readAllNotifications = () => {
    const t = Date.now()
    setNotifs((all) => all.map((x) => ({ ...x, readAt: x.readAt ?? t })))
    void storage.markAllNotificationsRead(t)
  }

  const addNote = () => {
    setQuery('') // note mới còn trống, đang lọc thì sẽ bị ẩn mất
    const n = newNote({ folderId: view.kind === 'folder' ? view.id : null })
    setNotes((all) => [n, ...all])
    void storage.saveNote(n)
    if (view.kind === 'trash') setView({ kind: 'all' })
  }

  const trashNote = (n: Note) => saveNow({ ...n, deletedAt: Date.now(), updatedAt: Date.now() })
  const restoreNote = (n: Note) => saveNow({ ...n, deletedAt: null, updatedAt: Date.now() })
  const deleteForever = (n: Note) => {
    setNotes((all) => all.filter((x) => x.id !== n.id))
    void storage.deleteNoteForever(n.id)
  }

  const addFolder = () => {
    const f = newFolder('Folder mới')
    setFolders((all) => [...all, f])
    void storage.saveFolder(f)
    setRenaming(f.id)
    setView({ kind: 'folder', id: f.id })
  }
  const renameFolder = (f: Folder, name: string) => {
    const nf = { ...f, name: name.trim() || f.name, updatedAt: Date.now() }
    setFolders((all) => all.map((x) => (x.id === f.id ? nf : x)))
    void storage.saveFolder(nf)
    setRenaming(null)
  }
  const removeFolder = (f: Folder) =>
    setConfirmReq({
      title: 'Xóa folder?',
      message: `Folder "${f.name}" sẽ bị xóa. Các note bên trong không mất, chúng về mục Tất cả.`,
      confirmLabel: 'Xóa folder',
      danger: true,
      onConfirm: () => {
        const now = Date.now()
        notes.filter((n) => n.folderId === f.id).forEach((n) => saveNow({ ...n, folderId: null, updatedAt: now }))
        setFolders((all) => all.filter((x) => x.id !== f.id))
        void storage.saveFolder({ ...f, deletedAt: now, updatedAt: now })
        if (view.kind === 'folder' && view.id === f.id) setView({ kind: 'all' })
      }
    })
  const dropOnFolder = (folderId: string | null, e: React.DragEvent) => {
    e.preventDefault()
    setDropTarget(null)
    const n = notes.find((x) => x.id === e.dataTransfer.getData('text/note-id'))
    if (n && n.folderId !== folderId) patchNote(n.id, { folderId })
  }

  const live = useMemo(() => notes.filter((n) => !n.deletedAt), [notes])
  const trash = useMemo(
    () => notes.filter((n) => n.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!),
    [notes]
  )
  const shown = useMemo(() => {
    let list = view.kind === 'folder' ? live.filter((n) => n.folderId === view.id) : live
    // Lọc theo từ khóa: mọi từ phải xuất hiện trong tiêu đề hoặc nội dung (không phân biệt hoa thường và dấu).
    const terms = fold(query).split(/\s+/).filter(Boolean)
    if (terms.length) {
      list = list.filter((n) => {
        const hay = fold(`${n.title} ${n.body}`)
        return terms.every((t) => hay.includes(t))
      })
    }
    // Ghim sau lên trước, rồi theo thời điểm sửa.
    return [...list].sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || b.updatedAt - a.updatedAt)
  }, [live, view, query])

  const updateSettings = (patch: Partial<Settings>) => {
    const s = { ...settings, ...patch }
    setSettings(s)
    void storage.saveSettings(s)
  }

  const title =
    view.kind === 'trash' ? 'Thùng rác' : view.kind === 'folder' ? (folders.find((f) => f.id === view.id)?.name ?? '') : 'Tất cả note'

  const unread = notifs.filter((n) => !n.readAt).length
  const overdueCount = reminders.filter((r) => !r.deletedAt && bucketOf(r, now) === 'overdue').length
  const todayStr = dateStr(new Date(now))

  return (
    <div className={`shell ${compact ? 'compact' : ''}`}>
      <aside className="sidebar">
        <ProfileHead settings={settings} onOpen={() => setShowProfile((v) => !v)} />
        {showProfile && <ProfilePopover settings={settings} onSave={updateSettings} onClose={() => setShowProfile(false)} />}
        <nav className="nav">
          <button className={`nav-item ${section === 'myday' ? 'active' : ''}`} onClick={() => setSection('myday')}>
            <NavIcon kind="myday" />
            <span>My day</span>
          </button>
          <button className={`nav-item ${section === 'note' ? 'active' : ''}`} onClick={() => setSection('note')}>
            <NavIcon kind="note" />
            <span>Note</span>
          </button>
        {section === 'note' && (
        <div className="branch">
          <div className="side-title">
            Folder
            <button className="icon" onClick={addFolder} title="Tạo folder">＋</button>
          </div>
          <div
            className={`folder ${view.kind === 'all' ? 'active' : ''} ${dropTarget === 'all' ? 'drop' : ''}`}
            onClick={() => setView({ kind: 'all' })}
            onDragOver={(e) => { e.preventDefault(); setDropTarget('all') }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => dropOnFolder(null, e)}
          >
            <span>Tất cả</span>
            <small>{live.length}</small>
          </div>
          {folders.map((f) => (
            <div
              key={f.id}
              className={`folder ${view.kind === 'folder' && view.id === f.id ? 'active' : ''} ${dropTarget === f.id ? 'drop' : ''}`}
              onClick={() => setView({ kind: 'folder', id: f.id })}
              onDoubleClick={() => setRenaming(f.id)}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(f.id) }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => dropOnFolder(f.id, e)}
            >
              {renaming === f.id ? (
                <input
                  autoFocus
                  defaultValue={f.name}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => renameFolder(f, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span>{f.name}</span>
              )}
              <small>{live.filter((n) => n.folderId === f.id).length}</small>
              <button className="icon del" title="Xóa folder" onClick={(e) => { e.stopPropagation(); removeFolder(f) }}>✕</button>
            </div>
          ))}
          <div className={`folder ${view.kind === 'trash' ? 'active' : ''}`} onClick={() => setView({ kind: 'trash' })}>
            <span>🗑 Thùng rác</span>
            <small>{trash.length || ''}</small>
          </div>
        </div>
        )}
          <button className={`nav-item ${section === 'reminder' ? 'active' : ''}`} onClick={() => setSection('reminder')}>
            <NavIcon kind="reminder" />
            <span>Reminder</span>
            {overdueCount > 0 && <span className="count warn">{overdueCount}</span>}
          </button>
          <button className={`nav-item ${section === 'calendar' ? 'active' : ''}`} onClick={() => setSection('calendar')}>
            <NavIcon kind="calendar" />
            <span>Calendar</span>
          </button>
          <button className={`nav-item ${section === 'notif' ? 'active' : ''}`} onClick={() => setSection('notif')}>
            <NavIcon kind="bell" />
            <span>Notification</span>
            {unread > 0 && <span className="count warn">{unread}</span>}
          </button>
          <button className={`nav-item ${section === 'settings' ? 'active' : ''}`} onClick={() => setSection('settings')}>
            <NavIcon kind="settings" />
            <span>Setting</span>
          </button>
        </nav>
      </aside>

      <main className="main">
        {section === 'myday' && (
          <MyDay
            reminders={reminders}
            now={now}
            a={rowActions}
            compact={compact}
            days={settings.upcomingDays ?? 3}
            name={settings.profileName}
            events={events}
            calendars={calendars}
            onOpenEvent={openOccurrence}
            onExpand={() => {
              void window.api.desktop.expandMain()
              setCompact(false)
            }}
            onNew={() => setForm({ reminder: null })}
          />
        )}
        {section === 'calendar' && (
          <CalendarView
            calendars={calendars}
            events={events}
            reminders={withoutPushedDuplicates(reminders, events, calendars)}
            now={now}
            onNewEvent={(start, end, allDay) => setEventDraft({ event: null, start, end, allDay })}
            onOpenEvent={openOccurrence}
            onOpenReminder={(r) => setForm({ reminder: r })}
            onToggleCalendar={toggleCalendar}
            sidebarExtra={<CalendarCard />}
          />
        )}
        {section === 'notif' && <NotificationsPage items={notifs} onOpen={openFromNotification} onReadAll={readAllNotifications} />}
        {section === 'settings' && (
          <div className="page">
            <header className="main-head">
              <h1>Setting</h1>
            </header>
            <div className="page-body settings">
              <SyncCard />
              <div className="theme-panel sync-card">
                <b>Dữ liệu của bạn</b>
                <p className="muted">Xuất toàn bộ note, folder, reminder và lịch trong app ra một file JSON để lưu trữ. Nhập file sẽ gộp vào dữ liệu hiện có, không xóa gì: mục nào mới hơn thì được giữ.</p>
                <div className="pop-actions">
                  <button onClick={() => void exportData()}>Xuất dữ liệu</button>
                  <button onClick={() => void importData()}>Nhập dữ liệu</button>
                </div>
              </div>
              <ThemePanel settings={settings} onChange={updateSettings} />
              <DesktopPanel />
            </div>
          </div>
        )}
        {section === 'reminder' && <RemindersView reminders={reminders} now={now} a={rowActions} onNew={() => setForm({ reminder: null })} />}
        {section === 'note' && (
        <>
        <header className="main-head">
          <h1>{title}</h1>
          {view.kind !== 'trash' && (
            <div className="search">
              <input
                type="search"
                value={query}
                placeholder="Lọc theo từ khóa..."
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              />
              {query.trim() && <small>{shown.length} kết quả</small>}
            </div>
          )}
          {view.kind !== 'trash' && <button className="primary" onClick={addNote}>＋ Note mới</button>}
        </header>

        {view.kind === 'trash' ? (
          <div className="trash">
            {trash.length === 0 && <p className="empty">Thùng rác trống. Note xóa sẽ được giữ 30 ngày.</p>}
            {trash.map((n) => (
              <div className="trash-row" key={n.id}>
                <span className="dot" style={{ background: n.color }} />
                <div className="grow">
                  <b>{displayTitle(n)}</b>
                  <small>Xóa lúc {new Date(n.deletedAt!).toLocaleString('vi-VN')}</small>
                </div>
                <button onClick={() => restoreNote(n)}>Khôi phục</button>
                <button
                  className="danger"
                  onClick={() =>
                    setConfirmReq({
                      title: 'Xóa vĩnh viễn note này?',
                      message: `"${displayTitle(n)}" sẽ bị xóa hẳn, kể cả trên các máy khác đang đồng bộ. Không thể khôi phục.`,
                      confirmLabel: 'Xóa vĩnh viễn',
                      danger: true,
                      onConfirm: () => deleteForever(n)
                    })
                  }
                >
                  Xóa hẳn
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="board">
            {shown.some((n) => n.minimized) && (
              <div className="badges">
                {shown.filter((n) => n.minimized).map((n) => (
                  <NoteBadge key={n.id} note={n} onOpen={() => patchNote(n.id, { minimized: false })} />
                ))}
              </div>
            )}
            {shown.length === 0 && (
              <p className="empty">
                {query.trim() ? `Không có note nào khớp “${query.trim()}”.` : 'Chưa có note nào. Bấm “＋ Note mới” để bắt đầu.'}
              </p>
            )}
            <div className="papers">
              {shown.filter((n) => !n.minimized).map((n) => (
                <NotePaper
                  key={n.id}
                  note={n}
                  folders={folders}
                  onChange={(p) => patchNote(n.id, p)}
                  onTrash={() => trashNote(n)}
                  onOpenSticky={() => void window.api.desktop.openSticky(n.id)}
                  onRemind={(when) => createFromNote(n, when)}
                  onResolveConflict={n.conflictOf ? (keep) => resolveConflict(n, keep) : undefined}
                />
              ))}
            </div>
          </div>
        )}
        </>
        )}
      </main>
      {form && (
        <ReminderForm
          initial={form.reminder}
          notes={notes}
          onCancel={() => setForm(null)}
          onSave={(r) => {
            saveReminder(r)
            setForm(null)
          }}
        />
      )}
      {searchOpen && <SearchDialog data={{ notes, reminders, events }} onPick={pickHit} onClose={() => setSearchOpen(false)} />}
      {confirmReq && <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />}
      {eventDraft && (
        <EventDialog
          draft={eventDraft}
          calendars={calendars}
          defaultReminder={settings.eventReminderMinutes ?? 15}
          onSave={saveEvent}
          onDelete={deleteEvent}
          onCancel={() => setEventDraft(null)}
        />
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  )
}

const SHORTCUT_LABELS: Record<keyof Shortcuts, string> = {
  newNote: 'Tạo note mới',
  toggleStickies: 'Ẩn/hiện mọi sticky'
}

/** Chuyển phím vừa bấm thành chuỗi phím tắt của Electron; null nếu chưa đủ (cần phím bổ trợ + một phím). */
function toAccelerator(e: React.KeyboardEvent): string | null {
  const k = e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null
  const mods = [e.ctrlKey && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  if (!mods.length) return null
  let key: string
  if (/^[a-z0-9]$/i.test(k)) key = k.toUpperCase()
  else if (/^F\d{1,2}$/.test(k)) key = k
  else if (k === ' ') key = 'Space'
  else if (k.startsWith('Arrow')) key = k.slice(5)
  else if (['Enter', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(k)) key = k
  else return null
  return [...mods, key].join('+')
}

function DesktopPanel() {
  const [cfg, setCfg] = useState<DesktopSettings | null>(null)
  const [failed, setFailed] = useState<(keyof Shortcuts)[]>([])

  useEffect(() => {
    void window.api.desktop.getSettings().then(setCfg)
  }, [])
  if (!cfg) return null

  const save = async (next: DesktopSettings) => {
    setCfg(next)
    const r = await window.api.desktop.saveSettings(next)
    setCfg(r.settings)
    setFailed(r.failed)
  }

  return (
    <div className="theme-panel">
      <b>Desktop</b>
      {(Object.keys(SHORTCUT_LABELS) as (keyof Shortcuts)[]).map((k) => (
        <label key={k} className="shortcut">
          <span>{SHORTCUT_LABELS[k]}</span>
          <input
            readOnly
            className={failed.includes(k) ? 'bad' : ''}
            value={cfg.shortcuts[k].replace('CommandOrControl', 'Ctrl')}
            title="Bấm vào ô rồi nhấn tổ hợp phím mới"
            onKeyDown={(e) => {
              e.preventDefault()
              const acc = toAccelerator(e)
              if (acc) void save({ ...cfg, shortcuts: { ...cfg.shortcuts, [k]: acc } })
            }}
          />
        </label>
      ))}
      {failed.length > 0 && <small className="bad">Phím tắt đỏ không dùng được (đã bị app khác chiếm).</small>}
      <label>
        Sticky luôn nằm trên cùng
        <input type="checkbox" checked={cfg.stickyAlwaysOnTop} onChange={(e) => void save({ ...cfg, stickyAlwaysOnTop: e.target.checked })} />
      </label>
      <label>
        Khởi động cùng máy
        <input type="checkbox" checked={cfg.autostart} onChange={(e) => void save({ ...cfg, autostart: e.target.checked })} />
      </label>
      <label>
        Giờ yên lặng (không bật sticky nổi)
        <input type="checkbox" checked={cfg.quietHours.enabled} onChange={(e) => void save({ ...cfg, quietHours: { ...cfg.quietHours, enabled: e.target.checked } })} />
      </label>
      {cfg.quietHours.enabled && (
        <div className="quiet">
          <input type="time" value={cfg.quietHours.from} onChange={(e) => void save({ ...cfg, quietHours: { ...cfg.quietHours, from: e.target.value || '22:00' } })} />
          <span>đến</span>
          <input type="time" value={cfg.quietHours.to} onChange={(e) => void save({ ...cfg, quietHours: { ...cfg.quietHours, to: e.target.value || '07:00' } })} />
        </div>
      )}
    </div>
  )
}

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Sáng' },
  { id: 'dark', label: 'Tối' },
  { id: 'system', label: 'Theo hệ thống' }
]

function ThemePanel({ settings, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const base = themeBase(settings)
  const dark = isDarkMode(settings)
  const hasCustom = !!(settings.customBg || settings.customAccent)
  // Đổi chế độ hoặc tông màu thì dùng lại bảng màu của tông đó, bỏ màu tùy chỉnh để thay đổi có tác dụng ngay.
  const reset = { customBg: null, customAccent: null }
  return (
    <div className="theme-panel">
      <span className="lbl">Chế độ</span>
      <div className="seg">
        {MODES.map((m) => (
          <button key={m.id} className={settings.themeMode === m.id ? 'on' : ''} onClick={() => onChange({ themeMode: m.id, ...reset })}>
            {m.label}
          </button>
        ))}
      </div>
      <span className="lbl">Tông màu</span>
      <div className="presets">
        {(Object.keys(THEME_COLORS) as ThemeColorId[]).map((id) => {
          const c = dark ? THEME_COLORS[id].dark : THEME_COLORS[id].light
          const on = settings.themeColor === id && !hasCustom
          return (
            <button key={id} className={`tone ${on ? 'on' : ''}`} onClick={() => onChange({ themeColor: id, ...reset })} title={THEME_COLORS[id].name}>
              <span className="tone-dot" style={{ background: c.bg, borderColor: c.accent }}>
                <i style={{ background: c.accent }} />
              </span>
              <small>{THEME_COLORS[id].name}</small>
            </button>
          )
        })}
      </div>
      <details className="custom-colors" open={hasCustom}>
        <summary>Tự chọn màu</summary>
        <label>Màu nền <input type="color" value={settings.customBg ?? base.bg} onChange={(e) => onChange({ customBg: e.target.value })} /></label>
        <label>Màu nút <input type="color" value={settings.customAccent ?? base.accent} onChange={(e) => onChange({ customAccent: e.target.value })} /></label>
        {hasCustom && <button onClick={() => onChange(reset)}>Bỏ màu tự chọn</button>}
      </details>
      <label>
        My day hiện trước
        <span className="inline-num">
          <input
            type="number"
            min={0}
            max={30}
            value={settings.upcomingDays ?? 3}
            onChange={(e) => onChange({ upcomingDays: Math.min(30, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
          />
          ngày
        </span>
      </label>
      <label>
        Nhắc sự kiện lịch trước
        <span className="inline-num">
          <input
            type="number"
            min={0}
            max={1440}
            value={settings.eventReminderMinutes ?? 15}
            onChange={(e) => onChange({ eventReminderMinutes: Math.min(1440, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
          />
          phút
        </span>
      </label>
    </div>
  )
}
