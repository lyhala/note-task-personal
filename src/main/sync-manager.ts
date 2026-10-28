import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { runSync, type SyncResult } from '@core/sync/engine'
import { DriveAppDataRemote } from './drive-remote'
import { AuthExpiredError, getAccessToken, getAccount, googleConfigured, markNeedsReauth, signIn, signOut, type AccountInfo } from './google-auth'
import type { SqliteStorage } from './sqlite-storage'

export interface SyncStatus {
  /** Đã có GOOGLE_CLIENT_ID trong .env chưa. */
  configured: boolean
  account: AccountInfo | null
  syncing: boolean
  auto: boolean
  lastSyncAt: number | null
  lastError: string | null
  lastResult: SyncResult | null
}

interface Persisted {
  auto: boolean
  lastSyncAt: number | null
}

const START_DELAY_MS = 4_000
const DIRTY_DELAY_MS = 8_000
const INTERVAL_MS = 3 * 60_000

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(msg)) return 'Không kết nối được tới Google, kiểm tra mạng rồi thử lại'
  return msg
}

/** Điều phối đồng bộ Drive: chạy khi mở app, sau khi có thay đổi (chờ vài giây cho gọn), định kỳ, hoặc khi bấm tay. */
export class SyncManager {
  private running = false
  private again = false
  private lastError: string | null = null
  private lastResult: SyncResult | null = null
  private dirtyTimer: NodeJS.Timeout | undefined
  private intervalTimer: NodeJS.Timeout | undefined
  private p: Persisted
  private readonly file = join(app.getPath('userData'), 'sync-settings.json')

  constructor(
    private storage: SqliteStorage,
    private emit: (channel: string, payload: unknown) => void
  ) {
    this.p = { auto: true, lastSyncAt: null }
    try {
      if (existsSync(this.file)) this.p = { ...this.p, ...JSON.parse(readFileSync(this.file, 'utf8')) }
    } catch {
      /* file hỏng thì dùng mặc định */
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.p))
  }

  status(): SyncStatus {
    return {
      configured: googleConfigured(),
      account: getAccount('sync'),
      syncing: this.running,
      auto: this.p.auto,
      lastSyncAt: this.p.lastSyncAt,
      lastError: this.lastError,
      lastResult: this.lastResult
    }
  }

  private publish(): void {
    this.emit('sync:status', this.status())
  }

  start(): void {
    setTimeout(() => void this.run(), START_DELAY_MS)
    this.intervalTimer = setInterval(() => this.p.auto && void this.run(), INTERVAL_MS)
  }

  stop(): void {
    clearTimeout(this.dirtyTimer)
    clearInterval(this.intervalTimer)
  }

  /** Có dữ liệu vừa đổi: đồng bộ sau vài giây (gộp nhiều thay đổi liên tiếp làm một lần). */
  markDirty(): void {
    const a = getAccount('sync')
    if (!this.p.auto || !a || a.expired) return
    clearTimeout(this.dirtyTimer)
    this.dirtyTimer = setTimeout(() => void this.run(), DIRTY_DELAY_MS)
  }

  setAuto(auto: boolean): SyncStatus {
    this.p.auto = auto
    this.persist()
    if (auto) void this.run()
    return this.status()
  }

  async connect(): Promise<SyncStatus> {
    this.lastError = null
    try {
      await signIn('sync')
    } catch (e) {
      this.lastError = describeError(e)
      this.publish()
      return this.status()
    }
    this.publish()
    await this.run()
    return this.status()
  }

  async disconnect(): Promise<SyncStatus> {
    await signOut('sync')
    this.lastError = null
    this.lastResult = null
    this.publish()
    return this.status()
  }

  /** Chạy một lượt đồng bộ. Đang chạy dở thì nhớ để chạy thêm một lượt ngay sau đó. */
  async run(): Promise<SyncStatus> {
    const account = getAccount('sync')
    if (!account || account.expired || !googleConfigured()) return this.status()
    if (this.running) {
      this.again = true
      return this.status()
    }
    this.running = true
    this.publish()
    try {
      const remote = new DriveAppDataRemote((force) => getAccessToken('sync', force))
      const res = await runSync({ local: this.storage.syncLocal(), remote, state: this.storage.syncStateStore(account.email) })
      this.lastResult = res
      this.lastError = res.skippedNewer > 0 ? `Có ${res.skippedNewer} mục do bản app mới hơn ghi, hãy cập nhật app` : null
      this.p.lastSyncAt = Date.now()
      this.persist()
      // Dữ liệu trên máy vừa đổi do kéo từ Drive về: báo giao diện nạp lại.
      if (res.pulled + res.conflicts + res.purged > 0) this.emit('sync:applied', res)
    } catch (e) {
      if (/insufficient authentication scopes|insufficientPermissions/i.test(e instanceof Error ? e.message : '')) {
        // Token cũ thiếu quyền Drive (thường do bỏ tick ô Drive lúc cấp quyền): yêu cầu đăng nhập lại.
        markNeedsReauth('sync')
        this.lastError = 'Google chưa cấp quyền Google Drive cho app. Hãy đăng nhập lại và tick đủ tất cả các ô quyền trên màn hình của Google.'
      } else {
        this.lastError = e instanceof AuthExpiredError ? e.message : describeError(e)
      }
    } finally {
      this.running = false
      this.publish()
      if (this.again) {
        this.again = false
        setTimeout(() => void this.run(), 1_000)
      }
    }
    return this.status()
  }
}
