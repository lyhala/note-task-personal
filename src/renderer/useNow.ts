import { useEffect, useState } from 'react'

/** Đồng hồ cho giao diện: cập nhật định kỳ để Hôm nay / Quá hạn tự đổi khi đến giờ. */
export function useNow(intervalMs = 20_000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}
