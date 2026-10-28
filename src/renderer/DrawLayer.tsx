import { useCallback, useEffect, useRef, useState } from 'react'
import {
  HIGHLIGHT_COLORS,
  ICONS,
  ICON_SIZES,
  PEN_COLORS,
  SHAPES,
  newId,
  type ShapeKind,
  type Stroke
} from '@core/types'

export type DrawTool = 'pen' | 'highlight' | 'shape' | 'icon' | 'eraser' | 'select' | 'paste'
export interface DrawState {
  tool: DrawTool
  penColor: string
  highlightColor: string
  thick: boolean
  shapeKind: ShapeKind
  fill: boolean
  glyph: string
  iconSize: keyof typeof ICON_SIZES
}
export const DEFAULT_DRAW: DrawState = {
  tool: 'pen',
  penColor: PEN_COLORS[0],
  highlightColor: HIGHLIGHT_COLORS[0],
  thick: false,
  shapeKind: 'rect',
  fill: false,
  glyph: ICONS[0],
  iconSize: 'M'
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Selection {
  rect: Rect
  ids: string[]
}

const CLIP_KEY = 'ntp-stroke-clip'
const ERASE_RADIUS = 10
const MIN_DRAG = 4
const HANDLE = 14
const DEFAULT_SHAPE_SIZE = 60

const round = (n: number) => Math.round(n * 10) / 10

// ---- Ảnh nhúng: cache theo nội dung, vẽ lại khi ảnh tải xong ----
const imgCache = new Map<string, HTMLImageElement>()
const imgListeners = new Set<() => void>()
function getImage(src: string): HTMLImageElement | null {
  let im = imgCache.get(src)
  if (!im) {
    im = new Image()
    im.onload = () => imgListeners.forEach((fn) => fn())
    im.src = src
    imgCache.set(src, im)
  }
  return im.complete && im.naturalWidth ? im : null
}

// ---- Hình học ----
function bbox(s: Stroke): Rect {
  const [x0, y0, x1, y1] = s.points
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}

/** Hộp bao của một đối tượng bất kỳ (dùng để chọn vùng và vẽ khung chọn). */
function itemBox(s: Stroke): Rect {
  if (s.tool === 'icon') {
    const size = s.size ?? 44
    return { x: s.points[0] - size / 2, y: s.points[1] - size / 2, w: size, h: size }
  }
  if (s.tool === 'shape' || s.tool === 'image') {
    const b = bbox(s)
    const pad = s.tool === 'shape' ? s.width / 2 : 0
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < s.points.length; i += 2) {
    minX = Math.min(minX, s.points[i])
    maxX = Math.max(maxX, s.points[i])
    minY = Math.min(minY, s.points[i + 1])
    maxY = Math.max(maxY, s.points[i + 1])
  }
  const pad = s.width / 2
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

const intersects = (a: Rect, b: Rect) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y

interface Xform {
  mode: 'move' | 'scale'
  start: { x: number; y: number }
  rect: Rect
  ids: string[]
  dx: number
  dy: number
  k: number
}

function transformStroke(s: Stroke, t: Xform): Stroke {
  if (!t.ids.includes(s.id)) return s
  if (t.mode === 'move') return { ...s, points: s.points.map((v, i) => round(v + (i % 2 ? t.dy : t.dx))) }
  const ox = t.rect.x
  const oy = t.rect.y
  return {
    ...s,
    points: s.points.map((v, i) => round(i % 2 ? oy + (v - oy) * t.k : ox + (v - ox) * t.k)),
    width: s.tool === 'icon' || s.tool === 'image' ? s.width : Math.max(1, round(s.width * t.k)),
    size: s.size ? Math.round(s.size * t.k) : s.size
  }
}

const xformRect = (r: Rect, t: Xform): Rect =>
  t.mode === 'move' ? { ...r, x: r.x + t.dx, y: r.y + t.dy } : { ...r, w: r.w * t.k, h: r.h * t.k }

function shapePath(ctx: CanvasRenderingContext2D, kind: ShapeKind, s: Stroke) {
  const { x, y, w, h } = bbox(s)
  const [x0, y0, x1, y1] = s.points
  ctx.beginPath()
  switch (kind) {
    case 'rect':
      ctx.rect(x, y, w, h)
      break
    case 'ellipse':
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2)
      break
    case 'triangle':
      ctx.moveTo(x + w / 2, y)
      ctx.lineTo(x + w, y + h)
      ctx.lineTo(x, y + h)
      ctx.closePath()
      break
    case 'diamond':
      ctx.moveTo(x + w / 2, y)
      ctx.lineTo(x + w, y + h / 2)
      ctx.lineTo(x + w / 2, y + h)
      ctx.lineTo(x, y + h / 2)
      ctx.closePath()
      break
    case 'star': {
      const cx = x + w / 2
      const cy = y + h / 2
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.4 : 1
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const px = cx + Math.cos(a) * r * (w / 2)
        const py = cy + Math.sin(a) * r * (h / 2)
        if (i) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.closePath()
      break
    }
    case 'line':
    case 'arrow': {
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      if (kind === 'arrow') {
        const a = Math.atan2(y1 - y0, x1 - x0)
        const head = Math.max(10, s.width * 4)
        for (const d of [Math.PI / 7, -Math.PI / 7]) {
          ctx.moveTo(x1, y1)
          ctx.lineTo(x1 - head * Math.cos(a - d), y1 - head * Math.sin(a - d))
        }
      }
      break
    }
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const p = s.points
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = s.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (s.tool === 'image' && s.src) {
    const im = getImage(s.src)
    const b = bbox(s)
    if (im) ctx.drawImage(im, b.x, b.y, b.w, b.h)
    else {
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,.08)'
      ctx.fillRect(b.x, b.y, b.w, b.h)
      ctx.restore()
    }
    return
  }
  if (s.tool === 'icon') {
    ctx.font = `${s.size ?? 44}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(s.glyph ?? '⭐', p[0], p[1])
    return
  }
  if (s.tool === 'shape' && s.shape) {
    shapePath(ctx, s.shape, s)
    if (s.fill && s.shape !== 'line' && s.shape !== 'arrow') ctx.fill()
    ctx.stroke()
    return
  }
  if (p.length < 4) {
    ctx.beginPath()
    ctx.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(p[0], p[1])
  for (let i = 2; i < p.length - 2; i += 2) {
    ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2)
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1])
  ctx.stroke()
}

function nearStroke(s: Stroke, x: number, y: number, r: number): boolean {
  if (s.tool === 'icon' || s.tool === 'image' || (s.tool === 'shape' && s.shape !== 'line' && s.shape !== 'arrow')) {
    const b = itemBox(s)
    return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r
  }
  const p = s.points
  const lim = r + s.width / 2
  if (p.length < 4) return Math.hypot(p[0] - x, p[1] - y) <= lim
  for (let i = 0; i < p.length - 2; i += 2) {
    const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= lim) return true
  }
  return false
}

const layerOf = (s: Stroke): 'under' | 'hl' | 'pen' =>
  s.tool === 'highlight' ? 'hl' : s.tool === 'pen' ? 'pen' : 'under'

interface LayerProps {
  width: number
  height: number
  strokes: Stroke[]
  active: boolean
  draw: DrawState
  selection: Selection | null
  onSelection: (s: Selection | null) => void
  /** newAction = true khi bắt đầu một thao tác mới (để hoàn tác theo từng thao tác). */
  onStrokes: (next: Stroke[], newAction: boolean) => void
}

/**
 * Ba lớp canvas: "under" (hình, icon, ảnh) nằm dưới chữ để chữ đè lên hình được;
 * "hl" (highlight, nhân màu) và "pen" (bút, khung chọn, nhận chuột) nằm trên chữ.
 */
export function DrawLayer({ width, height, strokes, active, draw, selection, onSelection, onStrokes }: LayerProps) {
  const underRef = useRef<HTMLCanvasElement>(null)
  const hlRef = useRef<HTMLCanvasElement>(null)
  const penRef = useRef<HTMLCanvasElement>(null)
  const live = useRef<Stroke | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const rubberRef = useRef<Rect | null>(null)
  const xform = useRef<Xform | null>(null)
  const erasing = useRef(false)
  const erased = useRef(false)
  const [, bump] = useState(0)
  const dpr = window.devicePixelRatio || 1

  const setRubber = (r: Rect | null) => {
    rubberRef.current = r
    bump((n) => n + 1)
  }

  const render = () => {
    const t = xform.current
    const items = t ? strokes.map((s) => transformStroke(s, t)) : strokes
    const all = live.current ? [...items, live.current] : items
    const canvases = { under: underRef.current, hl: hlRef.current, pen: penRef.current }
    for (const key of ['under', 'hl', 'pen'] as const) {
      const c = canvases[key]
      if (!c) continue
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      all.filter((s) => layerOf(s) === key).forEach((s) => drawStroke(ctx, s))
      if (key === 'pen') {
        const r = rubberRef.current ?? (selection ? (t ? xformRect(selection.rect, t) : selection.rect) : null)
        if (r) {
          ctx.save()
          ctx.setLineDash([6, 4])
          ctx.strokeStyle = '#2f6fed'
          ctx.fillStyle = 'rgba(47,111,237,.08)'
          ctx.lineWidth = 1.5
          ctx.fillRect(r.x, r.y, r.w, r.h)
          ctx.strokeRect(r.x, r.y, r.w, r.h)
          if (!rubberRef.current) {
            ctx.setLineDash([])
            ctx.fillStyle = '#2f6fed'
            ctx.fillRect(r.x + r.w - 5, r.y + r.h - 5, 10, 10)
          }
          ctx.restore()
        }
      }
    }
  }

  useEffect(() => {
    render()
  })
  useEffect(() => {
    const fn = () => bump((n) => n + 1)
    imgListeners.add(fn)
    return () => void imgListeners.delete(fn)
  }, [])

  // Kích thước canvas đổi (kéo mép tờ, đổi cỡ) cần vẽ lại ngay.
  const dims = useCallback(() => ({ w: Math.round(width * dpr), h: Math.round(height * dpr) }), [width, height, dpr])

  const pos = (e: React.PointerEvent) => {
    const c = penRef.current!
    const r = c.getBoundingClientRect()
    // offsetWidth là kích thước chưa zoom, rect là kích thước đã zoom: tỉ lệ này quy về toạ độ của tờ giấy.
    const k = c.offsetWidth / r.width
    return { x: round((e.clientX - r.left) * k), y: round((e.clientY - r.top) * k) }
  }

  const onDown = (e: React.PointerEvent) => {
    if (!active || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = pos(e)
    const t = draw.tool
    if (t === 'pen' || t === 'highlight') {
      live.current = {
        id: newId(),
        tool: t,
        color: t === 'pen' ? draw.penColor : draw.highlightColor,
        width: t === 'highlight' ? 18 : draw.thick ? 5 : 2,
        points: [x, y]
      }
      bump((n) => n + 1)
    } else if (t === 'shape') {
      live.current = {
        id: newId(),
        tool: 'shape',
        shape: draw.shapeKind,
        fill: draw.fill,
        color: draw.penColor,
        width: draw.thick ? 5 : 2,
        points: [x, y, x, y]
      }
      bump((n) => n + 1)
    } else if (t === 'icon') {
      onStrokes([...strokes, { id: newId(), tool: 'icon', color: '#000', width: 0, points: [x, y], glyph: draw.glyph, size: ICON_SIZES[draw.iconSize] }], true)
    } else if (t === 'eraser') {
      erasing.current = true
      eraseAt(x, y, true)
    } else if (t === 'select') {
      const r = selection?.rect
      if (selection && r && Math.abs(x - (r.x + r.w)) <= HANDLE && Math.abs(y - (r.y + r.h)) <= HANDLE) {
        xform.current = { mode: 'scale', start: { x, y }, rect: r, ids: selection.ids, dx: 0, dy: 0, k: 1 }
      } else if (selection && r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        xform.current = { mode: 'move', start: { x, y }, rect: r, ids: selection.ids, dx: 0, dy: 0, k: 1 }
      } else {
        dragStart.current = { x, y }
        onSelection(null)
        setRubber({ x, y, w: 0, h: 0 })
      }
    } else if (t === 'paste') {
      pasteAt(x, y)
    }
  }

  const eraseAt = (x: number, y: number, first: boolean) => {
    if (first) erased.current = false
    const keep = strokes.filter((s) => !nearStroke(s, x, y, ERASE_RADIUS))
    if (keep.length === strokes.length) return
    onStrokes(keep, !erased.current)
    erased.current = true
  }

  const onMove = (e: React.PointerEvent) => {
    if (!active) return
    const { x, y } = pos(e)
    const cur = live.current
    const xf = xform.current
    if (xf) {
      if (xf.mode === 'move') {
        xf.dx = x - xf.start.x
        xf.dy = y - xf.start.y
      } else {
        const kx = (x - xf.rect.x) / Math.max(xf.rect.w, 1)
        const ky = (y - xf.rect.y) / Math.max(xf.rect.h, 1)
        xf.k = Math.max(0.1, (kx + ky) / 2)
      }
      bump((n) => n + 1)
    } else if (cur?.tool === 'shape') {
      cur.points[2] = x
      cur.points[3] = y
      bump((n) => n + 1)
    } else if (cur) {
      cur.points.push(x, y)
      bump((n) => n + 1)
    } else if (erasing.current) {
      eraseAt(x, y, false)
    } else if (dragStart.current) {
      const s = dragStart.current
      setRubber({ x: Math.min(s.x, x), y: Math.min(s.y, y), w: Math.abs(x - s.x), h: Math.abs(y - s.y) })
    }
  }

  const onUp = () => {
    const cur = live.current
    if (cur) {
      live.current = null
      if (cur.tool === 'shape') {
        const [x0, y0, x1, y1] = cur.points
        // Bấm không kéo thì đặt hình cỡ mặc định.
        if (Math.hypot(x1 - x0, y1 - y0) < MIN_DRAG) {
          const half = DEFAULT_SHAPE_SIZE / 2
          cur.points = cur.shape === 'line' || cur.shape === 'arrow' ? [x0 - half, y0, x0 + half, y0] : [x0 - half, y0 - half, x0 + half, y0 + half]
        }
      }
      onStrokes([...strokes, cur], true)
    }
    erasing.current = false

    const xf = xform.current
    if (xf) {
      xform.current = null
      if (Math.hypot(xf.dx, xf.dy) > 0.5 || Math.abs(xf.k - 1) > 0.01) {
        onStrokes(strokes.map((s) => transformStroke(s, xf)), true)
        onSelection({ rect: xformRect(xf.rect, xf), ids: xf.ids })
      } else bump((n) => n + 1)
    }

    const r = rubberRef.current
    if (dragStart.current && r) {
      const start = dragStart.current
      dragStart.current = null
      setRubber(null)
      let ids: string[]
      let rect: Rect = r
      if (r.w <= MIN_DRAG && r.h <= MIN_DRAG) {
        // Bấm một điểm: chọn đối tượng trên cùng tại điểm đó.
        const hit = [...strokes].reverse().find((s) => nearStroke(s, start.x, start.y, 6))
        ids = hit ? [hit.id] : []
        if (hit) rect = itemBox(hit)
      } else {
        const hits = strokes.filter((s) => intersects(itemBox(s), r))
        ids = hits.map((s) => s.id)
      }
      onSelection(ids.length ? { rect, ids } : null)
    }
  }

  const pasteAt = (x: number, y: number) => {
    try {
      const clip = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null') as Stroke[] | null
      if (!clip?.length) return
      const added = clip.map((s) => ({ ...s, id: newId(), points: s.points.map((v, i) => round(v + (i % 2 ? y : x))) }))
      onStrokes([...strokes, ...added], true)
    } catch {
      /* bộ nhớ tạm hỏng thì bỏ qua */
    }
  }

  const cursor = !active ? 'default' : draw.tool === 'eraser' ? 'cell' : draw.tool === 'paste' || draw.tool === 'icon' ? 'copy' : draw.tool === 'select' ? 'default' : 'crosshair'
  const common: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width, height }
  const d = dims()

  return (
    <>
      <canvas ref={underRef} width={d.w} height={d.h} className="draw-under" style={common} />
      <canvas ref={hlRef} width={d.w} height={d.h} className="draw-hl" style={common} />
      <canvas
        ref={penRef}
        width={d.w}
        height={d.h}
        className="draw-pen"
        style={{ ...common, pointerEvents: active ? 'auto' : 'none', cursor, touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </>
  )
}

/** Sao chép nét trong vùng chọn vào bộ nhớ tạm chung (dùng được giữa các tờ và cửa sổ sticky). */
export function copySelection(strokes: Stroke[], sel: Selection): void {
  const chosen = strokes.filter((s) => sel.ids.includes(s.id))
  if (!chosen.length) return
  let minX = Infinity
  let minY = Infinity
  for (const s of chosen) {
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i])
      minY = Math.min(minY, s.points[i + 1])
    }
  }
  const norm = chosen.map((s) => ({ ...s, points: s.points.map((v, i) => round(v - (i % 2 ? minY : minX))) }))
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(norm))
  } catch {
    /* ảnh quá lớn so với bộ nhớ tạm: bỏ qua */
  }
}

export function hasClip(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null')?.length
  } catch {
    return false
  }
}

const TOOLS: { id: DrawTool; icon: string; label: string }[] = [
  { id: 'pen', icon: '✒️', label: 'Bút' },
  { id: 'highlight', icon: '🖍', label: 'Highlight' },
  { id: 'shape', icon: '◻', label: 'Hình dạng' },
  { id: 'icon', icon: '😀', label: 'Icon' },
  { id: 'eraser', icon: '🧽', label: 'Tẩy' },
  { id: 'select', icon: '⬚', label: 'Chọn / di chuyển / đổi cỡ' },
  { id: 'paste', icon: '📋', label: 'Dán (bấm vào chỗ muốn đặt)' }
]

function ColorRow({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  const custom = !colors.includes(value)
  return (
    <>
      {colors.map((c) => (
        <button key={c} className={`swatch ${c === value ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => onPick(c)} />
      ))}
      {custom && <button className="swatch on" style={{ background: value }} title="Màu đang chọn" />}
      <label className="wheel" title="Chọn màu tùy ý">
        <input type="color" value={value} onChange={(e) => onPick(e.target.value)} />
      </label>
    </>
  )
}

interface BarProps {
  draw: DrawState
  onDraw: (d: DrawState) => void
  canUndo: boolean
  onUndo: () => void
  selection: Selection | null
  onCopy: () => void
  onDeleteSelection: () => void
  onImport: () => void
}

export function DrawToolbar({ draw, onDraw, canUndo, onUndo, selection, onCopy, onDeleteSelection, onImport }: BarProps) {
  const isHl = draw.tool === 'highlight'
  const colors = isHl ? HIGHLIGHT_COLORS : PEN_COLORS
  const current = isHl ? draw.highlightColor : draw.penColor
  const setColor = (c: string) => onDraw(isHl ? { ...draw, highlightColor: c } : { ...draw, penColor: c })
  const showColors = draw.tool === 'pen' || isHl || draw.tool === 'shape'
  const showThick = draw.tool === 'pen' || draw.tool === 'shape'
  return (
    <div className="draw-bar">
      <div className="draw-row">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={draw.tool === t.id ? 'on' : ''}
            title={t.label}
            disabled={t.id === 'paste' && !hasClip()}
            onClick={() => onDraw({ ...draw, tool: t.id })}
          >
            {t.icon}
          </button>
        ))}
        <button title="Chèn ảnh từ máy" onClick={onImport}>
          🖼
        </button>
        <button title="Hoàn tác" disabled={!canUndo} onClick={onUndo}>
          ↩
        </button>
      </div>
      {draw.tool === 'select' && (
        <div className="draw-row">
          {selection ? (
            <>
              <button onClick={onCopy}>Sao chép</button>
              <button onClick={onDeleteSelection}>Xóa</button>
              <small>Kéo trong khung để di chuyển, kéo ô vuông góc dưới để đổi cỡ</small>
            </>
          ) : (
            <small>Kéo để khoanh vùng, hoặc bấm vào một hình/ảnh để chọn</small>
          )}
        </div>
      )}
      {showThick && (
        <div className="draw-row">
          <button className={!draw.thick ? 'on' : ''} title="Nét mảnh" onClick={() => onDraw({ ...draw, thick: false })}>
            ─ Mảnh
          </button>
          <button className={draw.thick ? 'on' : ''} title="Nét đậm" onClick={() => onDraw({ ...draw, thick: true })}>
            ━ Đậm
          </button>
        </div>
      )}
      {showColors && (
        <div className="draw-row">
          <ColorRow colors={colors} value={current} onPick={setColor} />
        </div>
      )}
      {draw.tool === 'shape' && (
        <div className="draw-row">
          {SHAPES.map((s) => (
            <button key={s.kind} className={draw.shapeKind === s.kind ? 'on' : ''} title={s.label} onClick={() => onDraw({ ...draw, shapeKind: s.kind })}>
              {s.icon}
            </button>
          ))}
          <button
            className={draw.fill ? 'on' : ''}
            title={draw.fill ? 'Đang tô đặc' : 'Đang chỉ viền'}
            disabled={draw.shapeKind === 'line' || draw.shapeKind === 'arrow'}
            onClick={() => onDraw({ ...draw, fill: !draw.fill })}
          >
            ▣ Tô đặc
          </button>
        </div>
      )}
      {draw.tool === 'icon' && (
        <>
          <div className="draw-row icons">
            {ICONS.map((g) => (
              <button key={g} className={draw.glyph === g ? 'on' : ''} onClick={() => onDraw({ ...draw, glyph: g })}>
                {g}
              </button>
            ))}
          </div>
          <div className="draw-row">
            {(Object.keys(ICON_SIZES) as (keyof typeof ICON_SIZES)[]).map((s) => (
              <button key={s} className={draw.iconSize === s ? 'on' : ''} title="Cỡ icon" onClick={() => onDraw({ ...draw, iconSize: s })}>
                {s}
              </button>
            ))}
            <small>Bấm vào tờ giấy để đặt icon</small>
          </div>
        </>
      )}
    </div>
  )
}
