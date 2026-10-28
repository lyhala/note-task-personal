import assert from 'node:assert/strict'
import {
  bucketOf,
  currentOccurrence,
  describeRepeat,
  displayOccurrence,
  dueTriggers,
  inQuietHours,
  occurrenceDatesBetween,
  planFire,
  snooze,
  toggleDone
} from './reminders'
import { newReminder, type Reminder } from './types'

const t = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime()
const make = (p: Partial<Reminder>) => newReminder({ title: 'x', createdAt: t(2026, 10, 1), ...p })
const tests: [string, () => void][] = []
const test = (name: string, fn: () => void) => tests.push([name, fn])

test('không lặp: hôm nay / quá hạn / sắp tới / không hạn / xong', () => {
  const r = make({ date: '2026-10-23' })
  assert.equal(bucketOf(r, t(2026, 10, 23, 15)), 'today')
  assert.equal(bucketOf(r, t(2026, 10, 24, 0, 1)), 'overdue')
  assert.equal(bucketOf(make({ date: '2026-10-25' }), t(2026, 10, 23)), 'upcoming')
  assert.equal(bucketOf(make({}), t(2026, 10, 23)), 'nodue')
  assert.equal(bucketOf({ ...r, done: true }, t(2026, 10, 24)), 'done')
  const timed = make({ date: '2026-10-23', time: '14:30' })
  assert.equal(bucketOf(timed, t(2026, 10, 23, 14, 0)), 'today')
  assert.equal(bucketOf(timed, t(2026, 10, 23, 14, 31)), 'overdue')
})

test('hằng ngày: tick chỉ gạch cho hôm nay, mai hiện lại', () => {
  const r = make({ date: '2026-10-01', repeat: 'daily' })
  const now = t(2026, 10, 23, 10)
  assert.equal(currentOccurrence(r, '2026-10-23')!.date, '2026-10-23')
  const ticked = toggleDone(r, now)
  assert.deepEqual(ticked.doneDates, ['2026-10-23'])
  assert.equal(bucketOf(ticked, now), 'today')
  const next = displayOccurrence(ticked, '2026-10-24')!
  assert.equal(next.date, '2026-10-24')
  assert.equal(bucketOf(ticked, t(2026, 10, 24, 10)), 'today')
  assert.deepEqual(toggleDone(ticked, now).doneDates, [])
})

test('hằng tuần: bỏ lỡ thì quá hạn, tick xong chuyển sang tuần sau', () => {
  const r = make({ date: '2026-10-05', repeat: 'weekly' }) // thứ Hai
  const now = t(2026, 10, 21, 10) // thứ Tư
  assert.equal(currentOccurrence(r, '2026-10-21')!.date, '2026-10-19')
  assert.equal(bucketOf(r, now), 'overdue')
  const ticked = toggleDone(r, now)
  assert.equal(displayOccurrence(ticked, '2026-10-21')!.date, '2026-10-26')
  assert.equal(bucketOf(ticked, now), 'upcoming')
})

test('hằng tháng: giữ ngày, cuối tháng ngắn thì lùi về ngày cuối', () => {
  const r = make({ date: '2026-01-31', repeat: 'monthly' })
  assert.equal(currentOccurrence(r, '2026-02-28')!.date, '2026-02-28')
  assert.equal(currentOccurrence(r, '2026-03-31')!.date, '2026-03-31')
  assert.equal(currentOccurrence(r, '2026-04-30')!.date, '2026-04-30')
  assert.equal(currentOccurrence(r, '2026-04-29')!.date, '2026-03-31')
})

test('tùy chọn: mỗi 2 tuần', () => {
  const r = make({ date: '2026-10-01', repeat: 'custom', repeatEvery: 2, repeatUnit: 'week' })
  assert.equal(currentOccurrence(r, '2026-10-23')!.date, '2026-10-15')
  assert.equal(currentOccurrence(r, '2026-10-29')!.date, '2026-10-29')
})

test('mốc nhắc: đến giờ, đúng giờ là live, trễ là lỡ', () => {
  const r = make({ date: '2026-10-23', time: '14:30', createdAt: t(2026, 10, 22, 8) })
  assert.deepEqual(dueTriggers(r, t(2026, 10, 23, 14, 29)), [])
  const live = planFire(r, t(2026, 10, 23, 14, 31))!
  assert.equal(live.live.length, 1)
  assert.equal(live.live[0].at, t(2026, 10, 23, 14, 30))
  assert.equal(live.missed.length, 0)
  const late = planFire(r, t(2026, 10, 23, 16))!
  assert.equal(late.live.length, 0)
  assert.equal(late.missed.length, 1)
})

test('chỉ có ngày: nhắc lúc 9:00; tạo sau 9:00 thì không nhắc lại', () => {
  const r = make({ date: '2026-10-23', createdAt: t(2026, 10, 22) })
  assert.equal(dueTriggers(r, t(2026, 10, 23, 9, 1))[0].at, t(2026, 10, 23, 9))
  const late = make({ date: '2026-10-23', createdAt: t(2026, 10, 23, 12) })
  assert.deepEqual(dueTriggers(late, t(2026, 10, 23, 13)), [])
})

test('nhắc hàng ngày 9:00 cho tới khi tick', () => {
  const r = make({ dailyNudge: true, createdAt: t(2026, 10, 20, 12) })
  const tr = dueTriggers(r, t(2026, 10, 23, 9, 1))
  assert.deepEqual(tr.map((x) => x.at), [t(2026, 10, 21, 9), t(2026, 10, 22, 9), t(2026, 10, 23, 9)])
  assert.ok(tr.every((x) => x.kind === 'daily'))
  const ticked = toggleDone({ ...r, firedAt: t(2026, 10, 22, 9) }, t(2026, 10, 23, 8))
  assert.deepEqual(dueTriggers(ticked, t(2026, 10, 23, 9, 1)), [])
})

test('hoãn: chưa tới giờ thì im, hết hoãn thì nhắc lại', () => {
  const base = make({ date: '2026-10-23', time: '10:00', createdAt: t(2026, 10, 22), firedAt: t(2026, 10, 23, 10) })
  const s = snooze(base, '1h', t(2026, 10, 23, 10, 5))
  assert.equal(s.snoozeUntil, t(2026, 10, 23, 11, 5))
  assert.deepEqual(dueTriggers(s, t(2026, 10, 23, 11)), [])
  const tr = dueTriggers(s, t(2026, 10, 23, 11, 6))
  assert.equal(tr.length, 1)
  assert.equal(tr[0].at, t(2026, 10, 23, 11, 5))
  assert.equal(snooze(base, 'tomorrow', t(2026, 10, 23, 10)).snoozeUntil, t(2026, 10, 24, 9))
})

test('quá hạn: nhắc 9:00 mỗi ngày sau hạn', () => {
  const r = make({ date: '2026-10-21', createdAt: t(2026, 10, 20), firedAt: t(2026, 10, 21, 9) })
  const tr = dueTriggers(r, t(2026, 10, 23, 10))
  assert.deepEqual(tr.map((x) => [x.at, x.kind]), [[t(2026, 10, 22, 9), 'overdue'], [t(2026, 10, 23, 9), 'overdue']])
})

test('đã xong thì không nhắc nữa', () => {
  const r = make({ date: '2026-10-23', time: '10:00', createdAt: t(2026, 10, 22), done: true })
  assert.deepEqual(dueTriggers(r, t(2026, 10, 23, 10, 1)), [])
})

test('giờ yên lặng, kể cả qua nửa đêm', () => {
  const q = { enabled: true, from: '22:00', to: '07:00' }
  assert.equal(inQuietHours(q, t(2026, 10, 23, 23)), true)
  assert.equal(inQuietHours(q, t(2026, 10, 23, 6, 59)), true)
  assert.equal(inQuietHours(q, t(2026, 10, 23, 7)), false)
  assert.equal(inQuietHours(q, t(2026, 10, 23, 12)), false)
  assert.equal(inQuietHours({ ...q, enabled: false }, t(2026, 10, 23, 23)), false)
})

test('My day 3 ngày tới: liệt kê từng lần xuất hiện, bỏ đã tick và đã xong', () => {
  const win = (r: Reminder) => occurrenceDatesBetween(r, '2026-10-23', '2026-10-26')
  assert.deepEqual(win(make({ date: '2026-10-25' })), ['2026-10-25'])
  assert.deepEqual(win(make({ date: '2026-10-27' })), [])
  assert.deepEqual(win(make({ date: '2026-10-25', done: true })), [])
  assert.deepEqual(win(make({ date: '2026-10-01', repeat: 'daily' })), ['2026-10-24', '2026-10-25', '2026-10-26'])
  assert.deepEqual(win(make({ date: '2026-10-01', repeat: 'daily', doneDates: ['2026-10-25'] })), ['2026-10-24', '2026-10-26'])
  assert.deepEqual(win(make({ date: '2026-10-05', repeat: 'weekly' })), ['2026-10-26'])
  assert.deepEqual(win(make({ dailyNudge: true })), [])
})

test('hằng tuần chọn nhiều thứ', () => {
  const r = make({ date: '2026-10-05', repeat: 'weekly', weekdays: [1, 3] }) // thứ Hai và thứ Tư
  assert.deepEqual(occurrenceDatesBetween(r, '2026-10-04', '2026-10-14'), ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14'])
  assert.equal(currentOccurrence(r, '2026-10-09')!.date, '2026-10-07')
  assert.equal(describeRepeat(r), 'Hằng tuần (T2, T4)')
  // ngày gốc không đúng thứ đã chọn: lần đầu là thứ khớp kế tiếp
  assert.equal(occurrenceDatesBetween(make({ date: '2026-10-06', repeat: 'weekly', weekdays: [5] }), '2026-10-01', '2026-10-31')[0], '2026-10-09')
})

test('hằng tháng vào một ngày cố định, tháng ngắn lấy ngày cuối', () => {
  const r = make({ date: '2026-01-01', repeat: 'monthly', monthlyMode: 'day', monthlyDay: 31 })
  assert.deepEqual(occurrenceDatesBetween(r, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  assert.equal(describeRepeat(r), 'Hằng tháng, ngày 31')
})

test('hằng tháng vào thứ n của tháng (thứ Hai đầu tiên, thứ Sáu cuối cùng)', () => {
  const first = make({ date: '2026-10-01', repeat: 'monthly', monthlyMode: 'nth', monthlyNth: 1, monthlyWeekday: 1 })
  assert.deepEqual(occurrenceDatesBetween(first, '2026-09-30', '2026-12-31'), ['2026-10-05', '2026-11-02', '2026-12-07'])
  const last = make({ date: '2026-10-01', repeat: 'monthly', monthlyMode: 'nth', monthlyNth: -1, monthlyWeekday: 5 })
  assert.deepEqual(occurrenceDatesBetween(last, '2026-09-30', '2026-11-30'), ['2026-10-30', '2026-11-27'])
  assert.equal(describeRepeat(first), 'Hằng tháng, thứ hai tuần 1')
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
console.log(failed ? `${failed} test lỗi` : `${tests.length} test đạt`)
process.exit(failed ? 1 : 0)
