import { useEffect, useState } from 'react'
import { SNOOZE_LABELS, bucketOf, describeDue, describeRepeat, isDoneNow, dateStr, snooze, toggleDone, type SnoozeOption } from '@core/reminders'
import type { Reminder } from '@core/types'
import { applyTheme } from './theme'
import { useNow } from './useNow'

const { storage, desktop } = window.api

/** Cửa sổ nhắc việc nổi: hiện giữa màn hình khi reminder đến giờ. Tick xong thì tờ biến mất. */
export function ReminderSticky({ id }: { id: string }) {
  const [r, setR] = useState<Reminder | null>(null)
  const now = useNow(15_000)

  useEffect(() => {
    void storage.getSettings().then(applyTheme)
    void storage.listReminders().then((all) => setR(all.find((x) => x.id === id) ?? null))
    return desktop.onReminderChanged((incoming) => {
      if (incoming.id !== id) return
      const t = Date.now()
      // Đã tick xong, đã xóa hoặc đã hoãn ở nơi khác thì không cần tờ nhắc này nữa.
      if (incoming.deletedAt || isDoneNow(incoming, dateStr(new Date(t))) || (incoming.snoozeUntil && incoming.snoozeUntil > t)) void desktop.stickyClose()
      else setR(incoming)
    })
  }, [id])

  if (!r) return <div className="sticky-missing">Không tìm thấy reminder.</div>

  const late = bucketOf(r, now) === 'overdue'
  const finish = async (next: Reminder) => {
    await storage.saveReminder(next)
    void desktop.stickyClose()
  }

  return (
    <div className={`remind-paper ${late ? 'late' : ''}`}>
      <div className="remind-bar">
        <span>{late ? '⚠️ Quá hạn' : '⏰ Nhắc việc'}</span>
        <button title="Đóng (reminder vẫn còn)" onClick={() => void desktop.stickyClose()}>
          ✕
        </button>
      </div>
      <h2>{r.starred ? '★ ' : ''}{r.title}</h2>
      <p className="remind-due">
        {describeDue(r, now)}
        {describeRepeat(r) && ` · 🔁 ${describeRepeat(r)}`}
      </p>
      {r.notes && <p className="remind-notes">{r.notes}</p>}
      <div className="remind-actions">
        <button className="primary" onClick={() => void finish(toggleDone(r, Date.now()))}>
          ✓ Xong
        </button>
        {(Object.keys(SNOOZE_LABELS) as SnoozeOption[]).map((k) => (
          <button key={k} onClick={() => void finish(snooze(r, k, Date.now()))}>
            Hoãn {SNOOZE_LABELS[k]}
          </button>
        ))}
      </div>
    </div>
  )
}
