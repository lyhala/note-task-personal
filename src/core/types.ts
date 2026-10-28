// Mô hình dữ liệu dùng chung (không phụ thuộc Electron hay giao diện).
// FORMAT_VERSION sẽ nằm trong mọi file JSON đồng bộ lên Drive ở giai đoạn 4.

export const FORMAT_VERSION = 1
export const TRASH_DAYS = 30

export type NoteSize = 'S' | 'M' | 'L'
export type NotePattern = 'plain' | 'dots' | 'lines'
export type NoteFont = 'be-vietnam-pro' | 'lora' | 'patrick-hand' | 'roboto-mono'

// Kích thước hiển thị theo spec (px), giữ tỉ lệ giấy thật.
export const NOTE_SIZES: Record<NoteSize, { w: number; h: number; label: string }> = {
  S: { w: 290, h: 290, label: 'Nhỏ' },
  M: { w: 400, h: 560, label: 'Vừa (A6)' },
  L: { w: 560, h: 795, label: 'Lớn (A5)' }
}

export interface Note {
  v: number
  id: string
  title: string
  body: string
  color: string
  pattern: NotePattern
  font: NoteFont
  size: NoteSize
  width: number
  height: number
  folderId: string | null
  pinnedAt: number | null
  minimized: boolean
  strokes: Stroke[]
  /** Bản xung đột khi đồng bộ: id của note gốc mà bản này xung đột với (người dùng chọn giữ bản nào). */
  conflictOf?: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'line' | 'arrow'

/**
 * Một đối tượng vẽ dạng vector trên tờ giấy: nét bút, nét highlight, hình dạng hoặc icon.
 * Toạ độ tính bằng px trong hệ toạ độ của tờ giấy (không phụ thuộc zoom).
 */
export interface Stroke {
  id: string
  tool: 'pen' | 'highlight' | 'shape' | 'icon' | 'image'
  color: string
  width: number
  /**
   * pen/highlight: dãy phẳng [x0, y0, x1, y1, ...].
   * shape, image: [x0, y0, x1, y1] (hai góc đối diện, hoặc hai đầu với line/arrow).
   * icon: [x, y] (tâm biểu tượng).
   */
  points: number[]
  /** image: ảnh nhúng dạng data URL (đã thu nhỏ khi nhập). */
  src?: string
  shape?: ShapeKind
  /** shape: tô đặc bằng `color`. */
  fill?: boolean
  /** icon: ký tự emoji. */
  glyph?: string
  /** icon: cỡ chữ (px). */
  size?: number
}

export const PEN_COLORS = ['#23252e', '#d64545', '#2f6fed', '#2e9d5b', '#e8890c', '#8e44ad']
export const HIGHLIGHT_COLORS = ['#ffe94d', '#ff9ecb', '#7ee08a', '#7cc7ff']

export const SHAPES: { kind: ShapeKind; icon: string; label: string }[] = [
  { kind: 'rect', icon: '▭', label: 'Hình chữ nhật / vuông' },
  { kind: 'ellipse', icon: '◯', label: 'Hình tròn / elip' },
  { kind: 'triangle', icon: '△', label: 'Tam giác' },
  { kind: 'diamond', icon: '◇', label: 'Hình thoi' },
  { kind: 'star', icon: '☆', label: 'Ngôi sao' },
  { kind: 'line', icon: '╱', label: 'Đường thẳng' },
  { kind: 'arrow', icon: '➝', label: 'Mũi tên' }
]

export const ICON_SIZES = { S: 28, M: 44, L: 72 } as const
export const ICONS = [
  '⭐', '❤️', '✅', '❌', '❗', '❓', '💡', '📌', '📎', '🔔', '⏰', '📅',
  '🔥', '👍', '😀', '🎯', '📝', '☎️', '🏠', '💰', '✈️', '🛒', '🎁', '⚠️'
]

export interface Folder {
  v: number
  id: string
  name: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface Settings {
  themeMode: ThemeMode
  /** Tông màu; chế độ sáng/tối quyết định dùng bản nào của tông. */
  themeColor: ThemeColorId
  customBg: string | null
  customAccent: string | null
  /** My day hiện reminder của hôm nay và bấy nhiêu ngày tới (0 = chỉ hôm nay). */
  upcomingDays: number
  /** Tên hiển thị ở lời chào (để trống thì chào chung). */
  profileName: string
  /** Sự kiện lịch nhắc trước bao nhiêu phút khi sự kiện không tự đặt giờ nhắc. */
  eventReminderMinutes: number
  /** 'preset:N' (avatar mẫu) hoặc data URL ảnh người dùng tải lên. */
  avatar: string
}

export const DEFAULT_SETTINGS: Settings = { themeMode: 'system', themeColor: 'violet', customBg: null, customAccent: null, upcomingDays: 3, profileName: '', avatar: 'preset:0', eventReminderMinutes: 15 }

export const PAPER_COLORS = ['#ffffff', '#fff3b0', '#ffd6d6', '#d4f1d4', '#d6e8ff', '#ead6ff']

export type ThemeColorId = 'violet' | 'mint' | 'rose' | 'sky'

/** Mỗi tông màu có bản sáng và bản tối riêng; chế độ Sáng/Tối chọn bản nào. */
export const THEME_COLORS: Record<ThemeColorId, { name: string; light: { bg: string; accent: string }; dark: { bg: string; accent: string } }> = {
  violet: { name: 'Tím', light: { bg: '#fcf4f0', accent: '#9b7fe0' }, dark: { bg: '#1f1c2b', accent: '#a48cf0' } },
  mint: { name: 'Bạc hà', light: { bg: '#edf7f1', accent: '#43a581' }, dark: { bg: '#162420', accent: '#5ccaa0' } },
  rose: { name: 'Hồng đào', light: { bg: '#fff0f1', accent: '#e8708f' }, dark: { bg: '#2a1c22', accent: '#f08bab' } },
  sky: { name: 'Xanh trời', light: { bg: '#eef4fd', accent: '#5b8def' }, dark: { bg: '#161f2e', accent: '#79a6f7' } }
}

export function newNote(partial: Partial<Note> = {}): Note {
  const now = Date.now()
  const size: NoteSize = partial.size ?? 'M'
  return {
    v: FORMAT_VERSION,
    id: newId(),
    title: '',
    body: '',
    color: PAPER_COLORS[0],
    pattern: 'plain',
    font: 'be-vietnam-pro',
    size,
    width: NOTE_SIZES[size].w,
    height: NOTE_SIZES[size].h,
    folderId: null,
    pinnedAt: null,
    minimized: false,
    strokes: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...partial
  }
}

export function newFolder(name: string): Folder {
  const now = Date.now()
  return { v: FORMAT_VERSION, id: newId(), name, createdAt: now, updatedAt: now, deletedAt: null }
}

export function newId(): string {
  const r = (globalThis.crypto as Crypto).randomUUID()
  return r
}

/** Tiêu đề hiển thị: tiêu đề nếu có, không thì dòng đầu của nội dung. */
export function displayTitle(n: Pick<Note, 'title' | 'body'>): string {
  const t = n.title.trim()
  if (t) return t
  const first = n.body.split('\n').find((l) => l.trim())
  return first ? first.trim().slice(0, 60) : 'Không có tiêu đề'
}

// ---- Reminder ----

/** File đính kèm reminder: 'file' = file nhỏ lưu trong app và thư mục ẩn trên Drive, 'link' = link (ví dụ Google Drive). */
export interface Attachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'link'
  url?: string
}

export type RepeatKind = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom'
export type RepeatUnit = 'day' | 'week' | 'month'

export interface Reminder {
  v: number
  id: string
  title: string
  notes: string
  /** Ngày đến hạn 'YYYY-MM-DD' (giờ địa phương); null = không có thời điểm. */
  date: string | null
  /** Giờ 'HH:mm'; null = cả ngày (hạn tính đến hết ngày). */
  time: string | null
  repeat: RepeatKind
  /** Chỉ dùng khi repeat = 'custom': lặp mỗi `repeatEvery` `repeatUnit`. */
  repeatEvery: number
  repeatUnit: RepeatUnit
  /** repeat = 'weekly': các thứ trong tuần (0 = Chủ nhật ... 6 = thứ Bảy). Trống = thứ của ngày gốc. */
  weekdays?: number[]
  /** repeat = 'monthly': 'day' = một ngày cố định trong tháng, 'nth' = thứ thứ n của tháng. Trống = ngày của mốc gốc. */
  monthlyMode?: 'day' | 'nth'
  /** monthlyMode = 'day': ngày 1-31 (tháng ngắn hơn thì lấy ngày cuối tháng). */
  monthlyDay?: number
  /** monthlyMode = 'nth': 1-4 = thứ thứ n, -1 = thứ cuối cùng của tháng. */
  monthlyNth?: number
  /** monthlyMode = 'nth': thứ trong tuần (0 = Chủ nhật ... 6 = thứ Bảy). */
  monthlyWeekday?: number
  /** Chưa tick mà quá hạn: nhắc lại mỗi sáng 9:00 cho đến khi tick. */
  dailyNudge: boolean
  starred: boolean
  /** Note gốc nếu tạo từ nút Remind. */
  noteId: string | null
  link: string
  attachments?: Attachment[]
  /** Reminder không lặp: đã xong. */
  done: boolean
  doneAt: number | null
  /** Reminder lặp hoặc nhắc hàng ngày: các ngày đã tick ('YYYY-MM-DD'). */
  doneDates: string[]
  snoozeUntil: number | null
  /** Đẩy reminder này sang Google Calendar thành sự kiện (khi đã kết nối). */
  pushToCalendar?: boolean
  /** Mã sự kiện Google đã tạo từ reminder này. */
  googleEventId?: string | null
  /** Mốc nhắc gần nhất đã được xử lý (ms), để không nhắc trùng. */
  firedAt: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export function newReminder(partial: Partial<Reminder> = {}): Reminder {
  const now = Date.now()
  return {
    v: FORMAT_VERSION,
    id: newId(),
    title: '',
    notes: '',
    date: null,
    time: null,
    repeat: 'none',
    repeatEvery: 1,
    repeatUnit: 'day',
    dailyNudge: false,
    starred: false,
    noteId: null,
    link: '',
    done: false,
    doneAt: null,
    doneDates: [],
    snoozeUntil: null,
    pushToCalendar: false,
    googleEventId: null,
    firedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...partial
  }
}

export type NotifyKind = 'due' | 'daily' | 'overdue' | 'missed' | 'event'

/** Một mục trong trung tâm thông báo của app. */
export interface AppNotification {
  v: number
  id: string
  reminderId: string
  kind: NotifyKind
  title: string
  at: number
  readAt: number | null
}
