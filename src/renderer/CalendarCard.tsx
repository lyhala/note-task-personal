import { useEffect, useState } from 'react'
import type { CalendarConnStatus } from '../main/calendar-sync'

const { calendar } = window.api

const fmt = (t: number) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

/** Thẻ "Google Calendar" ở cột trái của trang lịch: kết nối, trạng thái, làm mới. */
export function CalendarCard() {
  const [st, setSt] = useState<CalendarConnStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void calendar.status().then(setSt)
    return calendar.onStatus(setSt)
  }, [])
  if (!st) return null

  const connect = async () => {
    setBusy(true)
    try {
      setSt(await calendar.connect())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cal-conn">
      <b>Google Calendar</b>
      {!st.configured && <p className="muted">Chưa cấu hình Google (xem trang Setting).</p>}
      {st.configured && (!st.account || st.account.expired) && (
        <>
          <p className="muted">
            {st.account ? 'Cần đăng nhập lại để dùng Google Calendar.' : 'Kết nối để xem và sửa lịch Google ngay trong app.'}
          </p>
          <button className="primary" disabled={busy} onClick={() => void connect()}>
            {busy ? 'Đang chờ trình duyệt…' : st.account ? 'Đăng nhập lại' : 'Kết nối'}
          </button>
        </>
      )}
      {st.configured && st.account && !st.account.expired && (
        <>
          <p className="muted">
            {st.account.email}
            <br />
            {st.syncing ? 'Đang tải…' : st.lastSyncAt ? `Cập nhật ${fmt(st.lastSyncAt)}` : 'Chưa tải'}
          </p>
          <div className="pop-actions">
            <button disabled={st.syncing} onClick={() => void calendar.refresh().then(setSt)}>
              Làm mới
            </button>
            <button onClick={() => void calendar.disconnect().then(setSt)}>Ngắt</button>
          </div>
        </>
      )}
      {st.lastError && <p className="bad">{st.lastError}</p>}
    </div>
  )
}
