import { useEffect, useRef, useState } from 'react'
import { dateStr } from '@core/reminders'
import {
  NOTE_SIZES,
  PAPER_COLORS,
  displayTitle,
  type Folder,
  type Note,
  type NoteFont,
  type NotePattern,
  newId,
  type NoteSize,
  type Stroke
} from '@core/types'
import { DEFAULT_DRAW, DrawLayer, DrawToolbar, copySelection, type DrawState, type Selection } from './DrawLayer'

const FONTS: Record<NoteFont, { label: string; css: string }> = {
  'be-vietnam-pro': { label: 'Be Vietnam Pro', css: "'Be Vietnam Pro', sans-serif" },
  lora: { label: 'Lora', css: "'Lora', serif" },
  'patrick-hand': { label: 'Patrick Hand', css: "'Patrick Hand', cursive" },
  'roboto-mono': { label: 'Roboto Mono', css: "'Roboto Mono', monospace" }
}
const PATTERNS: Record<NotePattern, string> = { plain: 'Trắng', dots: 'Chấm bi', lines: 'Kẻ ngang' }

const URL_RE = /(https?:\/\/[^\s<>"]+)/g

function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  )
}

const MAX_IMAGE_SIDE = 900
const MAX_IMAGE_CHARS = 1_500_000

const readDataUrl = (file: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error)
    r.readAsDataURL(file)
  })

/** Đọc ảnh từ máy, thu nhỏ để note không phình to, trả về data URL và kích thước. */
async function importImage(file: File): Promise<{ src: string; w: number; h: number }> {
  const img = new Image()
  img.src = await readDataUrl(file)
  await img.decode()
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * k))
  const h = Math.max(1, Math.round(img.naturalHeight * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  // PNG/GIF/WebP giữ nền trong suốt; ảnh quá nặng thì chuyển JPEG.
  let src = /png|gif|webp|svg/.test(file.type) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85)
  if (src.length > MAX_IMAGE_CHARS) src = c.toDataURL('image/jpeg', 0.7)
  return { src, w, h }
}

/** Điều khiển khi tờ giấy nằm trong cửa sổ sticky nổi riêng. */
export interface StickyControls {
  alwaysOnTop: boolean
  onToggleTop: () => void
  onMinimize: () => void
  onClose: () => void
}

interface Props {
  note: Note
  folders: Folder[]
  onChange: (patch: Partial<Note>) => void
  onTrash: () => void
  onOpenSticky?: () => void
  /** Tạo reminder từ note này (chỉ có ở cửa sổ chính). */
  onRemind?: (when: { date: string; time: string | null }) => void
  /** Chỉ có với bản xung đột do đồng bộ: người dùng chọn giữ bản nào. */
  onResolveConflict?: (keep: 'copy' | 'original') => void
  sticky?: StickyControls
}

export function NotePaper({ note, folders, onChange, onTrash, onOpenSticky, onRemind, onResolveConflict, sticky }: Props) {
  const [remindOpen, setRemindOpen] = useState(false)
  const [remindDate, setRemindDate] = useState(() => dateStr(new Date()))
  const [remindTime, setRemindTime] = useState('')
  const [editing, setEditing] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [box, setBox] = useState({ w: note.width, h: note.height })
  const [drawing, setDrawing] = useState(false)
  const [draw, setDraw] = useState<DrawState>(DEFAULT_DRAW)
  const [selection, setSelection] = useState<Selection | null>(null)
  const undo = useRef<Stroke[][]>([])
  const [undoLen, setUndoLen] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const noteSize = useRef({ w: note.width, h: note.height })
  noteSize.current = { w: note.width, h: note.height }

  // Màn hình thấp hơn tờ giấy thì thu nhỏ cho vừa, giữ tỉ lệ (chỉ khi nằm trong bảng, không phải sticky).
  useEffect(() => {
    if (sticky) return
    const fit = () => setZoom(Math.min(1, (window.innerHeight - 110) / note.height))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [note.height, sticky])

  // Theo dõi kích thước thật của tờ; kéo mép tờ trong bảng thì lưu lại kích thước.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let t: number | undefined
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.offsetWidth)
      const h = Math.round(el.offsetHeight)
      setBox({ w, h })
      if (sticky) return
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        const cur = noteSize.current
        if (Math.abs(w - cur.w) > 2 || Math.abs(h - cur.h) > 2) onChange({ width: w, height: h })
      }, 250)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
    }
  }, [onChange, sticky])

  useEffect(() => {
    if (editing) bodyRef.current?.focus()
  }, [editing])

  useEffect(() => {
    if (!drawing || draw.tool !== 'select') setSelection(null)
  }, [drawing, draw.tool])

  const setSize = (size: NoteSize) => onChange({ size, width: NOTE_SIZES[size].w, height: NOTE_SIZES[size].h })

  const onStrokes = (next: Stroke[], newAction: boolean) => {
    if (newAction) {
      undo.current.push(note.strokes)
      if (undo.current.length > 50) undo.current.shift()
      setUndoLen(undo.current.length)
    }
    setSelection(null)
    onChange({ strokes: next })
  }
  const doUndo = () => {
    const prev = undo.current.pop()
    setUndoLen(undo.current.length)
    if (prev) {
      setSelection(null)
      onChange({ strokes: prev })
    }
  }

  const addImages = async (files: File[]) => {
    let strokes = note.strokes
    let last: Stroke | null = null
    for (const f of files.filter((x) => x.type.startsWith('image/'))) {
      try {
        const { src, w, h } = await importImage(f)
        // Đặt giữa tờ, vừa khung (tối đa 60% rộng, 50% cao).
        const k = Math.min(1, (box.w * 0.6) / w, (box.h * 0.5) / h)
        const dw = w * k
        const dh = h * k
        const cx = box.w / 2
        const cy = box.h / 2
        last = { id: newId(), tool: 'image', color: '#000', width: 0, src, points: [cx - dw / 2, cy - dh / 2, cx + dw / 2, cy + dh / 2] }
        strokes = [...strokes, last]
      } catch {
        /* file không phải ảnh hợp lệ thì bỏ qua */
      }
    }
    if (!last) return
    onStrokes(strokes, true)
    // Chọn ngay ảnh vừa chèn để kéo / đổi cỡ.
    setDrawing(true)
    setDraw((d) => ({ ...d, tool: 'select' }))
    const b = last.points
    setSelection({ rect: { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }, ids: [last.id] })
  }

  const font = FONTS[note.font].css
  const sizeKey = (Object.keys(NOTE_SIZES) as NoteSize[]).find((k) => note.width === NOTE_SIZES[k].w && note.height === NOTE_SIZES[k].h)
  const style: React.CSSProperties = sticky
    ? { width: '100vw', height: '100vh', background: note.color, fontFamily: font, resize: 'none', borderRadius: 0 }
    : { width: note.width, height: note.height, background: note.color, fontFamily: font, zoom }

  return (
    <div
      ref={ref}
      data-note-id={note.id}
      className={`paper pattern-${note.pattern} ${sticky ? 'is-sticky' : ''}`}
      style={style}
      draggable={!sticky && !drawing}
      onDragStart={(e) => e.dataTransfer.setData('text/note-id', note.id)}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        void addImages([...e.dataTransfer.files])
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addImages([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <div className="paper-bar">
        <div className="swatches">
          {PAPER_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${c === note.color ? 'on' : ''}`}
              style={{ background: c }}
              title="Màu giấy"
              onClick={() => onChange({ color: c })}
            />
          ))}
        </div>
        <div className="paper-actions">
          <button className={drawing ? 'on' : ''} title="Viết / vẽ" onClick={() => setDrawing((v) => !v)}>
            ✏️
          </button>
          {onRemind && (
            <button className={remindOpen ? 'on' : ''} title="Nhắc tôi về note này" onClick={() => setRemindOpen((v) => !v)}>
              🔔
            </button>
          )}
          <button title={note.pinnedAt ? 'Bỏ ghim' : 'Ghim'} onClick={() => onChange({ pinnedAt: note.pinnedAt ? null : Date.now() })}>
            {note.pinnedAt ? '📍' : '📌'}
          </button>
          {sticky ? (
            <>
              <button className={sticky.alwaysOnTop ? 'on' : ''} title="Luôn nằm trên cùng" onClick={sticky.onToggleTop}>
                🔝
              </button>
              <button title="Thu nhỏ cửa sổ" onClick={sticky.onMinimize}>
                ➖
              </button>
              <button title="Đóng sticky" onClick={sticky.onClose}>
                ✕
              </button>
            </>
          ) : (
            <>
              {onOpenSticky && (
                <button title="Mở thành sticky nổi" onClick={onOpenSticky}>
                  🗔
                </button>
              )}
              <button title="Thu nhỏ thành badge" onClick={() => onChange({ minimized: true })}>
                ➖
              </button>
              <button title="Xóa (vào thùng rác)" onClick={onTrash}>
                🗑
              </button>
            </>
          )}
        </div>
      </div>
      {note.conflictOf && onResolveConflict && (
        <div className="conflict-bar">
          <span>⚠ Hai máy cùng sửa note này. Đây là bản trên máy này.</span>
          <span>
            <button onClick={() => onResolveConflict('copy')}>Giữ bản này</button>
            <button onClick={() => onResolveConflict('original')}>Giữ bản gốc</button>
          </span>
        </div>
      )}
      {remindOpen && onRemind && (
        <div className="remind-pop">
          <b>Nhắc tôi về note này</b>
          <label>
            Ngày
            <input type="date" value={remindDate} onChange={(e) => setRemindDate(e.target.value)} />
          </label>
          <label>
            Giờ (tùy chọn)
            <input type="time" value={remindTime} onChange={(e) => setRemindTime(e.target.value)} />
          </label>
          <div className="remind-pop-actions">
            <button onClick={() => setRemindOpen(false)}>Hủy</button>
            <button
              className="on"
              disabled={!remindDate}
              onClick={() => {
                onRemind({ date: remindDate, time: remindTime || null })
                setRemindOpen(false)
                setRemindTime('')
              }}
            >
              Tạo reminder
            </button>
          </div>
        </div>
      )}
      {drawing && (
        <DrawToolbar
          draw={draw}
          onDraw={setDraw}
          canUndo={undoLen > 0}
          onUndo={doUndo}
          selection={selection}
          onCopy={() => {
            if (selection) copySelection(note.strokes, selection)
            setSelection(null)
            setDraw({ ...draw, tool: 'paste' })
          }}
          onDeleteSelection={() => selection && onStrokes(note.strokes.filter((s) => !selection.ids.includes(s.id)), true)}
          onImport={() => fileRef.current?.click()}
        />
      )}
      <input
        className="paper-title"
        placeholder="Tiêu đề"
        value={note.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <div className="paper-body-wrap">
        {editing ? (
          <textarea
            ref={bodyRef}
            className="paper-body"
            placeholder="Viết gì đó..."
            value={note.body}
            onChange={(e) => onChange({ body: e.target.value })}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <div className="paper-body view" onClick={() => setEditing(true)}>
            {note.body ? <Linkified text={note.body} /> : <span className="placeholder">Viết gì đó...</span>}
          </div>
        )}
      </div>
      <div className="paper-foot">
        {!sticky && (
          <select value={sizeKey ?? 'custom'} onChange={(e) => setSize(e.target.value as NoteSize)} title="Kích thước">
            {!sizeKey && (
              <option value="custom" disabled>
                Tùy chỉnh
              </option>
            )}
            {(Object.keys(NOTE_SIZES) as NoteSize[]).map((s) => (
              <option key={s} value={s}>
                {NOTE_SIZES[s].label}
              </option>
            ))}
          </select>
        )}
        <select value={note.font} onChange={(e) => onChange({ font: e.target.value as NoteFont })} title="Font chữ">
          {Object.entries(FONTS).map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </select>
        <select value={note.pattern} onChange={(e) => onChange({ pattern: e.target.value as NotePattern })} title="Hoa văn">
          {Object.entries(PATTERNS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        {!sticky && (
          <select value={note.folderId ?? ''} onChange={(e) => onChange({ folderId: e.target.value || null })} title="Folder">
            <option value="">Tất cả</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <DrawLayer
        width={box.w}
        height={box.h}
        strokes={note.strokes}
        active={drawing}
        draw={draw}
        selection={selection}
        onSelection={setSelection}
        onStrokes={onStrokes}
      />
    </div>
  )
}

export function NoteBadge({ note, onOpen }: { note: Note; onOpen: () => void }) {
  return (
    <button className={`badge ${note.pinnedAt ? 'pinned' : ''}`} style={{ background: note.color }} onClick={onOpen} title="Mở lại">
      {note.pinnedAt && <span className="bookmark" aria-label="Đã ghim" />}
      <span className="label">{displayTitle(note)}</span>
    </button>
  )
}
