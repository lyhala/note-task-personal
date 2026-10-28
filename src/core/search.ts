// Tìm kiếm toàn cục trên note, reminder và sự kiện. Không phụ thuộc Electron hay giao diện.
// Nét vẽ (strokes) không nằm trong phạm vi tìm.

import type { CalEvent } from './calendar'
import { displayTitle, type Note, type Reminder } from './types'

export type SearchKind = 'note' | 'reminder' | 'event'

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  /** Đoạn mô tả ngắn (nơi khớp, hoặc ngày giờ). */
  snippet: string
  /** Dùng để sắp xếp: mốc cập nhật gần nhất / thời điểm của sự kiện. */
  at: number
}

/** Chữ thường, bỏ dấu tiếng Việt: gõ "nguyen" vẫn tìm thấy "Nguyễn". */
export const fold = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()

const plain = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** Cắt một đoạn quanh chỗ khớp đầu tiên để hiện làm mô tả. */
export function snippetAround(text: string, terms: string[], max = 90): string {
  const flat = plain(text)
  const folded = fold(flat)
  let at = -1
  for (const t of terms) {
    const i = folded.indexOf(t)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return flat.slice(0, max)
  const from = Math.max(0, at - 25)
  return (from > 0 ? '…' : '') + flat.slice(from, from + max) + (from + max < flat.length ? '…' : '')
}

export interface SearchInput {
  notes: Note[]
  reminders: Reminder[]
  events: CalEvent[]
}

export function search(input: SearchInput, query: string, kinds: ReadonlySet<SearchKind>, limit = 50): SearchHit[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const matches = (hay: string) => {
    const h = fold(hay)
    return terms.every((t) => h.includes(t))
  }
  const hits: SearchHit[] = []

  if (kinds.has('note')) {
    for (const n of input.notes) {
      if (n.deletedAt) continue
      const body = plain(n.body)
      if (matches(`${n.title} ${body}`)) hits.push({ kind: 'note', id: n.id, title: displayTitle(n), snippet: snippetAround(n.body, terms), at: n.updatedAt })
    }
  }
  if (kinds.has('reminder')) {
    for (const r of input.reminders) {
      if (r.deletedAt) continue
      if (matches(`${r.title} ${r.notes} ${r.link}`)) {
        const when = [r.date, r.time].filter(Boolean).join(' ')
        hits.push({ kind: 'reminder', id: r.id, title: r.title, snippet: [r.done ? 'Đã xong' : '', when].filter(Boolean).join(' · '), at: r.updatedAt })
      }
    }
  }
  if (kinds.has('event')) {
    for (const e of input.events) {
      if (e.deletedAt) continue
      if (matches(`${e.title} ${e.description} ${e.location} ${e.attendees.map((a) => `${a.name ?? ''} ${a.email}`).join(' ')}`)) {
        const d = new Date(e.start)
        hits.push({ kind: 'event', id: e.id, title: e.title, snippet: `${d.toLocaleDateString('vi-VN')}${e.allDay ? '' : ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}${e.location ? ' · ' + e.location : ''}`, at: e.start })
      }
    }
  }

  // Tiêu đề khớp trước, rồi mới nhất trước.
  const titleHit = (h: SearchHit) => (terms.every((t) => fold(h.title).includes(t)) ? 1 : 0)
  return hits.sort((a, b) => titleHit(b) - titleHit(a) || b.at - a.at).slice(0, limit)
}
