import { NOTIFY_LABELS } from '@core/reminders'
import type { AppNotification } from '@core/types'

interface Props {
  items: AppNotification[]
  onOpen: (n: AppNotification) => void
  onReadAll: () => void
}

/** Trang Thông báo: trung tâm thông báo trong app, có trạng thái chưa đọc. */
export function NotificationsPage({ items, onOpen, onReadAll }: Props) {
  const unread = items.filter((n) => !n.readAt).length
  return (
    <div className="page">
      <header className="main-head">
        <h1>Notification</h1>
        {unread > 0 && <button onClick={onReadAll}>Đã đọc tất cả ({unread})</button>}
      </header>
      <div className="page-body">
        {items.length === 0 && <p className="empty">Chưa có thông báo nào.</p>}
        <ul className="notif-list">
          {items.slice(0, 100).map((n) => (
            <li key={n.id} className={n.readAt ? '' : 'unread'} onClick={() => onOpen(n)}>
              <span className={`kind ${n.kind}`}>{NOTIFY_LABELS[n.kind]}</span>
              <span className="t">{n.title}</span>
              <small>{new Date(n.at).toLocaleString('vi-VN')}</small>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
