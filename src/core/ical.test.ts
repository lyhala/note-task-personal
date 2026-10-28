import assert from 'node:assert/strict'
import { newCalendar, occurrencesBetween } from './calendar'
import { parseIcs } from './ical'

const cal = newCalendar({ id: 'ic', kind: 'ical', readOnly: true })
const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:a1',
  'SUMMARY:Họp\\, nhóm',
  'DESCRIPTION:Dòng 1\\nDòng 2 rất dài được',
  '  gập dòng',
  'DTSTART;TZID=Asia/Ho_Chi_Minh:20261027T090000',
  'DTEND;TZID=Asia/Ho_Chi_Minh:20261027T100000',
  'RRULE:FREQ=DAILY;COUNT=3',
  'EXDATE;TZID=Asia/Ho_Chi_Minh:20261028T090000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:a1',
  'RECURRENCE-ID;TZID=Asia/Ho_Chi_Minh:20261029T090000',
  'SUMMARY:Họp dời',
  'DTSTART;TZID=Asia/Ho_Chi_Minh:20261029T140000',
  'DURATION:PT30M',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:b2',
  'SUMMARY:Nghỉ lễ',
  'DTSTART;VALUE=DATE:20261101',
  'DTEND;VALUE=DATE:20261103',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:c3',
  'SUMMARY:Đã hủy',
  'STATUS:CANCELLED',
  'DTSTART:20261101T000000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:d4',
  'SUMMARY:UTC',
  'DTSTART:20261030T020000Z',
  'DTEND:20261030T030000Z',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const evs = parseIcs(ICS, cal)
const t = (name: string, fn: () => void) => (fn(), console.log('ok   ', name))

t('đọc tiêu đề, mô tả gập dòng, bỏ sự kiện hủy', () => {
  assert.equal(evs.length, 4)
  const a = evs[0]
  assert.equal(a.title, 'Họp, nhóm')
  assert.equal(a.description, 'Dòng 1\nDòng 2 rất dài được gập dòng')
  assert.equal(a.start, Date.UTC(2026, 9, 27, 2))
  assert.equal(a.end - a.start, 3_600_000)
})

t('chuỗi lặp: loại EXDATE và lần bị sửa riêng', () => {
  const occ = occurrencesBetween(evs, Date.UTC(2026, 9, 26), Date.UTC(2026, 10, 1))
  const titles = occ.map((o) => `${new Date(o.start).toISOString().slice(5, 13)} ${o.event.title}`)
  assert.deepEqual(titles, ['10-27T02 Họp, nhóm', '10-29T07 Họp dời', '10-30T02 UTC', '10-31T17 Nghỉ lễ'])
  assert.equal(evs[1].end - evs[1].start, 30 * 60_000)
})

t('sự kiện cả ngày nhiều ngày', () => {
  const h = evs.find((e) => e.title === 'Nghỉ lễ')!
  assert.deepEqual([h.allDay, h.startDate, h.endDate], [true, '2026-11-01', '2026-11-02'])
})
console.log('3 test iCal đạt')
