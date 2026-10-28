import { useEffect, useRef } from 'react'

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel?: string
  /** Hành động không hoàn tác được: nút xác nhận tô đỏ. */
  danger?: boolean
  onConfirm: () => void
}

/** Hộp thoại xác nhận cùng phong cách với giao diện (thay cho confirm() của hệ điều hành). */
export function ConfirmDialog({ req, onClose }: { req: ConfirmRequest; onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    ok.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog confirm" role="alertdialog" aria-labelledby="confirm-title">
        <div className={`confirm-icon ${req.danger ? 'danger' : ''}`}>{req.danger ? '🗑' : '❔'}</div>
        <h2 id="confirm-title">{req.title}</h2>
        <p>{req.message}</p>
        <div className="dialog-actions center">
          <button onClick={onClose}>Hủy</button>
          <button
            ref={ok}
            className={`primary ${req.danger ? 'danger-fill' : ''}`}
            onClick={() => {
              onClose()
              req.onConfirm()
            }}
          >
            {req.confirmLabel ?? 'Đồng ý'}
          </button>
        </div>
      </div>
    </div>
  )
}
