// Chạy mọi test của gói core: node scripts/test-core.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

const find = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? find(p) : p.endsWith('.test.ts') ? [p] : []
  })

const tmp = mkdtempSync(join(tmpdir(), 'ntp-core-'))
let failed = 0
for (const [i, entry] of [...find('src/core'), ...find('src/main')].entries()) {
  const out = join(tmp, `test${i}.mjs`)
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' })
  console.log(`\n# ${entry}`)
  const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
  if (r.status !== 0) failed++
}
process.exit(failed ? 1 : 0)
