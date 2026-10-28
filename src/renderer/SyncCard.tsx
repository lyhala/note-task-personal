import { useEffect, useState } from 'react'
import type { SyncStatus } from '../main/sync-manager'

const { sync } = window.api

const fmt = (t: number) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

/** Thẻ "Đồng bộ Google Drive" trong trang Setting: đăng nhập, trạng thái, đồng bộ ngay. */
export function SyncCard() {
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void sync.status().then(setSt)
    return sync.onStatus(setSt)
  }, [])
  if (!st) return null

  const signIn = async () => {
    setBusy(true)
    try {
      setSt(await sync.signIn())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="theme-panel sync-card">
      <b>Đồng bộ Google Drive</b>
      {!st.configured && (
        <p className="muted">
          Chưa cấu hình Google. Thêm <code>GOOGLE_CLIENT_ID</code> (và <code>GOOGLE_CLIENT_SECRET</code>) vào file <code>.env</code> của dự án rồi build lại app.
        </p>
      )}

      {st.configured && !st.account && (
        <>
          <p className="muted">
            Đăng nhập Google để đồng bộ note và reminder giữa các máy. App chỉ xin quyền thư mục ẩn của riêng nó trên Drive, không đọc file khác của bạn.
          </p>
          <button className="primary" disabled={busy} onClick={() => void signIn()}>
            {busy ? 'Đang chờ đăng nhập trong trình duyệt…' : 'Đăng nhập Google'}
          </button>
        </>
      )}

      {st.configured && st.account && (
        <>
          <p>
            Tài khoản: <b>{st.account.email}</b>
          </p>
          {st.account.expired ? (
            <>
              <p className="bad">Cần đăng nhập lại (phiên hết hạn hoặc Google chưa cấp đủ quyền). Khi đăng nhập, nhớ tick đủ tất cả các ô quyền. Nếu app Google đang ở chế độ Testing thì phải đăng nhập lại mỗi 7 ngày.</p>
              <button className="primary" disabled={busy} onClick={() => void signIn()}>
                {busy ? 'Đang chờ đăng nhập…' : 'Đăng nhập lại'}
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                {st.syncing
                  ? 'Đang đồng bộ…'
                  : st.lastSyncAt
                    ? `Đã đồng bộ lúc ${fmt(st.lastSyncAt)}${st.lastResult ? ` (nhận ${st.lastResult.pulled}, gửi ${st.lastResult.pushed}${st.lastResult.conflicts ? `, ${st.lastResult.conflicts} xung đột` : ''})` : ''}`
                    : 'Chưa đồng bộ lần nào.'}
              </p>
              <label>
                Tự động đồng bộ
                <input type="checkbox" checked={st.auto} onChange={(e) => void sync.setAuto(e.target.checked).then(setSt)} />
              </label>
              <div className="pop-actions">
                <button disabled={st.syncing} onClick={() => void sync.now().then(setSt)}>
                  Đồng bộ ngay
                </button>
              </div>
            </>
          )}
          <div className="pop-actions">
            <button onClick={() => void sync.signOut().then(setSt)}>Đăng xuất</button>
          </div>
        </>
      )}

      {st.lastError && <p className="bad">{st.lastError}</p>}
    </div>
  )
}
