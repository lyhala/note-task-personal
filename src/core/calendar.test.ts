import assert from 'node:assert/strict'
import { layoutDay, msToWall, newEvent, occurrencesBetween, parseRule, touchesDay, tzOffsetMs, wallToMs, type CalEvent } from './calendar'

const tests: [string, () => void][] = []
const test = (name: string, fn: () => void) => tests.push([name, fn])
const VN = 'Asia/Ho_Chi_Minh'
const NY = 'America/New_York'
const utc = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi)
/** Sự kiện có giờ bắt đầu theo đồng hồ tường của múi giờ tz. */
const timed = (date: string, hhmm: string, minutes: number, tz: string, p: Partial<CalEvent> = {}): CalEvent => {
  const [h, m] = hhmm.split(':').map(Number)
  const start = wallToMs(date, h * 60 + m, tz)
  return newEvent({ id: 'e', calendarId: 'c', title: 'x', start, end: start + minutes * 60_000, tz, ...p })
}
const starts = (events: CalEvent[], from: string, to: string, tz = VN) =>
  occurrencesBetween(events, wallToMs(from, 0, tz), wallToMs(to, 0, tz)).map((o) => msToWall(o.start, tz).date)

test('múi giờ: Việt Nam cố định +7, New York đổi giờ mùa hè', () => {
  assert.equal(wallToMs('2026-10-27', 9 * 60, VN), utc(2026, 10, 27, 2, 0))
  assert.equal(wallToMs('2026-07-01', 9 * 60, NY), utc(2026, 7, 1, 13, 0))
  assert.equal(wallToMs('2026-12-01', 9 * 60, NY), utc(2026, 12, 1, 14, 0))
  assert.equal(tzOffsetMs(utc(2026, 7, 1, 13), NY), -4 * 3_600_000)
  assert.deepEqual(msToWall(utc(2026, 12, 1, 14, 30), NY), { date: '2026-12-01', minutes: 9 * 60 + 30 })
})

test('không lặp: chỉ tính khi chạm khoảng xem', () => {
  const e = timed('2026-10-27', '09:00', 60, VN)
  assert.deepEqual(starts([e], '2026-10-27', '2026-10-28'), ['2026-10-27'])
  assert.deepEqual(starts([e], '2026-10-28', '2026-10-30'), [])
  assert.deepEqual(starts([{ ...e, deletedAt: 1 }], '2026-10-27', '2026-10-28'), [])
})

test('hằng ngày, mỗi 2 ngày, COUNT=3', () => {
  const e = timed('2026-10-01', '09:00', 30, VN, { rrule: 'FREQ=DAILY;INTERVAL=2;COUNT=3' })
  assert.deepEqual(starts([e], '2026-09-01', '2026-12-01'), ['2026-10-01', '2026-10-03', '2026-10-05'])
})

test('hằng tuần thứ Hai và thứ Tư, bắt đầu giữa tuần', () => {
  const e = timed('2026-10-07', '10:00', 60, VN, { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' }) // 7/10 là thứ Tư
  assert.deepEqual(starts([e], '2026-10-01', '2026-10-20'), ['2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19'])
})

test('hai tuần một lần', () => {
  const e = timed('2026-10-05', '10:00', 60, VN, { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO' })
  assert.deepEqual(starts([e], '2026-10-01', '2026-11-10'), ['2026-10-05', '2026-10-19', '2026-11-02'])
})

test('hằng tháng ngày 31 bỏ qua tháng không có ngày 31', () => {
  const e = timed('2026-01-31', '08:00', 30, VN, { rrule: 'FREQ=MONTHLY' })
  assert.deepEqual(starts([e], '2026-01-01', '2026-06-30'), ['2026-01-31', '2026-03-31', '2026-05-31'])
})

test('hằng tháng: thứ Hai đầu tiên và thứ Sáu cuối cùng', () => {
  const first = timed('2026-10-05', '09:00', 30, VN, { rrule: 'FREQ=MONTHLY;BYDAY=1MO' })
  assert.deepEqual(starts([first], '2026-10-01', '2027-01-01'), ['2026-10-05', '2026-11-02', '2026-12-07'])
  const last = timed('2026-10-30', '09:00', 30, VN, { rrule: 'FREQ=MONTHLY;BYDAY=-1FR' })
  assert.deepEqual(starts([last], '2026-10-01', '2027-01-01'), ['2026-10-30', '2026-11-27', '2026-12-25'])
})

test('hằng tháng theo BYMONTHDAY=-1 (ngày cuối tháng)', () => {
  const e = timed('2026-01-31', '08:00', 30, VN, { rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' })
  assert.deepEqual(starts([e], '2026-01-01', '2026-04-01'), ['2026-01-31', '2026-02-28', '2026-03-31'])
})

test('hằng năm, UNTIL và EXDATE', () => {
  const y = timed('2024-02-29', '09:00', 30, VN, { rrule: 'FREQ=YEARLY' })
  assert.deepEqual(starts([y], '2024-01-01', '2029-01-01'), ['2024-02-29', '2028-02-29'])
  const u = timed('2026-10-01', '09:00', 30, VN, { rrule: 'FREQ=DAILY;UNTIL=20261003T000000Z' })
  assert.deepEqual(starts([u], '2026-10-01', '2026-10-10'), ['2026-10-01', '2026-10-02', '2026-10-03'])
  const x = timed('2026-10-01', '09:00', 30, VN, { rrule: 'FREQ=DAILY;COUNT=3' })
  x.exdates = [wallToMs('2026-10-02', 9 * 60, VN)]
  assert.deepEqual(starts([x], '2026-10-01', '2026-10-10'), ['2026-10-01', '2026-10-03'])
})

test('đổi giờ mùa hè: họp 9:00 New York hằng tuần vẫn 9:00 giờ địa phương', () => {
  const e = timed('2026-03-02', '09:00', 60, NY, { rrule: 'FREQ=WEEKLY;BYDAY=MO' })
  const occ = occurrencesBetween([e], utc(2026, 3, 1), utc(2026, 3, 20))
  assert.deepEqual(
    occ.map((o) => o.start),
    [utc(2026, 3, 2, 14), utc(2026, 3, 9, 13), utc(2026, 3, 16, 13)] // đổi giờ ngày 8/3: UTC lệch 1 giờ
  )
  assert.ok(occ.every((o) => msToWall(o.start, NY).minutes === 9 * 60))
})

test('sự kiện cả ngày nhiều ngày và lặp lại', () => {
  const e = newEvent({ id: 'a', calendarId: 'c', allDay: true, startDate: '2026-10-10', endDate: '2026-10-12' })
  const occ = occurrencesBetween([e], wallToMs('2026-10-11', 0, null), wallToMs('2026-10-12', 0, null))
  assert.equal(occ.length, 1)
  assert.ok(touchesDay(occ[0], '2026-10-11'))
  assert.ok(touchesDay(occ[0], '2026-10-12'))
  assert.ok(!touchesDay(occ[0], '2026-10-13'))
  const r = newEvent({ id: 'b', calendarId: 'c', allDay: true, startDate: '2026-10-05', endDate: '2026-10-05', rrule: 'FREQ=WEEKLY;COUNT=3', exdates: ['2026-10-12'] })
  const dates = occurrencesBetween([r], wallToMs('2026-10-01', 0, null), wallToMs('2026-11-30', 0, null)).map((o) => msToWall(o.start, null).date)
  assert.deepEqual(dates, ['2026-10-05', '2026-10-19'])
})

test('RRULE không hợp lệ thì bỏ qua', () => {
  assert.equal(parseRule('FREQ=SECONDLY'), null)
  assert.equal(parseRule('khong-hop-le'), null)
  assert.equal(parseRule('RRULE:FREQ=DAILY')?.freq, 'DAILY')
})

test('bố cục ngày: sự kiện chồng nhau chia cột, sự kiện rời nhau chiếm đủ bề ngang', () => {
  const mk = (id: string, h1: number, h2: number) =>
    occurrencesBetween([timed('2026-10-27', `${String(h1).padStart(2, '0')}:00`, (h2 - h1) * 60, VN, { id })], 0, Infinity)[0]
  const a = mk('a', 9, 11)
  const b = mk('b', 10, 12)
  const c = mk('c', 13, 14)
  const placed = layoutDay([a, b, c])
  const by = Object.fromEntries(placed.map((p) => [p.occ.event.id, p]))
  assert.equal(by.a.columns, 2)
  assert.equal(by.b.columns, 2)
  assert.notEqual(by.a.column, by.b.column)
  assert.equal(by.c.columns, 1)
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log('ok   ', name)
  } catch (e) {
    failed++
    console.log('FAIL ', name, '\n', (e as Error).message)
  }
}
console.log(failed ? `${failed} test lịch lỗi` : `${tests.length} test lịch đạt`)
process.exit(failed ? 1 : 0)
