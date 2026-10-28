import assert from 'node:assert/strict'
import { newEvent } from './calendar'
import { fold, search } from './search'
import { newNote, newReminder } from './types'

const all = new Set(['note', 'reminder', 'event'] as const)
const notes = [
  newNote({ title: 'Nguyễn Thị Quyền chuyển về Việt Nam', body: '<p>Chuẩn bị hồ sơ</p>' }),
  newNote({ title: 'Đã xóa', body: 'Nguyễn', deletedAt: 1 })
]
const reminders = [newReminder({ title: 'Gọi anh Nguyên', date: '2026-10-30', time: '09:00' })]
const events = [newEvent({ title: 'Họp với Nguyễn', location: 'Phòng 3' })]
const input = { notes, reminders, events }

const t = (name: string, fn: () => void) => (fn(), console.log('ok   ', name))

t('bỏ dấu và chữ Đ', () => {
  assert.equal(fold('Đặng Nguyễn'), 'dang nguyen')
})
t('tìm không dấu ra cả ba loại, bỏ note đã xóa', () => {
  const hits = search(input, 'nguyen', all)
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['event', 'note', 'reminder'])
})
t('lọc theo loại và nhiều từ khóa', () => {
  assert.equal(search(input, 'goi anh', new Set(['reminder'])).length, 1)
  assert.equal(search(input, 'goi anh', new Set(['note'])).length, 0)
  assert.equal(search(input, 'ho so chuan', new Set(['note'])).length, 1)
  assert.equal(search(input, '   ', all).length, 0)
})
t('tìm trong thân note HTML, không khớp thẻ', () => {
  assert.equal(search(input, 'ho so', new Set(['note'])).length, 1)
  assert.equal(search(input, 'p>', new Set(['note'])).length, 0)
})
console.log('4 test tìm kiếm đạt')
