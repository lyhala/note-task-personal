import { useEffect, useMemo, useRef, useState } from 'react'
import { search, type SearchHit, type SearchInput, type SearchKind } from '@core/search'

const KIND_LABEL: Record<SearchKind, string> = { note: 'Note', reminder: 'Reminder', event: 'Sự kiện' }
const KIND_ICON: Record<SearchKind, string> = { note: '📝', reminder: '⏰', event: '📅' }

interface Props {
  data: SearchInput
  onPick: (hit: SearchHit) => void
  onClose: () => void
}

/** Tìm kiếm toàn cục (Ctrl/Cmd+K): note, reminder, sự kiện; lọc theo loại; gõ không dấu vẫn tìm được. */
export function SearchDialog({ data, onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const [kinds, setKinds] = useState<Set<SearchKind>>(new Set(['note', 'reminder', 'event']))
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])
  const hits = useMemo(() => search(data, q, kinds), [data, q, kinds])
  useEffect(() => setSel(0), [q, kinds])

  const toggle = (k: SearchKind) =>
    setKinds((s) => {
      const next = new Set(s)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next.size ? next : s // luôn giữ ít nhất một loại
    })

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((i) => Math.min(i + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && hits[sel]) onPick(hits[sel])
  }

  return (
    <div className="modal search-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div className="dialog search-dialog" role="dialog" aria-label="Tìm kiếm">
        <input ref={input} className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm note, reminder, sự kiện… (gõ không dấu cũng được)" />
        <div className="search-kinds">
          {(Object.keys(KIND_LABEL) as SearchKind[]).map((k) => (
            <button key={k} className={kinds.has(k) ? 'scope-chip on' : 'scope-chip'} onClick={() => toggle(k)}>
              {KIND_ICON[k]} {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="search-results">
          {q.trim() && hits.length === 0 && <p className="muted">Không thấy kết quả nào.</p>}
          {hits.map((h, i) => (
            <div key={`${h.kind}-${h.id}`} className={`search-hit ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => onPick(h)}>
              <span>{KIND_ICON[h.kind]}</span>
              <div>
                <b>{h.title || '(Không tiêu đề)'}</b>
                {h.snippet && <small>{h.snippet}</small>}
              </div>
              <em>{KIND_LABEL[h.kind]}</em>
            </div>
          ))}
        </div>
        <small className="muted">↑↓ chọn · Enter mở · Esc đóng</small>
      </div>
    </div>
  )
}
