// Kiểu dùng chung giữa main và giao diện cho phần chỉ có desktop (không đưa vào core).

export interface Shortcuts {
  newNote: string
  toggleStickies: string
}

export interface QuietHoursSetting {
  enabled: boolean
  /** 'HH:mm' */
  from: string
  to: string
}

export interface DesktopSettings {
  shortcuts: Shortcuts
  /** Giờ yên lặng: trong khoảng này không bật sticky nổi và thông báo hệ điều hành (vẫn ghi vào trung tâm thông báo). */
  quietHours: QuietHoursSetting
  /** Sticky mới mở có luôn nằm trên cùng không. */
  stickyAlwaysOnTop: boolean
  /** Khởi động cùng máy (chỉ có tác dụng ở bản đã đóng gói). */
  autostart: boolean
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  shortcuts: { newNote: 'CommandOrControl+Alt+N', toggleStickies: 'CommandOrControl+Alt+H' },
  quietHours: { enabled: false, from: '22:00', to: '07:00' },
  stickyAlwaysOnTop: true,
  autostart: true
}

export interface SaveDesktopResult {
  settings: DesktopSettings
  /** Phím tắt không đăng ký được (đã bị app khác chiếm hoặc không hợp lệ). */
  failed: (keyof Shortcuts)[]
}
