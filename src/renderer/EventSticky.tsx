import { useEffect, useState } from 'react'
import { attendeeNames, type CalEvent } from '@core/calendar'
import { applyTheme } from './theme'

const { storage, desktop } = window.api

const hm = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })

/** Cửa sổ nhắc nổi khi một sự kiện lịch sắp bắt đầu. */
export function EventSticky({ id, start }: { id: string; start: number }) {
  const [ev, setEv] = useState<CalEvent | null>(null)

  useEffect(() => {
    void storage.getSettings().then(applyTheme)
    void storage.listEvents().then((all) => setEv(all.find((e) => e.id === id) ?? null))
  }, [id])

  if (!ev) return <div className="sticky-missing">Không tìm thấy sự kiện.</div>

  const end = start + (ev.end - ev.start)
  const isUrl = /^https?:\/\//.test(ev.location.trim())
  const who = attendeeNames(ev, 4)

  return (
    <div className="remind-paper event">
      <div className="remind-bar">
        <span>📅 Sự kiện sắp bắt đầu</span>
        <button title="Đóng" onClick={() => void desktop.stickyClose()}>
          ✕
        </button>
      </div>
      <h2>{ev.title}</h2>
      <p className="remind-due">
        {new Date(start).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })} · {hm(start)} – {hm(end)}
      </p>
      {ev.location && !isUrl && <p className="remind-notes">📍 {ev.location}</p>}
      {who.text && (
        <p className="remind-notes">
          👥 {who.text}
          {who.more ? ` +${who.more}` : ''}
        </p>
      )}
      <div className="remind-actions">
        {isUrl && (
          <a className="primary-link" href={ev.location.trim()} target="_blank" rel="noreferrer">
            Mở link họp
          </a>
        )}
        <button onClick={() => void desktop.stickyClose()}>Đóng</button>
      </div>
    </div>
  )
}
