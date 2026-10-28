// Bộ icon menu vẽ bằng SVG (màu mềm kiểu pastel). Avatar mặc định là ảnh đất sét.
import clayAvatar from './assets/avatar-clay.webp'

export type NavIconKind = 'myday' | 'note' | 'reminder' | 'calendar' | 'bell' | 'settings'

const SUN_RAYS = [0, 45, 90, 135, 180, 225, 270, 315]
const GEAR_TEETH = [0, 45, 90, 135]

const glyphs: Record<NavIconKind, React.ReactNode> = {
  myday: (
    <>
      <defs>
        <radialGradient id="ni-sun" cx=".35" cy=".3" r=".9">
          <stop offset="0" stopColor="#ffe98a" />
          <stop offset="1" stopColor="#ff9f43" />
        </radialGradient>
      </defs>
      <g stroke="#ffb347" strokeWidth="2.4" strokeLinecap="round">
        {SUN_RAYS.map((a) => (
          <line key={a} x1="16" y1="2.8" x2="16" y2="5.8" transform={`rotate(${a} 16 16)`} />
        ))}
      </g>
      <circle cx="16" cy="16" r="7.6" fill="url(#ni-sun)" />
      <ellipse cx="13.4" cy="13" rx="2.8" ry="1.6" fill="#fff" opacity=".55" transform="rotate(-30 13.4 13)" />
    </>
  ),
  note: (
    <>
      <defs>
        <linearGradient id="ni-note" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffec8f" />
          <stop offset="1" stopColor="#ffc94d" />
        </linearGradient>
      </defs>
      <rect x="5" y="4" width="22" height="24" rx="5" fill="url(#ni-note)" />
      <path d="M20 28 L27 21 H22.5 a2.5 2.5 0 0 0 -2.5 2.5 Z" fill="#f2b232" />
      <rect x="9" y="10" width="14" height="2.2" rx="1.1" fill="#fff" opacity=".9" />
      <rect x="9" y="15" width="14" height="2.2" rx="1.1" fill="#fff" opacity=".9" />
      <rect x="9" y="20" width="8" height="2.2" rx="1.1" fill="#fff" opacity=".9" />
    </>
  ),
  reminder: (
    <>
      <defs>
        <linearGradient id="ni-clock" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9fb0" />
          <stop offset="1" stopColor="#ee5479" />
        </linearGradient>
      </defs>
      <circle cx="7.5" cy="8.5" r="3.6" fill="#ff7d98" />
      <circle cx="24.5" cy="8.5" r="3.6" fill="#ff7d98" />
      <path d="M9 26.5 l-2 2.6 M23 26.5 l2 2.6" stroke="#ee5479" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="17.5" r="10.2" fill="url(#ni-clock)" />
      <circle cx="16" cy="17.5" r="7.4" fill="#fff" />
      <path d="M16 12.6 V17.6 L19.6 19.6" stroke="#ee5479" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  calendar: (
    <>
      <defs>
        <linearGradient id="ni-cal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff93a8" />
          <stop offset="1" stopColor="#ef5a7e" />
        </linearGradient>
      </defs>
      <rect x="4" y="6" width="24" height="22" rx="5.5" fill="#fff" stroke="#d3dcf8" />
      <path d="M4 11.5 A5.5 5.5 0 0 1 9.5 6 H22.5 A5.5 5.5 0 0 1 28 11.5 V14 H4 Z" fill="url(#ni-cal)" />
      <rect x="9.5" y="3" width="3" height="6.4" rx="1.5" fill="#8c7ae6" />
      <rect x="19.5" y="3" width="3" height="6.4" rx="1.5" fill="#8c7ae6" />
      <g fill="#a6b8f7">
        <circle cx="10" cy="19" r="1.7" />
        <circle cx="16" cy="19" r="1.7" />
        <circle cx="22" cy="19" r="1.7" />
        <circle cx="10" cy="24" r="1.7" />
        <circle cx="16" cy="24" r="1.7" />
      </g>
      <circle cx="22" cy="24" r="2.1" fill="#8c7ae6" />
    </>
  ),
  bell: (
    <>
      <defs>
        <linearGradient id="ni-bell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#f5a623" />
        </linearGradient>
      </defs>
      <path d="M16 4 C10.8 4 8.4 8 8.4 13 V17.5 L5.8 21.6 H26.2 L23.6 17.5 V13 C23.6 8 21.2 4 16 4 Z" fill="url(#ni-bell)" />
      <circle cx="16" cy="25.6" r="2.9" fill="#f0a020" />
      <ellipse cx="12.6" cy="11" rx="1.8" ry="3.4" fill="#fff" opacity=".5" transform="rotate(12 12.6 11)" />
    </>
  ),
  settings: (
    <>
      <defs>
        <linearGradient id="ni-gear" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c7b4f7" />
          <stop offset="1" stopColor="#8a6bdc" />
        </linearGradient>
      </defs>
      <g fill="url(#ni-gear)">
        {GEAR_TEETH.map((a) => (
          <rect key={a} x="13.8" y="2.8" width="4.4" height="26.4" rx="2" transform={`rotate(${a} 16 16)`} />
        ))}
        <circle cx="16" cy="16" r="9" />
      </g>
      <circle cx="16" cy="16" r="3.8" fill="#fff" />
    </>
  )
}

/** Icon menu: ô vuông bo tròn tô màu nhạt, hình bên trong tô gradient. */
export function NavIcon({ kind }: { kind: NavIconKind }) {
  return (
    <span className={`ico ico-${kind}`} aria-hidden>
      <svg viewBox="0 0 32 32" width="24" height="24">
        {glyphs[kind]}
      </svg>
    </span>
  )
}

// ---- Avatar ----

/** Hiển thị avatar: ảnh người dùng tải lên (data URL), còn lại là ảnh mặc định (cô bé đất sét). */
export function AvatarImage({ value }: { value: string }) {
  return <img src={value.startsWith('data:image/') ? value : clayAvatar} alt="" draggable={false} />
}
