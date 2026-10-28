import { THEME_COLORS, type Settings } from '@core/types'

const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function isDarkMode(s: Settings): boolean {
  return s.themeMode === 'dark' || (s.themeMode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
}

/** Màu nền và màu nút của tông đang chọn, theo chế độ sáng/tối hiện tại (chưa tính màu tùy chỉnh). */
export function themeBase(s: Settings): { bg: string; accent: string } {
  const c = THEME_COLORS[s.themeColor] ?? THEME_COLORS.violet
  return isDarkMode(s) ? c.dark : c.light
}

// Các màu nền của bảng màu mẫu cũ: bản cũ lưu chúng thành "màu tùy chỉnh" nên làm chế độ Tối không đổi được.
const OLD_PRESET_BGS = new Set(['#f4f1ea', '#1c1e26', '#e8f0e4', '#fbeaf0', '#e6eef8', '#fcf4f0', '#1f1c2b', '#edf7f1', '#fff0f1', '#eef4fd'])

/** Dọn cài đặt cũ: màu tùy chỉnh thực ra là màu mẫu thì bỏ đi để chế độ Sáng/Tối hoạt động lại. */
export function normalizeSettings(s: Settings): { settings: Settings; changed: boolean } {
  if (s.customBg && OLD_PRESET_BGS.has(s.customBg.toLowerCase())) {
    return { settings: { ...s, customBg: null, customAccent: null }, changed: true }
  }
  return { settings: s, changed: false }
}

export function applyTheme(s: Settings): void {
  const base = themeBase(s)
  const bg = s.customBg ?? base.bg
  const accent = s.customAccent ?? base.accent
  const isDarkBg = luminance(bg) < 0.4
  const root = document.documentElement.style
  root.setProperty('--bg', bg)
  root.setProperty('--accent', accent)
  root.setProperty('--on-accent', luminance(accent) < 0.4 ? '#ffffff' : '#111111')
  root.setProperty('--text', isDarkBg ? '#eceaf5' : '#2f2a3d')
  root.setProperty('--muted', isDarkBg ? '#a29cb8' : '#7d7691')
  root.setProperty('--card', isDarkBg ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.8)')
  root.setProperty('--sheen', isDarkBg ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.75)')
  root.setProperty('--edge', isDarkBg ? 'rgba(0,0,0,.4)' : 'color-mix(in srgb, var(--accent) 24%, transparent)')
  root.setProperty('--surface', isDarkBg ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.05)')
  root.setProperty('--border', isDarkBg ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.14)')
}
