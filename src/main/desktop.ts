import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, Tray, type WebContents } from 'electron'
import { makeEventNotification, occurrencesBetween } from '@core/calendar'
import type { SqliteStorage } from './sqlite-storage'
import { describeDue, inQuietHours, makeNotification, MISSED_AFTER_MS, NOTIFY_LABELS, planFire } from '@core/reminders'
import { newNote, NOTE_SIZES, type NotifyKind, type Reminder } from '@core/types'
import {
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopSettings,
  type SaveDesktopResult,
  type Shortcuts
} from '../desktop-shared/types'

// Mọi thứ chỉ có ở desktop (sticky nổi, khay hệ thống, phím tắt toàn cục, khởi động cùng máy) nằm ở file này.

interface StickyState {
  x?: number
  y?: number
  w?: number
  h?: number
  onTop?: boolean
  open?: boolean
}
interface DesktopState {
  settings: DesktopSettings
  stickies: Record<string, StickyState>
}

interface Deps {
  storage: SqliteStorage
  showMain: () => void
  isQuitting: () => boolean
  /** Gửi một sự kiện (note:changed, reminder:changed, notification:added) tới mọi cửa sổ, trừ cửa sổ gửi. */
  broadcast: (channel: string, payload: unknown, except?: WebContents) => void
  preloadPath: string
  loadRenderer: (win: BrowserWindow, hash?: string) => void
}

export function setupDesktop(deps: Deps): { quit: () => void } {
  const stateFile = join(app.getPath('userData'), 'desktop-state.json')
  const state: DesktopState = readState()
  const windows = new Map<string, BrowserWindow>()
  let stickiesHidden = false
  let tray: Tray | null = null
  let saveTimer: NodeJS.Timeout | undefined

  function readState(): DesktopState {
    try {
      if (existsSync(stateFile)) {
        const s = JSON.parse(readFileSync(stateFile, 'utf8'))
        return {
          settings: {
            ...DEFAULT_DESKTOP_SETTINGS,
            ...s.settings,
            shortcuts: { ...DEFAULT_DESKTOP_SETTINGS.shortcuts, ...s.settings?.shortcuts },
            quietHours: { ...DEFAULT_DESKTOP_SETTINGS.quietHours, ...s.settings?.quietHours }
          },
          stickies: s.stickies ?? {}
        }
      }
    } catch {
      /* file hỏng thì dùng mặc định */
    }
    return { settings: DEFAULT_DESKTOP_SETTINGS, stickies: {} }
  }
  const saveState = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => writeFileSync(stateFile, JSON.stringify(state, null, 2)), 300)
  }
  const saveStateNow = () => {
    clearTimeout(saveTimer)
    writeFileSync(stateFile, JSON.stringify(state, null, 2))
  }

  // ---- Sticky ----
  const onScreen = (x: number, y: number, w: number, h: number) =>
    screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return x + w > a.x + 40 && x < a.x + a.width - 40 && y + 30 > a.y && y < a.y + a.height - 40
    })

  async function openSticky(noteId: string, focus = true): Promise<void> {
    const existing = windows.get(noteId)
    if (existing && !existing.isDestroyed()) {
      stickiesHidden = false
      if (existing.isMinimized()) existing.restore()
      existing.show()
      if (focus) existing.focus()
      return
    }
    const note = (await deps.storage.listNotes()).find((n) => n.id === noteId && !n.deletedAt)
    if (!note) return
    const st = (state.stickies[noteId] ??= {})
    const w = st.w ?? note.width ?? NOTE_SIZES.M.w
    const h = st.h ?? note.height ?? NOTE_SIZES.M.h
    const pos = st.x !== undefined && st.y !== undefined && onScreen(st.x, st.y, w, h) ? { x: st.x, y: st.y } : {}
    const win = new BrowserWindow({
      ...pos,
      width: w,
      height: h,
      minWidth: 220,
      minHeight: 160,
      frame: false,
      show: false,
      alwaysOnTop: st.onTop ?? state.settings.stickyAlwaysOnTop,
      title: 'Sticky',
      webPreferences: { preload: deps.preloadPath, contextIsolation: true, sandbox: true }
    })
    st.open = true
    windows.set(noteId, win)
    const persistBounds = () => {
      if (win.isDestroyed() || win.isMinimized()) return
      const b = win.getBounds()
      Object.assign(st, { x: b.x, y: b.y, w: b.width, h: b.height })
      saveState()
    }
    win.on('moved', persistBounds)
    win.on('resized', persistBounds)
    win.on('closed', () => {
      windows.delete(noteId)
      if (!deps.isQuitting()) st.open = false
      saveStateNow()
    })
    win.once('ready-to-show', () => (stickiesHidden ? undefined : focus ? win.show() : win.showInactive()))
    deps.loadRenderer(win, `/sticky/${noteId}`)
    saveState()
  }

  const stickyOf = (wc: WebContents) => BrowserWindow.fromWebContents(wc)
  const idOf = (win: BrowserWindow | null) => [...windows].find(([, w]) => w === win)?.[0]

  ipcMain.handle('desktop:openSticky', (_e, id: string) => openSticky(id))
  ipcMain.handle('desktop:stickyClose', (e) => stickyOf(e.sender)?.close())
  ipcMain.handle('desktop:stickyMinimize', (e) => stickyOf(e.sender)?.minimize())
  ipcMain.handle('desktop:stickyGetTop', (e) => stickyOf(e.sender)?.isAlwaysOnTop() ?? false)
  ipcMain.handle('desktop:stickyToggleTop', (e) => {
    const win = stickyOf(e.sender)
    const id = idOf(win)
    if (!win || !id) return false
    const next = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(next)
    state.stickies[id].onTop = next
    saveState()
    return next
  })

  function toggleStickies(): void {
    const open = [...windows.values()].filter((w) => !w.isDestroyed())
    if (!open.length) return
    stickiesHidden = !stickiesHidden
    for (const w of open) (stickiesHidden ? w.hide() : w.showInactive())
  }

  async function createNoteSticky(): Promise<void> {
    const n = newNote()
    await deps.storage.saveNote(n)
    deps.broadcast('note:changed', n)
    stickiesHidden = false
    await openSticky(n.id, true)
  }

  // ---- Nhắc việc: sticky nổi, thông báo hệ điều hành, bộ lập lịch chạy nền ----
  const reminderWindows = new Map<string, BrowserWindow>()

  /** Mở reminder thành một tờ note nổi giữa màn hình (bộ lập lịch gọi khi đến giờ, hoặc người dùng mở tay). */
  function openReminderSticky(reminderId: string): void {
    const existing = reminderWindows.get(reminderId)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return
    }
    const offset = (reminderWindows.size % 6) * 28
    const win = new BrowserWindow({
      width: 360,
      height: 270,
      minWidth: 280,
      minHeight: 200,
      frame: false,
      show: false,
      alwaysOnTop: true,
      title: 'Nhắc việc',
      webPreferences: { preload: deps.preloadPath, contextIsolation: true, sandbox: true }
    })
    win.center()
    const [x, y] = win.getPosition()
    win.setPosition(x + offset, y + offset)
    reminderWindows.set(reminderId, win)
    win.once('ready-to-show', () => {
      win.show()
      win.moveTop()
    })
    win.on('closed', () => reminderWindows.delete(reminderId))
    deps.loadRenderer(win, `/reminder/${reminderId}`)
  }
  ipcMain.handle('desktop:openReminderSticky', (_e, id: string) => openReminderSticky(id))
  ipcMain.handle('desktop:showMain', () => deps.showMain())

  // Cửa sổ nhắc sự kiện lịch sắp bắt đầu (mỗi lần xảy ra một cửa sổ).
  const eventWindows = new Map<string, BrowserWindow>()
  function openEventSticky(eventId: string, start: number): void {
    const key = `${eventId}@${start}`
    const existing = eventWindows.get(key)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return
    }
    const offset = (eventWindows.size % 6) * 28
    const win = new BrowserWindow({
      width: 360,
      height: 260,
      minWidth: 280,
      minHeight: 190,
      frame: false,
      show: false,
      alwaysOnTop: true,
      title: 'Sự kiện',
      webPreferences: { preload: deps.preloadPath, contextIsolation: true, sandbox: true }
    })
    win.center()
    const [x, y] = win.getPosition()
    win.setPosition(x + offset, y + offset)
    eventWindows.set(key, win)
    win.once('ready-to-show', () => {
      win.show()
      win.moveTop()
    })
    win.on('closed', () => eventWindows.delete(key))
    deps.loadRenderer(win, `/event/${eventId}/${start}`)
  }

  function osNotify(title: string, body: string): void {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body })
    n.on('click', deps.showMain)
    n.show()
  }

  /** Nhắc các sự kiện lịch sắp bắt đầu (theo giờ nhắc của sự kiện, mặc định lấy trong cài đặt). */
  async function checkEventAlerts(now: number, quiet: boolean): Promise<void> {
    const settings = await deps.storage.getSettings()
    const visible = new Set((await deps.storage.listCalendars()).filter((c) => c.visible).map((c) => c.id))
    const events = (await deps.storage.listEvents()).filter((e) => visible.has(e.calendarId))
    if (!events.length) return
    const lead = 1440 * 60_000
    for (const occ of occurrencesBetween(events, now - 60_000, now + lead + 60_000)) {
      if (occ.allDay) continue
      const mins = occ.event.reminderMinutes ?? settings.eventReminderMinutes ?? 15
      if (mins < 0) continue
      const alertAt = occ.start - mins * 60_000
      if (alertAt > now || occ.end <= now) continue
      const key = `${occ.key}#${mins}`
      if (deps.storage.hasEventAlert(key)) continue
      deps.storage.markEventAlert(key, now)
      if (now - alertAt > MISSED_AFTER_MS) continue // đã trễ (app đóng lúc đó hoặc sự kiện mới tạo): không nhắc muộn
      const n = makeEventNotification(occ.event, alertAt)
      await deps.storage.saveNotification(n)
      deps.broadcast('notification:added', n)
      if (quiet) continue
      const time = new Date(occ.start).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
      osNotify(`Sự kiện: ${occ.event.title}`, `Bắt đầu lúc ${time}${occ.event.location ? ` · ${occ.event.location}` : ''}`)
      openEventSticky(occ.event.id, occ.start)
    }
  }

  let ticking = false
  async function tick(): Promise<void> {
    if (ticking) return
    ticking = true
    try {
      const now = Date.now()
      const quiet = inQuietHours(state.settings.quietHours, now)
      const all = await deps.storage.listReminders()
      let missedCount = 0
      for (const r of all) {
        const plan = planFire(r, now)
        if (!plan) continue
        const entries: { kind: NotifyKind; at: number; live: boolean }[] = [
          ...plan.missed.map((t) => ({ kind: 'missed' as const, at: t.at, live: false })),
          ...plan.live.map((t) => ({ kind: t.kind, at: t.at, live: true }))
        ]
        for (const e of entries) {
          const n = makeNotification(r, e.kind, e.at)
          await deps.storage.saveNotification(n)
          deps.broadcast('notification:added', n)
          if (!e.live) missedCount++
          else if (!quiet) {
            osNotify(`${NOTIFY_LABELS[e.kind]}: ${r.title}`, describeDue(r, now))
            openReminderSticky(r.id)
          }
        }
        // Đã xử lý xong các mốc này; đang hoãn mà đã hết hạn hoãn thì xóa hoãn.
        const next: Reminder = {
          ...r,
          firedAt: plan.firedAt,
          snoozeUntil: r.snoozeUntil && now >= r.snoozeUntil ? null : r.snoozeUntil
          // Không đổi updatedAt: firedAt và snoozeUntil là của riêng từng máy, không đồng bộ.
        }
        await deps.storage.saveReminder(next)
        deps.broadcast('reminder:changed', next)
      }
      await checkEventAlerts(now, quiet)
      if (missedCount) osNotify('Reminder đã lỡ', `Có ${missedCount} nhắc việc đến hạn lúc app đóng. Mở app để xem.`)
    } finally {
      ticking = false
    }
  }
  const tickTimer = setInterval(() => void tick(), 15_000)
  setTimeout(() => void tick(), 2_000)
  ipcMain.handle('desktop:tickNow', () => tick())

  // ---- Cài đặt desktop, phím tắt, khởi động cùng máy ----
  function registerShortcuts(): (keyof Shortcuts)[] {
    globalShortcut.unregisterAll()
    const actions: Record<keyof Shortcuts, () => void> = {
      newNote: () => void createNoteSticky(),
      toggleStickies
    }
    const failed: (keyof Shortcuts)[] = []
    for (const key of Object.keys(actions) as (keyof Shortcuts)[]) {
      const acc = state.settings.shortcuts[key]
      let ok = false
      try {
        ok = !!acc && globalShortcut.register(acc, actions[key])
      } catch {
        ok = false
      }
      if (!ok) failed.push(key)
    }
    return failed
  }

  function applyAutostart(): void {
    // Bản dev chạy qua electron.exe trần, đăng ký khởi động cùng máy sẽ trỏ sai; chỉ áp dụng khi đã đóng gói.
    if (!app.isPackaged) return
    app.setLoginItemSettings({ openAtLogin: state.settings.autostart, args: ['--autostart'] })
  }

  ipcMain.handle('desktop:getSettings', () => state.settings)
  ipcMain.handle('desktop:saveSettings', (_e, s: DesktopSettings): SaveDesktopResult => {
    state.settings = {
      ...DEFAULT_DESKTOP_SETTINGS,
      ...s,
      shortcuts: { ...DEFAULT_DESKTOP_SETTINGS.shortcuts, ...s.shortcuts },
      quietHours: { ...DEFAULT_DESKTOP_SETTINGS.quietHours, ...s.quietHours }
    }
    saveStateNow()
    applyAutostart()
    return { settings: state.settings, failed: registerShortcuts() }
  })

  // ---- Khay hệ thống ----
  function createTray(): void {
    const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'))
    tray = new Tray(icon)
    tray.setToolTip('Note')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Mở app', click: deps.showMain },
        { label: 'Note mới', click: () => void createNoteSticky() },
        { label: 'Ẩn/hiện mọi sticky', click: toggleStickies },
        { type: 'separator' },
        { label: 'Thoát', click: () => app.quit() }
      ])
    )
    tray.on('click', deps.showMain)
  }

  createTray()
  registerShortcuts()
  applyAutostart()
  app.on('will-quit', () => globalShortcut.unregisterAll())

  // Mở lại các sticky đang mở lần trước.
  for (const [id, st] of Object.entries(state.stickies)) if (st.open) void openSticky(id, false)

  return {
    quit: () => {
      clearInterval(tickTimer)
      saveStateNow()
      tray?.destroy()
    }
  }
}
