import { contextBridge, ipcRenderer } from 'electron'
import { STORAGE_METHODS, type Storage } from '@core/storage'
import type { AppNotification, Attachment, Note, Reminder } from '@core/types'
import type { DesktopSettings, SaveDesktopResult } from '../desktop-shared/types'
import type { CalendarConnStatus, WriteResult } from '../main/calendar-sync'
import type { CalEvent } from '@core/calendar'
import type { SyncStatus } from '../main/sync-manager'

const storage = Object.fromEntries(
  STORAGE_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`storage:${m}`, ...args)])
) as unknown as Storage

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const fn = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const desktop = {
  onUpdateMessage: (cb: (msg: string) => void) => subscribe('update:message', cb),
  /** Hộp thoại lưu file; trả về đường dẫn đã lưu, hoặc null nếu người dùng hủy. */
  saveFile: (name: string, text: string): Promise<string | null> => ipcRenderer.invoke('data:save', name, text),
  /** Hộp thoại chọn file JSON; trả về nội dung, hoặc null nếu hủy. */
  openTextFile: (): Promise<string | null> => ipcRenderer.invoke('data:open'),
  openSticky: (id: string): Promise<void> => ipcRenderer.invoke('desktop:openSticky', id),
  stickyClose: (): Promise<void> => ipcRenderer.invoke('desktop:stickyClose'),
  stickyMinimize: (): Promise<void> => ipcRenderer.invoke('desktop:stickyMinimize'),
  stickyGetTop: (): Promise<boolean> => ipcRenderer.invoke('desktop:stickyGetTop'),
  stickyToggleTop: (): Promise<boolean> => ipcRenderer.invoke('desktop:stickyToggleTop'),
  getSettings: (): Promise<DesktopSettings> => ipcRenderer.invoke('desktop:getSettings'),
  saveSettings: (s: DesktopSettings): Promise<SaveDesktopResult> => ipcRenderer.invoke('desktop:saveSettings', s),
  openReminderSticky: (id: string): Promise<void> => ipcRenderer.invoke('desktop:openReminderSticky', id),
  showMain: (): Promise<void> => ipcRenderer.invoke('desktop:showMain'),
  expandMain: (): Promise<void> => ipcRenderer.invoke('desktop:expandMain'),
  tickNow: (): Promise<void> => ipcRenderer.invoke('desktop:tickNow'),
  onNoteChanged: (cb: (note: Note) => void) => subscribe('note:changed', cb),
  onReminderChanged: (cb: (r: Reminder) => void) => subscribe('reminder:changed', cb),
  onNotificationAdded: (cb: (n: AppNotification) => void) => subscribe('notification:added', cb),
  /** Lịch hoặc sự kiện vừa đổi (từ cửa sổ khác, hoặc kéo về từ Google/iCal): nạp lại. */
  onCalendarChanged: (cb: () => void) => subscribe<unknown>('calendar:changed', () => cb())
}

const sync = {
  status: (): Promise<SyncStatus> => ipcRenderer.invoke('google:status'),
  signIn: (): Promise<SyncStatus> => ipcRenderer.invoke('google:signIn'),
  signOut: (): Promise<SyncStatus> => ipcRenderer.invoke('google:signOut'),
  now: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:now'),
  setAuto: (auto: boolean): Promise<SyncStatus> => ipcRenderer.invoke('sync:setAuto', auto),
  onStatus: (cb: (s: SyncStatus) => void) => subscribe('sync:status', cb),
  /** Dữ liệu trên máy vừa đổi do kéo từ Drive về: nạp lại danh sách. */
  onApplied: (cb: () => void) => subscribe<unknown>('sync:applied', () => cb())
}

const attachments = {
  pick: (): Promise<{ ok: true; items: Attachment[]; warning?: string } | { ok: false; error: string }> => ipcRenderer.invoke('attach:pick'),
  open: (a: Attachment): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('attach:open', a),
  discard: (a: Attachment): Promise<void> => ipcRenderer.invoke('attach:discard', a)
}

const calendar = {
  status: (): Promise<CalendarConnStatus> => ipcRenderer.invoke('calendar:status'),
  connect: (): Promise<CalendarConnStatus> => ipcRenderer.invoke('calendar:connect'),
  disconnect: (): Promise<CalendarConnStatus> => ipcRenderer.invoke('calendar:disconnect'),
  refresh: (): Promise<CalendarConnStatus> => ipcRenderer.invoke('calendar:refresh'),
  /** Ghi sự kiện của lịch Google lên Google (tạo hoặc sửa). */
  saveEvent: (e: CalEvent): Promise<WriteResult> => ipcRenderer.invoke('calendar:saveEvent', e),
  deleteEvent: (e: CalEvent, scope: 'all' | 'this'): Promise<WriteResult> => ipcRenderer.invoke('calendar:deleteEvent', e, scope),
  addIcal: (name: string, url: string): Promise<WriteResult> => ipcRenderer.invoke('calendar:addIcal', name, url),
  removeIcal: (id: string): Promise<void> => ipcRenderer.invoke('calendar:removeIcal', id),
  pushReminder: (r: Reminder): Promise<WriteResult> => ipcRenderer.invoke('calendar:pushReminder', r),
  onStatus: (cb: (s: CalendarConnStatus) => void) => subscribe('calendar:status', cb)
}

export type DesktopApi = typeof desktop
export type SyncApi = typeof sync
export type CalendarApi = typeof calendar
export type AttachmentsApi = typeof attachments

contextBridge.exposeInMainWorld('api', { storage, desktop, sync, calendar, attachments })
