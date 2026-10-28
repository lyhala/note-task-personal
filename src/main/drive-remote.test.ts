import assert from 'node:assert/strict'
import { newNote, newReminder, type Note } from '@core/types'
import { runSync, RemoteNotFoundError, type SyncLocal, type SyncState, type SyncStateStore } from '@core/sync/engine'
import type { SyncEntity, SyncKind } from '@core/sync/format'
import { DriveAppDataRemote } from './drive-remote'

// ---- Drive giả: bắt chước các lệnh gọi mà DriveAppDataRemote dùng ----
interface FakeFile {
  name: string
  content: string
  trashed: boolean
}
class FakeDrive {
  files = new Map<string, FakeFile>()
  log: { rev: number; id: string }[] = []
  rev = 0
  seq = 0
  validTokens = new Set(['good'])
  failNext: number[] = [] // mã lỗi sẽ trả lần lượt cho các request tới
  requests: string[] = []

  handle = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const method = (init.method ?? 'GET').toUpperCase()
    this.requests.push(`${method} ${url.pathname}${url.search ? '?' + [...url.searchParams.keys()].join('&') : ''}`)
    const auth = String((init.headers as Record<string, string>)?.Authorization ?? '')
    if (!this.validTokens.has(auth.replace('Bearer ', ''))) return new Response('unauthorized', { status: 401 })
    const forced = this.failNext.shift()
    if (forced) return new Response('boom', { status: forced })
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
    const p = url.pathname
    const touch = (id: string) => this.log.push({ rev: ++this.rev, id })

    if (p === '/drive/v3/changes/startPageToken') return json({ startPageToken: String(this.rev) })
    if (p === '/drive/v3/files' && method === 'GET') {
      assert.equal(url.searchParams.get('spaces'), 'appDataFolder')
      const files = [...this.files].filter(([, f]) => !f.trashed).map(([id, f]) => ({ id, name: f.name }))
      return json({ files })
    }
    if (p === '/drive/v3/changes') {
      assert.equal(url.searchParams.get('spaces'), 'appDataFolder')
      const from = Number(url.searchParams.get('pageToken'))
      const seen = new Map<string, number>()
      for (const c of this.log) if (c.rev > from) seen.set(c.id, c.rev)
      const changes = [...seen.keys()].map((id) => {
        const f = this.files.get(id)
        return f ? { fileId: id, removed: false, file: { id, name: f.name, trashed: f.trashed } } : { fileId: id, removed: true }
      })
      return json({ changes, newStartPageToken: String(this.rev) })
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p)
    if (m && method === 'GET') {
      const f = this.files.get(decodeURIComponent(m[1]))
      if (!f) return new Response('nf', { status: 404 })
      assert.equal(url.searchParams.get('alt'), 'media')
      return new Response(f.content)
    }
    if (m && method === 'DELETE') {
      const id = decodeURIComponent(m[1])
      if (!this.files.delete(id)) return new Response('nf', { status: 404 })
      touch(id)
      return new Response(null, { status: 204 })
    }
    if (p === '/upload/drive/v3/files' && method === 'POST') {
      assert.equal(url.searchParams.get('uploadType'), 'multipart')
      const body = String(init.body)
      const boundary = /boundary=(.+)$/.exec(String((init.headers as Record<string, string>)['Content-Type']))![1]
      const parts = body.split(`--${boundary}`).filter((x) => x.trim() && x.trim() !== '--')
      const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim())
      assert.deepEqual(meta.parents, ['appDataFolder'])
      const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '')
      const id = `d${++this.seq}`
      this.files.set(id, { name: meta.name, content, trashed: false })
      touch(id)
      return json({ id, name: meta.name })
    }
    const u = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p)
    if (u && method === 'PATCH') {
      const id = decodeURIComponent(u[1])
      const f = this.files.get(id)
      if (!f) return new Response('nf', { status: 404 })
      f.content = String(init.body)
      touch(id)
      return json({ id })
    }
    return new Response('unexpected ' + method + ' ' + p, { status: 500 })
  }
}

class MemLocal implements SyncLocal {
  data: Record<SyncKind, Map<string, SyncEntity>> = { note: new Map(), folder: new Map(), reminder: new Map(), calendar: new Map(), event: new Map() }
  async listAll() {
    return {
      note: [...this.data.note.values()],
      folder: [...this.data.folder.values()],
      reminder: [...this.data.reminder.values()],
      calendar: [...this.data.calendar.values()],
      event: [...this.data.event.values()]
    }
  }
  async put(kind: SyncKind, e: SyncEntity) {
    this.data[kind].set(e.id, { ...e })
  }
  async purge(kind: SyncKind, id: string) {
    this.data[kind].delete(id)
  }
}
class MemState implements SyncStateStore {
  s: SyncState = { token: null, items: {} }
  async load() {
    return structuredClone(this.s)
  }
  async save(s: SyncState) {
    this.s = structuredClone(s)
  }
}

const tests: [string, () => Promise<void>][] = []
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn])
const realFetch = globalThis.fetch

function setup() {
  const drive = new FakeDrive()
  globalThis.fetch = drive.handle as typeof fetch
  let tokenCalls = 0
  const remote = new DriveAppDataRemote(async (force) => {
    tokenCalls++
    return force || tokenCalls > 0 ? 'good' : 'stale'
  })
  const device = () => ({ local: new MemLocal(), state: new MemState() })
  const sync = (d: ReturnType<typeof device>) => runSync({ local: d.local, remote, state: d.state })
  return { drive, remote, device, sync }
}
const note = (id: string, body: string, updatedAt = 1000): Note => newNote({ id, title: id, body, updatedAt, createdAt: 1 })

test('máy A đẩy lên Drive (multipart), máy B kéo về bằng danh sách file rồi bằng changes API', async () => {
  const { drive, device, sync } = setup()
  const a = device()
  const b = device()
  await a.local.put('note', note('n1', 'xin chào Việt Nam'))
  await a.local.put('reminder', newReminder({ id: 'r1', title: 'Gọi điện' }))
  const r1 = await sync(a)
  assert.equal(r1.pushed, 2)
  assert.equal(drive.files.size, 2)
  assert.ok(drive.requests.some((r) => r.startsWith('POST /upload/drive/v3/files')))

  const r2 = await sync(b)
  assert.equal(r2.pulled, 2)
  assert.equal((b.local.data.note.get('n1') as unknown as Note).body, 'xin chào Việt Nam')

  // A sửa, B lấy thay đổi qua changes API (đã có token)
  await a.local.put('note', note('n1', 'bản sửa', 2000))
  await sync(a)
  drive.requests.length = 0
  const r3 = await sync(b)
  assert.equal(r3.pulled, 1)
  assert.equal((b.local.data.note.get('n1') as unknown as Note).body, 'bản sửa')
  assert.ok(drive.requests.some((r) => r.startsWith('GET /drive/v3/changes?')))
  assert.ok(!drive.requests.some((r) => r.startsWith('GET /drive/v3/files?')), 'lần sau không liệt kê lại toàn bộ')
})

test('nội dung có xuống dòng và ký tự đặc biệt không bị hỏng khi qua multipart', async () => {
  const { device, sync } = setup()
  const a = device()
  const b = device()
  const body = 'Dòng 1\r\nDòng 2 "trích dẫn" \\ gạch\n--ranh-giới--\n😀'
  await a.local.put('note', note('n1', body))
  await sync(a)
  await sync(b)
  assert.equal((b.local.data.note.get('n1') as unknown as Note).body, body)
})

test('gặp 401 thì làm mới token và thử lại', async () => {
  const { drive, device } = setup()
  drive.validTokens = new Set(['fresh'])
  const calls: boolean[] = []
  const remote = new DriveAppDataRemote(async (force) => {
    calls.push(force)
    return force ? 'fresh' : 'old'
  })
  const a = device()
  await a.local.put('note', note('n1', 'x'))
  await runSync({ local: a.local, remote, state: a.state })
  assert.ok(calls.includes(true), 'đã yêu cầu token mới')
  assert.equal(drive.files.size, 1)
})

test('gặp 503 thì thử lại rồi thành công', async () => {
  const { drive, device, sync } = setup()
  drive.failNext = [503, 503]
  const a = device()
  await a.local.put('note', note('n1', 'x'))
  const r = await sync(a)
  assert.equal(r.pushed, 1)
  assert.equal(drive.files.size, 1)
})

test('sửa file không còn trên Drive ném RemoteNotFoundError', async () => {
  const { remote } = setup()
  await assert.rejects(() => remote.update('khong-co', '{}'), RemoteNotFoundError)
})

test('lỗi 403 không thử lại mà báo lỗi rõ ràng', async () => {
  const { drive, remote } = setup()
  drive.failNext = [403]
  await assert.rejects(() => remote.create('note-x.json', '{}'), /Google Drive lỗi 403/)
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
console.log(failed ? `${failed} test Drive lỗi` : `${tests.length} test Drive đạt`)
process.exit(failed ? 1 : 0)
