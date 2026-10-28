// Tạo resources/tray.png (32x32): tờ giấy vàng có góc gấp. Chạy: node scripts/make-tray-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const N = 32
const px = Buffer.alloc(N * N * 4)
const set = (x, y, [r, g, b, a]) => { const i = (y * N + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a }
for (let y = 3; y < 29; y++) for (let x = 5; x < 27; x++) {
  const edge = x === 5 || x === 26 || y === 3 || y === 28
  const fold = x + (28 - y) < 8 // góc dưới trái... gấp ở góc dưới phải
  const cut = x - 26 + (y - 28) > -7 && x > 19 && y > 21
  if (cut) continue
  const foldPx = x - 26 + (y - 28) === -7 || (x > 19 && y > 21 && x - 19 + y - 21 < 9 && x - 19 + y - 21 > 6)
  set(x, y, edge || foldPx ? [74, 63, 20, 255] : y > 21 && x > 19 ? [229, 200, 70, 255] : [255, 226, 90, 255])
}
for (let y = 10; y <= 20; y += 5) for (let x = 9; x < 23; x++) set(x, y, [120, 100, 30, 255])

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
const raw = Buffer.alloc((N * 4 + 1) * N)
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4) }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
mkdirSync('resources', { recursive: true })
writeFileSync('resources/tray.png', png)
console.log('resources/tray.png', png.length, 'bytes')
