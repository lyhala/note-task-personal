import assert from 'node:assert/strict'
import { buildBackup, BackupError, parseBackup, planImport } from './backup'
import { newCalendar, newEvent } from './calendar'
import { DEFAULT_SETTINGS, newFolder, newNote, newReminder } from './types'

const local = newCalendar({ id: 'L' })
const google = newCalendar({ id: 'G', kind: 'google' })
const src = {
  notes: [newNote({ title: 'A' }), newNote({ title: 'đã xóa', deletedAt: 5 })],
  folders: [newFolder('F')],
  reminders: [newReminder({ title: 'R' })],
  calendars: [local, google],
  events: [newEvent({ calendarId: 'L', title: 'E1' }), newEvent({ calendarId: 'G', title: 'E2' })],
  settings: DEFAULT_SETTINGS
}
const t = (name: string, fn: () => void) => (fn(), console.log('ok   ', name))

t('xuất chỉ gồm dữ liệu của người dùng, bỏ mục đã xóa và lịch Google', () => {
  const b = buildBackup(src, 123)
  assert.equal(b.notes.length, 1)
  assert.deepEqual(b.calendars.map((c) => c.id), ['L'])
  assert.deepEqual(b.events.map((e) => e.title), ['E1'])
})

t('xuất rồi nhập lại ra cùng dữ liệu', () => {
  const back = parseBackup(JSON.stringify(buildBackup(src)))
  assert.equal(back.notes[0].title, 'A')
  assert.equal(back.reminders[0].title, 'R')
})

t('từ chối file sai', () => {
  assert.throws(() => parseBackup('xin chào'), BackupError)
  assert.throws(() => parseBackup('{"app":"khac"}'), /không phải file sao lưu/)
  assert.throws(() => parseBackup(JSON.stringify({ app: 'note-task-personal', format: 999 })), /mới hơn/)
})

t('gộp: thêm mục mới, chỉ ghi đè khi bản trong file mới hơn', () => {
  const b = buildBackup(src)
  const older = { ...src.notes[0], title: 'Bản cũ', updatedAt: src.notes[0].updatedAt - 10 }
  const newer = { ...src.notes[0], title: 'Bản mới', updatedAt: src.notes[0].updatedAt + 10 }
  const empty = { notes: [], folders: [], reminders: [], calendars: [], events: [] }
  assert.equal(planImport(b, empty).notes.length, 1)
  assert.equal(planImport(b, { ...empty, notes: [newer] }).notes.length, 0)
  assert.equal(planImport(b, { ...empty, notes: [older] }).notes.length, 1)
})
console.log('4 test sao lưu đạt')
