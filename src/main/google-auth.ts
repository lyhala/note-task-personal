import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { app, safeStorage, shell } from 'electron'

// Đăng nhập Google cho app cài trên máy: mở trình duyệt hệ thống, nhận mã qua địa chỉ loopback 127.0.0.1,
// dùng PKCE. Refresh token lưu mã hóa bằng kho khóa của hệ điều hành (safeStorage).

export type GooglePurpose = 'sync' | 'calendar'

const SCOPES: Record<GooglePurpose, string[]> = {
  // Đồng bộ chỉ xin quyền thư mục ẩn của app trên Drive.
  sync: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata'],
  calendar: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar']
}

/** Quyền bắt buộc (ngoài openid, email, profile) của từng loại kết nối. */
const REQUIRED_SCOPE: Record<GooglePurpose, string> = {
  sync: 'https://www.googleapis.com/auth/drive.appdata',
  calendar: 'https://www.googleapis.com/auth/calendar'
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const SIGN_IN_TIMEOUT_MS = 3 * 60_000

export const googleConfigured = (): boolean => !!__GOOGLE_CLIENT_ID__

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super('Chưa cấu hình Google: thiếu GOOGLE_CLIENT_ID trong file .env')
    this.name = 'GoogleNotConfiguredError'
  }
}

/** Google chỉ cấp một phần quyền: trên màn hình cấp quyền, người dùng bỏ tick ô Drive hoặc Calendar. */
export class MissingScopeError extends Error {
  constructor(what: string, granted: string[]) {
    const names = granted.filter((g) => g.startsWith('http')).map((g) => g.split('/').pop())
    super(
      `Google chưa cấp quyền ${what} cho app (Google chỉ cấp: ${names.length ? names.join(', ') : 'thông tin cơ bản của tài khoản'}). ` +
        'Nếu màn hình Google không hiện quyền này, hãy kiểm tra mục Data Access của project trên Google Cloud đã có quyền này chưa.'
    )
    this.name = 'MissingScopeError'
  }
}

/** Phiên đăng nhập hết hạn hoặc bị thu hồi (ví dụ token chế độ Testing hết hạn sau 7 ngày): cần đăng nhập lại. */
export class AuthExpiredError extends Error {
  constructor() {
    super('Phiên đăng nhập Google đã hết hạn, hãy đăng nhập lại')
    this.name = 'AuthExpiredError'
  }
}

interface StoredAccount {
  email: string
  /** Refresh token đã mã hóa (base64), hoặc nguyên văn nếu hệ điều hành không hỗ trợ mã hóa. */
  token: string
  encrypted: boolean
  expired?: boolean
}
type Store = Partial<Record<GooglePurpose, StoredAccount>>

const storeFile = (): string => join(app.getPath('userData'), 'google-accounts.json')

function readStore(): Store {
  try {
    return existsSync(storeFile()) ? (JSON.parse(readFileSync(storeFile(), 'utf8')) as Store) : {}
  } catch {
    return {}
  }
}
const writeStore = (s: Store): void => writeFileSync(storeFile(), JSON.stringify(s, null, 2))

function seal(plain: string): { token: string; encrypted: boolean } {
  if (safeStorage.isEncryptionAvailable()) return { token: safeStorage.encryptString(plain).toString('base64'), encrypted: true }
  return { token: plain, encrypted: false }
}
const unseal = (a: StoredAccount): string => (a.encrypted ? safeStorage.decryptString(Buffer.from(a.token, 'base64')) : a.token)

export interface AccountInfo {
  email: string
  expired: boolean
}

export function getAccount(purpose: GooglePurpose): AccountInfo | null {
  const a = readStore()[purpose]
  return a ? { email: a.email, expired: !!a.expired } : null
}

const b64url = (b: Buffer): string => b.toString('base64url')

function waitForCode(server: Server, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Hết thời gian chờ đăng nhập')), SIGN_IN_TIMEOUT_MS)
    const done = (fn: () => void): void => {
      clearTimeout(timer)
      server.close()
      fn()
    }
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const err = url.searchParams.get('error')
      if (!code && !err) {
        res.writeHead(404).end()
        return
      }
      const ok = !!code && url.searchParams.get('state') === state
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Note</title><body style="font-family:system-ui;text-align:center;padding:60px;color:#2f2a3d">` +
          (ok ? '<h2>Đăng nhập xong ✓</h2><p>Bạn có thể đóng tab này và quay lại app.</p>' : '<h2>Đăng nhập chưa thành công</h2><p>Hãy quay lại app và thử lại.</p>') +
          '</body>'
      )
      if (ok) done(() => resolve(code!))
      else done(() => reject(new Error(err === 'access_denied' ? 'Bạn đã từ chối cấp quyền' : `Đăng nhập thất bại${err ? `: ${err}` : ''}`)))
    })
  })
}

async function postToken(body: Record<string, string>): Promise<Record<string, any>> {
  const params = new URLSearchParams({ client_id: __GOOGLE_CLIENT_ID__, ...body })
  if (__GOOGLE_CLIENT_SECRET__) params.set('client_secret', __GOOGLE_CLIENT_SECRET__)
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params })
  const json = (await res.json().catch(() => ({}))) as Record<string, any>
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw new AuthExpiredError()
    throw new Error(`Google từ chối: ${json.error_description ?? json.error ?? res.status}`)
  }
  return json
}

/** Đăng nhập: mở trình duyệt, chờ người dùng đồng ý, lưu refresh token. */
export async function signIn(purpose: GooglePurpose): Promise<AccountInfo> {
  if (!googleConfigured()) throw new GoogleNotConfiguredError()
  const verifier = b64url(randomBytes(64))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as { port: number }).port
  const redirect = `http://127.0.0.1:${port}`
  const codePromise = waitForCode(server, state)
  codePromise.catch(() => undefined) // lỗi sẽ được xử lý ở await bên dưới

  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: __GOOGLE_CLIENT_ID__,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPES[purpose].join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'select_account consent'
  }).toString()
  await shell.openExternal(url.toString())

  const code = await codePromise
  const tok = await postToken({ code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' })
  if (!tok.refresh_token) throw new Error('Google không cấp quyền truy cập lâu dài, hãy thử đăng nhập lại')
  // Người dùng có thể bỏ tick từng quyền trên màn hình Google: kiểm tra quyền thật sự được cấp.
  const granted = String(tok.scope ?? '').split(' ')
  const missing = REQUIRED_SCOPE[purpose]
  if (!granted.includes(missing)) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(tok.refresh_token as string)}`, { method: 'POST' })
    } catch {
      /* bỏ qua */
    }
    throw new MissingScopeError(purpose === 'sync' ? 'Google Drive' : 'Google Calendar', granted)
  }
  const email = decodeEmail(tok.id_token) ?? 'tài khoản Google'

  const store = readStore()
  store[purpose] = { email, ...seal(tok.refresh_token as string) }
  writeStore(store)
  cache.set(purpose, { token: tok.access_token as string, expiresAt: Date.now() + (Number(tok.expires_in) - 60) * 1000 })
  return { email, expired: false }
}

function decodeEmail(idToken: unknown): string | null {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}

const cache = new Map<GooglePurpose, { token: string; expiresAt: number }>()

/** Access token còn hạn; tự làm mới bằng refresh token. */
export async function getAccessToken(purpose: GooglePurpose, force = false): Promise<string> {
  if (!googleConfigured()) throw new GoogleNotConfiguredError()
  const hit = cache.get(purpose)
  if (!force && hit && hit.expiresAt > Date.now()) return hit.token

  const store = readStore()
  const acct = store[purpose]
  if (!acct || acct.expired) throw new AuthExpiredError()
  let refresh: string
  try {
    refresh = unseal(acct)
  } catch {
    // Không giải mã được (khóa mã hóa của hệ điều hành đổi, hoặc dữ liệu hỏng): coi như phiên hết hạn, đăng nhập lại là xong.
    cache.delete(purpose)
    store[purpose] = { ...acct, expired: true }
    writeStore(store)
    throw new AuthExpiredError()
  }
  try {
    const tok = await postToken({ refresh_token: refresh, grant_type: 'refresh_token' })
    cache.set(purpose, { token: tok.access_token as string, expiresAt: Date.now() + (Number(tok.expires_in) - 60) * 1000 })
    return tok.access_token as string
  } catch (e) {
    if (e instanceof AuthExpiredError) {
      cache.delete(purpose)
      store[purpose] = { ...acct, expired: true }
      writeStore(store)
    }
    throw e
  }
}

export async function signOut(purpose: GooglePurpose): Promise<void> {
  const store = readStore()
  const acct = store[purpose]
  if (acct && !acct.expired) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(unseal(acct))}`, { method: 'POST' })
    } catch {
      /* không có mạng thì vẫn đăng xuất ở máy này */
    }
  }
  delete store[purpose]
  writeStore(store)
  cache.delete(purpose)
}

/** Đánh dấu tài khoản cần đăng nhập lại (ví dụ Google báo thiếu quyền), không xóa dữ liệu trên máy. */
export function markNeedsReauth(purpose: GooglePurpose): void {
  const store = readStore()
  const acct = store[purpose]
  if (!acct) return
  store[purpose] = { ...acct, expired: true }
  writeStore(store)
  cache.delete(purpose)
}
