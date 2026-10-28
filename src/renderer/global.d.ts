import type { Storage } from '@core/storage'
import type { AttachmentsApi, CalendarApi, DesktopApi, SyncApi } from '../preload'

declare global {
  interface Window {
    api: { storage: Storage; desktop: DesktopApi; sync: SyncApi; calendar: CalendarApi; attachments: AttachmentsApi }
  }
}

export {}
