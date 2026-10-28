import assert from 'node:assert/strict'
import { newCalendar, newEvent } from '../calendar'
import { newFolder, newNote, newReminder, TRASH_DAYS, type Note, type Reminder } from '../types'
import {
  EMPTY_STATE,
  RemoteNotFoundError,
  runSync,
  type RemoteChanges,
  type RemoteFile,
  type RemoteStore,
  type SyncLocal,
  type SyncState,
  type SyncStateStore
} from './engine'
import { REMOTE_FORMAT_VERSION, SYNC_KINDS, parseRemoteName, type SyncEntity, type SyncKind } from './format'

const DAY = 86_400_000

/** Kho từ xa giả trong bộ nhớ, có nhật ký thay đổi giống Drive changes API. */
class MemRemote implements RemoteStore {
  files = new Map<string, { name: string; content: string }>()
  log: { rev: number; id: string; removed: boolean }[] = []
  rev = 0
  seq = 0
  async listChanges(token: string | null): Promise<RemoteChanges> {
    const from = token === null ? -1 : Number(token)
    const latest = new Map<string, { rev: number; removed: boolean }>()
    for (const c of this.log) if (c.rev > from) latest.set(c.id, { rev: c.rev, removed: c.removed })
    const files: RemoteFile[] = []
    const removed: string[] = []
    for (const [id, c] of latest) {
      if (c.removed) removed.push(id)
      else {
        const f = this.files.get(id)
        if (f) files.push({ id, name: f.name })
      }
    }
    return { files, removed, nextToken: String(this.rev) }
  }
  async read(id: string): Promise<string> {
    const f = this.files.get(id)
    if (!f) throw new RemoteNotFoundError()
    return f.content
  }
  async create(name: string, content: string): Promise<RemoteFile> {
    const id = `f${++this.seq}`
    this.files.set(id, { name, content })
    this.log.push({ rev: ++this.rev, id, removed: false })
    return { id, name }
  }
  async update(id: string, content: string): Promise<void> {
    const f = this.files.get(id)
    if (!f) throw new RemoteNotFoundError()
    f.content = content
    this.log.push({ rev: ++this.rev, id, removed: false })
  }
  async remove(id: string): Promise<void> {
    if (!this.files.delete(id)) throw new RemoteNotFoundError()
    this.log.push({ rev: ++this.rev, id, removed: true })
  }
  names(): string[] {
    return [...this.files.values()].map((f) => f.name).sort()
  }
}

class MemLocal implements SyncLocal {
  data: Record<SyncKind, Map<string, SyncEntity>> = { note: new Map(), folder: new Map(), reminder: new Map(), calendar: new Map(), event: new Map() }
  async listAll(): Promise<Record<SyncKind, SyncEntity[]>> {
    return {
      note: [...this.data.note.values()],
      folder: [...this.data.folder.values()],
      reminder: [...this.data.reminder.values()],
      calendar: [...this.data.calendar.values()],
      event: [...this.data.event.values()]
    }
  }
  async put(kind: SyncKind, e: SyncEntity): Promise<void> {
    this.data[kind].set(e.id, { ...e })
  }
  async purge(kind: SyncKind, id: string): Promise<void> {
    this.data[kind].delete(id)
  }
  get<T>(kind: SyncKind, id: string): T {
    return this.data[kind].get(id) as unknown as T
  }
}

class MemState implements SyncStateStore {
  s: SyncState = { token: EMPTY_STATE.token, items: {} }
  async load(): Promise<SyncState> {
    return structuredClone(this.s)
  }
  async save(s: SyncState): Promise<void> {
    this.s = structuredClone(s)
  }
}

class Device {
  local = new MemLocal()
  state = new MemState()
  constructor(
    private remote: MemRemote,
    private clock: { t: number }
  ) {}
  sync() {
    let n = 0
    return runSync({ local: this.local, remote: this.remote, state: this.state, now: () => this.clock.t, newId: () => `copy-${++n}` })
  }
}

const tests: [string, () => Promise<void>][] = []
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn])
const setup = () => {
  const remote = new MemRemote()
  const clock = { t: 1_000_000 }
  return { remote, clock, a: new Device(remote, clock), b: new Device(remote, clock) }
}
const note = (id: string, p: Partial<Note> = {}): Note => newNote({ id, title: id, body: '', updatedAt: 1000, createdAt: 1000, ...p })

test('lần đầu: đẩy hết dữ liệu trên máy lên kho trống, lần sau không đẩy gì', async () => {
  const { remote, a } = setup()
  await a.local.put('note', note('n1'))
  await a.local.put('folder', newFolder('Công việc'))
  await a.local.put('reminder', newReminder({ id: 'r1', title: 'Gọi điện' }))
  const r1 = await a.sync()
  assert.equal(r1.pushed, 3)
  assert.equal(remote.files.size, 3)
  const r2 = await a.sync()
  assert.deepEqual([r2.pushed, r2.pulled, r2.conflicts], [0, 0, 0])
})

test('máy mới kéo toàn bộ dữ liệu về, reminder mới nhận không bị coi là lỡ nhắc', async () => {
  const { clock, a, b } = setup()
  await a.local.put('note', note('n1', { body: 'xin chào' }))
  await a.local.put('reminder', newReminder({ id: 'r1', title: 'Việc', createdAt: 5, updatedAt: 6, firedAt: null }))
  await a.sync()
  const res = await b.sync()
  assert.equal(res.pulled, 2)
  assert.equal(b.local.get<Note>('note', 'n1').body, 'xin chào')
  assert.equal(b.local.get<Reminder>('reminder', 'r1').firedAt, clock.t)
})

test('sửa ở máy A rồi đồng bộ hai máy thì máy B có bản sửa', async () => {
  const { a, b } = setup()
  await a.local.put('note', note('n1', { body: 'v1' }))
  await a.sync()
  await b.sync()
  await a.local.put('note', note('n1', { body: 'v2', updatedAt: 2000 }))
  await a.sync()
  const res = await b.sync()
  assert.equal(res.pulled, 1)
  assert.equal(b.local.get<Note>('note', 'n1').body, 'v2')
})

test('hai máy cùng sửa nội dung note: giữ cả hai, bản máy này thành note xung đột', async () => {
  const { a, b } = setup()
  await a.local.put('note', note('n1', { body: 'gốc' }))
  await a.sync()
  await b.sync()
  await a.local.put('note', note('n1', { body: 'sửa ở A', updatedAt: 2000 }))
  await b.local.put('note', note('n1', { body: 'sửa ở B', updatedAt: 2500 }))
  await a.sync() // A đẩy lên trước
  const res = await b.sync()
  assert.equal(res.conflicts, 1)
  assert.equal(b.local.get<Note>('note', 'n1').body, 'sửa ở A') // bản từ xa vào note gốc
  const copy = b.local.get<Note>('note', 'copy-1')
  assert.equal(copy.body, 'sửa ở B')
  assert.equal(copy.conflictOf, 'n1')
  assert.match(copy.title, /bản trên máy này/)
  // Bản xung đột được đẩy lên, máy A nhận được cả hai
  await a.sync()
  assert.equal(a.local.get<Note>('note', 'copy-1').body, 'sửa ở B')
})

test('chỉ khác màu hoặc ghim (không đổi nội dung) thì bản sửa sau cùng thắng, không tạo xung đột', async () => {
  const { a, b } = setup()
  await a.local.put('note', note('n1', { body: 'x', color: '#ffffff' }))
  await a.sync()
  await b.sync()
  await a.local.put('note', note('n1', { body: 'x', color: '#fff3b0', updatedAt: 2000 }))
  await b.local.put('note', note('n1', { body: 'x', color: '#d6e8ff', updatedAt: 3000 }))
  await a.sync()
  const res = await b.sync()
  assert.equal(res.conflicts, 0)
  assert.equal(b.local.get<Note>('note', 'n1').color, '#d6e8ff') // máy B sửa sau nên thắng
  await a.sync()
  assert.equal(a.local.get<Note>('note', 'n1').color, '#d6e8ff')
})

test('reminder: bản sửa sau cùng thắng, mốc nhắc của từng máy được giữ riêng', async () => {
  const { a, b } = setup()
  await a.local.put('reminder', newReminder({ id: 'r1', title: 'cũ', updatedAt: 1000, firedAt: 111 }))
  await a.sync()
  await b.sync()
  await b.local.put('reminder', { ...b.local.get<Reminder>('reminder', 'r1'), firedAt: 999 } as Reminder)
  await a.local.put('reminder', { ...a.local.get<Reminder>('reminder', 'r1'), title: 'mới', updatedAt: 2000 } as Reminder)
  await a.sync()
  await b.sync()
  const r = b.local.get<Reminder>('reminder', 'r1')
  assert.equal(r.title, 'mới')
  assert.equal(r.firedAt, 999)
})

test('xóa là đánh dấu deletedAt và lan sang máy khác', async () => {
  const { a, b } = setup()
  await a.local.put('note', note('n1'))
  await a.sync()
  await b.sync()
  await a.local.put('note', note('n1', { deletedAt: 5000, updatedAt: 5000 }))
  await a.sync()
  await b.sync()
  assert.equal(b.local.get<Note>('note', 'n1').deletedAt, 5000)
})

test('quá hạn thùng rác: xóa hẳn cả trên máy lẫn kho từ xa', async () => {
  const { remote, clock, a, b } = setup()
  await a.local.put('note', note('n1', { deletedAt: 5000, updatedAt: 5000 }))
  await a.sync()
  await b.sync()
  assert.equal(remote.files.size, 1)
  clock.t = 5000 + (TRASH_DAYS + 1) * DAY
  const res = await a.sync()
  assert.equal(res.purged, 1)
  assert.equal(remote.files.size, 0)
  assert.equal(a.local.data.note.size, 0)
  await b.sync()
  assert.equal(b.local.data.note.size, 0)
})

test('file do bản app mới hơn ghi thì bỏ qua, không ghi đè', async () => {
  const { remote, a } = setup()
  const content = JSON.stringify({ format: REMOTE_FORMAT_VERSION + 1, kind: 'note', id: 'nx', updatedAt: 9, deletedAt: null, data: { id: 'nx', updatedAt: 9, deletedAt: null } })
  await remote.create('note-nx.json', content)
  const res = await a.sync()
  assert.equal(res.skippedNewer, 1)
  assert.equal(a.local.data.note.size, 0)
  assert.equal(remote.files.size, 1)
})

test('file đã bị xóa trên kho từ xa thì máy còn bản sẽ đẩy lên lại', async () => {
  const { remote, a } = setup()
  await a.local.put('note', note('n1'))
  await a.sync()
  const [id] = [...remote.files.keys()]
  await remote.remove(id)
  const res = await a.sync()
  assert.equal(res.pushed, 1)
  assert.equal(remote.names().join(), 'note-n1.json')
})

test('lỗi giữa chừng không làm mất liên kết đã đẩy, lần sau không tạo file trùng', async () => {
  const { remote, a } = setup()
  await a.local.put('note', note('n1'))
  await a.local.put('note', note('n2'))
  const realCreate = remote.create.bind(remote)
  let calls = 0
  remote.create = async (name, content) => {
    if (++calls === 2) throw new Error('mất mạng')
    return realCreate(name, content)
  }
  await assert.rejects(() => a.sync(), /mất mạng/)
  remote.create = realCreate
  await a.sync()
  assert.equal(remote.names().join(), 'note-n1.json,note-n2.json')
})

test('tên file lạ trên kho từ xa được bỏ qua', async () => {
  const { remote, a } = setup()
  await remote.create('ghi-chu-linh-tinh.txt', 'hello')
  const res = await a.sync()
  assert.deepEqual([res.pulled, res.pushed], [0, 0])
  assert.equal(parseRemoteName('note-abc.json')?.id, 'abc')
  assert.equal(parseRemoteName('x.json'), null)
  assert.deepEqual(SYNC_KINDS, ['note', 'folder', 'reminder', 'calendar', 'event'])
})

test('lịch trong app và sự kiện của nó đồng bộ sang máy khác', async () => {
  const { a, b } = setup()
  const cal = newCalendar({ id: 'local-default', name: 'Lịch của tôi', updatedAt: 1000 })
  const ev = newEvent({ id: 'ev1', calendarId: 'local-default', title: 'Họp nhóm', updatedAt: 1000 })
  await a.local.put('calendar', cal as unknown as SyncEntity)
  await a.local.put('event', ev as unknown as SyncEntity)
  await a.sync()
  const res = await b.sync()
  assert.equal(res.pulled, 2)
  assert.equal((b.local.get('event', 'ev1') as unknown as { title: string }).title, 'Họp nhóm')
  // sửa ở B, A nhận
  await b.local.put('event', { ...ev, title: 'Họp nhóm (đổi giờ)', updatedAt: 2000 } as unknown as SyncEntity)
  await b.sync()
  await a.sync()
  assert.equal((a.local.get('event', 'ev1') as unknown as { title: string }).title, 'Họp nhóm (đổi giờ)')
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    console.log('ok   ', name)
  } catch (e) {
    failed++
    console.log('FAIL ', name, '\n', (e as Error).message)
  }
}
console.log(failed ? `${failed} test đồng bộ lỗi` : `${tests.length} test đồng bộ đạt`)
process.exit(failed ? 1 : 0)
