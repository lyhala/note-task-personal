import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, webContents } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { STORAGE_METHODS } from '@core/storage'
import { TRASH_DAYS } from '@core/types'
import { CalendarSyncManager } from './calendar-sync'
import { discardAttachment, openAttachment, pickAndAdd } from './attachments'
import { setupAutoUpdate, updatesAllowed } from './updater'
import { setupDesktop } from './desktop'
import { SqliteStorage } from './sqlite-storage'
import { SyncManager } from './sync-manager'

let mainWindow: BrowserWindow | null = null
let quitting = false
// Khởi động cùng máy: mở cửa sổ gọn My day giữa màn hình (bấm Expand để mở full).
const compactStart = process.argv.includes('--autostart')

const preloadPath = join(__dirname, '../preload/index.js')

function loadRenderer(win: BrowserWindow, hash = ''): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? '#' + hash : ''))
  else void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: compactStart ? 460 : 1200,
    height: compactStart ? 680 : 820,
    minWidth: compactStart ? 380 : 760,
    minHeight: compactStart ? 420 : 520,
    center: true,
    show: false,
    title: 'Note',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true }
  })
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  // Đóng cửa sổ chính không thoát app: app chạy nền ở khay hệ thống.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  loadRenderer(win, compactStart ? '/compact' : '')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showMain)
  ipcMain.handle('desktop:expandMain', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    win.setMinimumSize(760, 520)
    win.setSize(1200, 820)
    win.center()
  })

  app.whenReady().then(async () => {
    const storage = new SqliteStorage(join(app.getPath('userData'), 'data.sqlite'))
    await storage.purgeTrash(Date.now() - TRASH_DAYS * 86_400_000)

    const broadcast = (channel: string, payload: unknown, except?: Electron.WebContents) => {
      for (const wc of webContents.getAllWebContents()) {
        if (wc !== except && !wc.isDestroyed() && wc.getType() === 'window') wc.send(channel, payload)
      }
    }
    const BROADCAST_ON_SAVE: Record<string, string> = {
      saveNote: 'note:changed',
      saveReminder: 'reminder:changed',
      saveNotification: 'notification:added',
      saveCalendar: 'calendar:changed',
      saveEvent: 'calendar:changed'
    }

    const sync = new SyncManager(storage, (channel, payload) => broadcast(channel, payload))
    const gcal = new CalendarSyncManager(storage, (channel, payload) => broadcast(channel, payload))
    ipcMain.handle('attach:pick', (e) => pickAndAdd(BrowserWindow.fromWebContents(e.sender)))
    ipcMain.handle('attach:open', (_e, a) => openAttachment(a))
    ipcMain.handle('attach:discard', (_e, a) => discardAttachment(a))
    ipcMain.handle('data:save', async (_e, name: string, text: string) => {
      const r = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (r.canceled || !r.filePath) return null
      await writeFile(r.filePath, text, 'utf8')
      return r.filePath
    })
    ipcMain.handle('data:open', async () => {
      const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (r.canceled || !r.filePaths[0]) return null
      return readFile(r.filePaths[0], 'utf8')
    })
    ipcMain.handle('calendar:status', () => gcal.status())
    ipcMain.handle('calendar:connect', () => gcal.connect())
    ipcMain.handle('calendar:disconnect', () => gcal.disconnect())
    ipcMain.handle('calendar:refresh', () => gcal.refresh())
    ipcMain.handle('calendar:saveEvent', (_e, ev) => gcal.saveEvent(ev))
    ipcMain.handle('calendar:deleteEvent', (_e, ev, scope: 'all' | 'this') => gcal.deleteEvent(ev, scope))
    ipcMain.handle('calendar:addIcal', (_e, name: string, url: string) => gcal.addIcal(name, url))
    ipcMain.handle('calendar:removeIcal', (_e, id: string) => gcal.removeIcal(id))
    ipcMain.handle('calendar:pushReminder', (_e, r) => gcal.pushReminder(r))
    const DIRTY_ON: string[] = ['saveNote', 'saveFolder', 'saveReminder', 'deleteNoteForever', 'saveCalendar', 'saveEvent']
    ipcMain.handle('google:status', () => sync.status())
    ipcMain.handle('google:signIn', () => sync.connect())
    ipcMain.handle('google:signOut', () => sync.disconnect())
    ipcMain.handle('sync:now', () => sync.run())
    ipcMain.handle('sync:setAuto', (_e, auto: boolean) => sync.setAuto(!!auto))

    for (const m of STORAGE_METHODS) {
      ipcMain.handle(`storage:${m}`, async (e, ...args: unknown[]) => {
        const result = await (storage[m] as (...a: unknown[]) => Promise<unknown>)(...args)
        // Đồng bộ tức thời giữa cửa sổ chính và các sticky.
        if (m in BROADCAST_ON_SAVE) broadcast(BROADCAST_ON_SAVE[m], args[0], e.sender)
        if (DIRTY_ON.includes(m)) sync.markDirty()
        return result
      })
    }

    const desktop = setupDesktop({
      storage,
      showMain,
      isQuitting: () => quitting,
      broadcast,
      preloadPath,
      loadRenderer
    })
    sync.start()
    gcal.start()
    setupAutoUpdate((msg) => broadcast('update:message', msg))
    ipcMain.handle('update:info', () => ({ version: app.getVersion(), ...updatesAllowed() }))
    app.on('before-quit', () => {
      quitting = true
      sync.stop()
      gcal.stop()
      desktop.quit()
    })

    createMainWindow()
    app.on('activate', showMain)
  })

  // Không thoát khi đóng hết cửa sổ: app vẫn chạy ở khay hệ thống.
  app.on('window-all-closed', () => undefined)
}
