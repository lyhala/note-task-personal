import { app } from 'electron'

export interface UpdateInfo {
  enabled: boolean
  reason?: string
}

/**
 * Bản Microsoft Store tự cập nhật qua Store: bắt buộc tắt electron-updater.
 * `process.windowsStore` do Electron đặt khi chạy từ gói MSIX/APPX.
 */
export function updatesAllowed(): UpdateInfo {
  if (!app.isPackaged) return { enabled: false, reason: 'Đang chạy bản phát triển' }
  if ((process as NodeJS.Process & { windowsStore?: boolean }).windowsStore) return { enabled: false, reason: 'Bản Microsoft Store tự cập nhật qua Store' }
  if (process.platform === 'linux') return { enabled: false, reason: 'Chưa hỗ trợ trên Linux' }
  return { enabled: true }
}

/** Kiểm tra bản mới trên GitHub Releases lúc mở app và mỗi 6 giờ; tải ngầm, cài khi thoát app. */
export function setupAutoUpdate(onMessage: (msg: string) => void): UpdateInfo {
  const info = updatesAllowed()
  if (!info.enabled) return info
  try {
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (i) => onMessage(`Đang tải bản mới ${i.version}…`))
    autoUpdater.on('update-downloaded', (i) => onMessage(`Bản ${i.version} đã tải xong, sẽ cài khi bạn thoát app`))
    autoUpdater.on('error', () => undefined) // không có mạng hoặc chưa có bản phát hành: bỏ qua im lặng
    const check = () => void autoUpdater.checkForUpdates().catch(() => undefined)
    setTimeout(check, 30_000)
    setInterval(check, 6 * 3_600_000)
  } catch {
    return { enabled: false, reason: 'Không nạp được bộ cập nhật' }
  }
  return info
}
