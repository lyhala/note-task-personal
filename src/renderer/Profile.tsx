import { useRef, useState } from 'react'
import type { Settings } from '@core/types'
import { AvatarImage } from './Icons'

const AVATAR_SIZE = 256
const DEFAULT_AVATAR = 'preset:0'

/** Cắt ảnh vuông ở giữa và thu nhỏ về 256px để lưu gọn trong cài đặt. */
async function toAvatarDataUrl(file: File): Promise<string> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error)
    r.readAsDataURL(file)
  })
  const img = new Image()
  img.src = url
  await img.decode()
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const c = document.createElement('canvas')
  c.width = c.height = AVATAR_SIZE
  c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  return c.toDataURL('image/jpeg', 0.88)
}

interface HeadProps {
  settings: Settings
  onOpen: () => void
}

/** Khối hồ sơ ở đầu thanh bên: avatar tròn, lời chào. */
export function ProfileHead({ settings, onOpen }: HeadProps) {
  const name = settings.profileName?.trim()
  return (
    <button className="profile-head" onClick={onOpen} title="Đổi tên và avatar">
      <span className="avatar">
        <AvatarImage value={settings.avatar ?? DEFAULT_AVATAR} />
      </span>
      <b>{name ? `Xin chào, ${name}!` : 'Xin chào!'} 👋</b>
      <small>Rất vui được gặp lại bạn</small>
    </button>
  )
}

interface PopProps {
  settings: Settings
  onSave: (patch: Partial<Settings>) => void
  onClose: () => void
}

/** Hồ sơ: sửa tên và chọn avatar (ảnh mặc định hoặc ảnh tải lên). Chỉ áp dụng khi bấm Lưu. */
export function ProfilePopover({ settings, onSave, onClose }: PopProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(settings.profileName ?? '')
  const [avatar, setAvatar] = useState(settings.avatar ?? DEFAULT_AVATAR)
  // Ảnh tải lên (đang lưu hoặc vừa chọn) hiện thành một ô riêng cạnh ảnh mặc định.
  const [uploaded, setUploaded] = useState<string | null>(settings.avatar?.startsWith('data:image/') ? settings.avatar : null)
  const usingUploaded = avatar.startsWith('data:image/')
  const changed = name.trim() !== (settings.profileName ?? '').trim() || avatar !== (settings.avatar ?? DEFAULT_AVATAR)

  const save = () => {
    onSave({ profileName: name.trim(), avatar })
    onClose()
  }

  return (
    <div className="profile-pop">
      <div className="pop-head">
        <b>Hồ sơ của bạn</b>
        <button className="icon" onClick={onClose} title="Đóng, không lưu">
          ✕
        </button>
      </div>
      <label>
        Tên hiển thị
        <input value={name} maxLength={24} placeholder="Tên của bạn" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      <span className="lbl">Avatar</span>
      <div className="avatar-tiles">
        <button className={`avatar tile ${!usingUploaded ? 'on' : ''}`} title="Ảnh mặc định" onClick={() => setAvatar(DEFAULT_AVATAR)}>
          <AvatarImage value={DEFAULT_AVATAR} />
        </button>
        {uploaded && (
          <button className={`avatar tile ${usingUploaded ? 'on' : ''}`} title="Ảnh của bạn" onClick={() => setAvatar(uploaded)}>
            <AvatarImage value={uploaded} />
          </button>
        )}
        <button className="upload-tile" title="Tải ảnh lên" onClick={() => fileRef.current?.click()}>
          <span>＋</span>
          <small>Tải ảnh lên</small>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            const url = await toAvatarDataUrl(f)
            setUploaded(url)
            setAvatar(url)
          } catch {
            /* file không phải ảnh hợp lệ thì bỏ qua */
          }
        }}
      />
      <div className="pop-actions end">
        <button onClick={onClose}>Hủy</button>
        <button className="primary" onClick={save} disabled={!changed}>
          Lưu
        </button>
      </div>
    </div>
  )
}
