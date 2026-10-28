import assert from 'node:assert/strict'
import { newCalendar, newEvent, wallToMs } from '@core/calendar'
import { GoogleApiError, GoogleCalendarClient, fromGoogle, isReadOnlyRole, toGoogleBody, type GEvent } from './google-calendar'

const cal = newCalendar({ id: 'cal1', kind: 'google', account: 'a@b.com', remoteId: 'primary' })
const tests: [string, () => Promise<void> | void][] = []
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn])

test('chuyển sự kiện có giờ, người tham dự, link Meet và giờ nhắc từ Google', () => {
  const g: GEvent = {
    id: 'abc_20261027T020000Z',
    etag: '"e1"',
    summary: 'Họp nhóm',
    location: 'Phòng 3',
    hangoutLink: 'https://meet.google.com/xyz',
    start: { dateTime: '2026-10-27T09:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
    end: { dateTime: '2026-10-27T10:00:00+07:00' },
    recurringEventId: 'abc',
    attendees: [
      { email: 'me@x.com', self: true, responseStatus: 'accepted' },
      { email: 'lan@x.com', displayName: 'Lan', responseStatus: 'needsAction', organizer: true }
    ],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 20 }] }
  }
  const e = fromGoogle(cal, g)
  assert.equal(e.id, 'g:cal1:abc_20261027T020000Z')
  assert.equal(e.title, 'Họp nhóm')
  assert.equal(e.start, Date.UTC(2026, 9, 27, 2, 0))
  assert.equal(e.end - e.start, 3_600_000)
  assert.equal(e.tz, 'Asia/Ho_Chi_Minh')
  assert.equal(e.location, 'Phòng 3')
  assert.equal(e.link, 'https://meet.google.com/xyz')
  assert.equal(e.reminderMinutes, 20)
  assert.equal(e.remote?.recurringId, 'abc')
  assert.equal(e.attendees.length, 2)
  assert.equal(e.attendees[1].name, 'Lan')
  assert.equal(e.rrule, null)
})

test('sự kiện cả ngày: ngày kết thúc của Google là ngày loại trừ', () => {
  const one = fromGoogle(cal, { id: 'a', summary: 'Nghỉ', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } })
  assert.equal(one.allDay, true)
  assert.deepEqual([one.startDate, one.endDate], ['2026-10-10', '2026-10-10'])
  assert.equal(one.end - one.start, wallToMs('2026-10-11', 0, null) - wallToMs('2026-10-10', 0, null))
  const multi = fromGoogle(cal, { id: 'b', start: { date: '2026-10-10' }, end: { date: '2026-10-13' } })
  assert.deepEqual([multi.startDate, multi.endDate], ['2026-10-10', '2026-10-12'])
  assert.equal(multi.title, '(Không có tiêu đề)')
})

test('giờ nhắc: mặc định, không nhắc, và tự đặt', () => {
  const base = { id: 'x', start: { dateTime: '2026-10-27T09:00:00Z' }, end: { dateTime: '2026-10-27T10:00:00Z' } }
  assert.equal(fromGoogle(cal, { ...base, reminders: { useDefault: true } }).reminderMinutes, null)
  assert.equal(fromGoogle(cal, { ...base, reminders: { useDefault: false, overrides: [] } }).reminderMinutes, -1)
  assert.equal(fromGoogle(cal, { ...base }).reminderMinutes, null)
})

test('tạo thân yêu cầu gửi lên Google: có giờ, cả ngày, nhắc, quy tắc lặp', () => {
  const timed = newEvent({ title: 'A', start: Date.UTC(2026, 9, 27, 2), end: Date.UTC(2026, 9, 27, 3), tz: 'Asia/Ho_Chi_Minh', rrule: 'FREQ=WEEKLY;BYDAY=TU', reminderMinutes: 10 })
  const b = toGoogleBody(timed, { includeRecurrence: true }) as any
  assert.equal(b.start.dateTime, '2026-10-27T02:00:00.000Z')
  assert.equal(b.start.timeZone, 'Asia/Ho_Chi_Minh')
  assert.deepEqual(b.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU'])
  assert.deepEqual(b.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] })
  assert.equal((toGoogleBody(timed, { includeRecurrence: false }) as any).recurrence, undefined)

  const allDay = newEvent({ title: 'B', allDay: true, startDate: '2026-10-10', endDate: '2026-10-12', reminderMinutes: null })
  const c = toGoogleBody(allDay, { includeRecurrence: false }) as any
  assert.deepEqual(c.start, { date: '2026-10-10' })
  assert.deepEqual(c.end, { date: '2026-10-13' })
  assert.deepEqual(c.reminders, { useDefault: true })
  assert.deepEqual((toGoogleBody(newEvent({ reminderMinutes: -1 }), { includeRecurrence: false }) as any).reminders, { useDefault: false, overrides: [] })
})

test('quyền chỉ đọc', () => {
  assert.equal(isReadOnlyRole('reader'), true)
  assert.equal(isReadOnlyRole('freeBusyReader'), true)
  assert.equal(isReadOnlyRole('owner'), false)
  assert.equal(isReadOnlyRole('writer'), false)
})

// ---- Client với fetch giả ----
function fakeFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { method: string; url: URL; body?: unknown }[] = []
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ method: (init.method ?? 'GET').toUpperCase(), url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    return handler(url, init)
  }) as typeof fetch
  return { f, calls }
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
const realFetch = globalThis.fetch

test('liệt kê lịch và sự kiện có phân trang, bỏ sự kiện đã hủy', async () => {
  const { f, calls } = fakeFetch((url) => {
    if (url.pathname.endsWith('/users/me/calendarList')) return json({ items: [{ id: 'primary', summary: 'Tôi', accessRole: 'owner', primary: true }] })
    if (!url.searchParams.get('pageToken'))
      return json({ items: [{ id: '1', start: { dateTime: '2026-10-27T09:00:00Z' }, end: { dateTime: '2026-10-27T10:00:00Z' } }], nextPageToken: 'p2' })
    return json({ items: [{ id: '2', status: 'cancelled', start: { dateTime: '2026-10-28T09:00:00Z' }, end: { dateTime: '2026-10-28T10:00:00Z' } }, { id: '3', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } }] })
  })
  globalThis.fetch = f
  const client = new GoogleCalendarClient(async () => 'tok')
  assert.equal((await client.listCalendars()).length, 1)
  const events = await client.listEvents('a@b.com', Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 1))
  assert.deepEqual(events.map((e) => e.id), ['1', '3'])
  const q = calls.find((c) => c.url.pathname.includes('/events'))!.url.searchParams
  assert.equal(q.get('singleEvents'), 'true')
  assert.equal(q.get('timeMin'), '2026-10-01T00:00:00.000Z')
})

test('tạo, sửa, xóa sự kiện gọi đúng địa chỉ; xóa sự kiện đã mất thì coi như xong', async () => {
  const { f, calls } = fakeFetch((url, init) => {
    if (init.method === 'DELETE' && url.pathname.endsWith('/gone')) return new Response('{"error":{"message":"Resource has been deleted"}}', { status: 410 })
    if (init.method === 'DELETE') return new Response(null, { status: 204 })
    return json({ id: 'new1', start: { dateTime: '2026-10-27T09:00:00Z' }, end: { dateTime: '2026-10-27T10:00:00Z' } })
  })
  globalThis.fetch = f
  const client = new GoogleCalendarClient(async () => 'tok')
  assert.equal((await client.insertEvent('primary', { summary: 'x' })).id, 'new1')
  await client.patchEvent('primary', 'new1', { summary: 'y' })
  await client.deleteEvent('primary', 'new1')
  await client.deleteEvent('primary', 'gone')
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'PATCH', 'DELETE', 'DELETE'])
  assert.ok(calls[1].url.pathname.endsWith('/calendars/primary/events/new1'))
})

test('401 thì làm mới token; 503 thì thử lại; 403 báo lỗi rõ', async () => {
  let n = 0
  const forced: boolean[] = []
  const { f } = fakeFetch((_u, init) => {
    n++
    const auth = String((init.headers as Record<string, string>).Authorization)
    if (auth === 'Bearer old') return new Response('no', { status: 401 })
    if (n === 2) return new Response('busy', { status: 503 })
    return json({ items: [] })
  })
  globalThis.fetch = f
  const client = new GoogleCalendarClient(async (force) => (forced.push(force), force ? 'fresh' : 'old'))
  await client.listCalendars()
  assert.ok(forced.includes(true))

  globalThis.fetch = fakeFetch(() => json({ error: { message: 'Forbidden: calendar scope' } }, 403)).f
  await assert.rejects(
    () => new GoogleCalendarClient(async () => 't').listCalendars(),
    (e: unknown) => e instanceof GoogleApiError && e.status === 403 && /Forbidden/.test(e.message)
  )
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    console.log('ok   ', name)
  } catch (e) {
    failed++
    console.log('FAIL ', name, '\n', (e as Error).message)
  } finally {
    globalThis.fetch = realFetch
  }
}
console.log(failed ? `${failed} test Google Calendar lỗi` : `${tests.length} test Google Calendar đạt`)
process.exit(failed ? 1 : 0)
