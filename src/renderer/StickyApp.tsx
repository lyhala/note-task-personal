import { useCallback, useEffect, useRef, useState } from 'react'
import { type Note } from '@core/types'
import { NotePaper } from './NotePaper'
import { applyTheme } from './theme'

const { storage, desktop } = window.api

/** Cửa sổ sticky nổi: một tờ note chiếm trọn cửa sổ, đồng bộ tức thời với cửa sổ chính. */
export function StickyApp({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<Note | null>(null)
  const [top, setTop] = useState(true)
  const latest = useRef<Note | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    void storage.getSettings().then(applyTheme)
    void desktop.stickyGetTop().then(setTop)
    void storage.listNotes().then((all) => {
      const n = all.find((x) => x.id === noteId) ?? null
      latest.current = n
      setNote(n)
    })
    return desktop.onNoteChanged((incoming) => {
      if (incoming.id !== noteId) return
      if (incoming.deletedAt) return void desktop.stickyClose()
      if (latest.current && incoming.updatedAt < latest.current.updatedAt) return
      latest.current = incoming
      setNote(incoming)
    })
  }, [noteId])

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    if (latest.current) void storage.saveNote(latest.current)
  }, [])

  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [flush])

  const onChange = useCallback(
    (patch: Partial<Note>) => {
      if (!latest.current) return
      const next = { ...latest.current, ...patch, updatedAt: Date.now() }
      latest.current = next
      setNote(next)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 300)
    },
    [flush]
  )

  if (!note) return <div className="sticky-missing">Không tìm thấy note.</div>

  return (
    <NotePaper
      note={note}
      folders={[]}
      onChange={onChange}
      onTrash={() => undefined}
      sticky={{
        alwaysOnTop: top,
        onToggleTop: () => void desktop.stickyToggleTop().then(setTop),
        onMinimize: () => void desktop.stickyMinimize(),
        onClose: () => {
          flush()
          void desktop.stickyClose()
        }
      }}
    />
  )
}
