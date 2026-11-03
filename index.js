// dsh-page-refresh-macos — host half.
//
// The original dsh-page-refresh is Windows-only by construction: it shells out to
// powershell.exe / taskkill.exe / wscript.exe, and on macOS those simply do not
// exist (verified on this machine: the close path logged
// "spawn-error spawn powershell.exe ENOENT"). This bundle re-implements the same
// two capabilities natively:
//
//   /api/power-macos/restart — stop the host, then start it again exactly the way
//                              it was started (same executable, same arguments,
//                              same working directory).
//   /api/power-macos/close   — stop the host and leave it stopped.
//
// Design notes
// ------------
// 1. No watchdog exists on macOS. The Windows build had to write a
//    "quit-requested" record into an update journal so a keepalive task would not
//    resurrect the app. Nothing does that here — `launchctl list` shows no DSH
//    job and the host runs as a plain `node` process — so a plain SIGTERM is the
//    whole story.
// 2. Relaunch must reproduce the original invocation. `dsh --profile web` is a
//    symlink to lib/bin.js, and the real flags matter (--no-open, --patch, ...).
//    `process.execPath` plus `process.argv.slice(1)` captures both halves exactly.
// 3. The relaunch runs from a detached /bin/sh helper. A child spawned with
//    detached+unref survives its parent's death, so the helper is still alive
//    after it kills the host.
// 4. Loopback-only fence (remote address + Host header). These endpoints can stop
//    the server, so they must never be reachable from another device.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { homedir, hostname, networkInterfaces } from 'node:os'
import { join, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-page-refresh-macos'
export const inject = ['webServer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const LOG_DIR = join(DSH_HOME, 'logs')
const LOG_FILE = join(LOG_DIR, 'dsh-power-macos.log')
const HELPER = fileURLToPath(new URL('./relaunch.sh', import.meta.url))
const IS_DARWIN = process.platform === 'darwin'

// Captured at load time, before anything can change them.
const BOOT_CWD = (() => {
  try { return process.cwd() } catch { return homedir() }
})()
const BOOT_ARGV = (() => {
  const rest = process.argv.slice(1)
  if (rest.length === 0) return []
  // argv[1] may be relative (e.g. "lib/bin.js"); resolve it now, because the
  // helper may run with a different working directory.
  if (!isAbsolute(rest[0])) rest[0] = resolve(BOOT_CWD, rest[0])
  return rest
})()

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
}

function sendJson(res, code, payload) {
  res.writeHead(code, { ...CORS, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function logLine(tag, msg) {
  const line = `[${new Date().toISOString()}] ${tag} ${msg}\n`
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(LOG_FILE, line, 'utf8')
  } catch { /* logging must never break the request */ }
  return line
}

// remoteAddress must be loopback (the anti-DNS-rebinding check); the Host header
// is allowed to be any name this machine legitimately answers to.
function localHostNames() {
  const names = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  try { names.add(hostname().toLowerCase()) } catch { /* ignore */ }
  try {
    const ifs = networkInterfaces()
    for (const key of Object.keys(ifs)) {
      names.add(key.toLowerCase())
      for (const a of ifs[key] ?? []) {
        if (a?.address) names.add(String(a.address).toLowerCase())
      }
    }
  } catch { /* ignore */ }
  return names
}

function isLoopback(req) {
  const remote = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '')
  if (!(remote === '127.0.0.1' || remote === '::1' || remote === '')) return false
  const host = String(req.headers?.host ?? '').trim().toLowerCase()
  if (!host) return false
  const bare = host.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '')
  return localHostNames().has(bare)
}

// Same reason the Windows build strips it: a relaunched DSH must not inherit a
// Node-only mode flag and come back without a shell.
function cleanEnv() {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    const upper = k.toUpperCase()
    if (upper === 'ELECTRON_RUN_AS_NODE' || upper === 'DSH_DESKTOP_NODE_EXECUTABLE') delete env[k]
  }
  return env
}

function launchHelper(mode, port) {
  if (!existsSync(HELPER)) {
    const msg = `relaunch helper missing: ${HELPER}`
    logLine('helper-missing', msg)
    return { ok: false, error: msg }
  }
  // detached + stdio ignore + unref: this child outlives the process it kills.
  const child = spawn('/bin/sh', [
    HELPER,
    mode,
    String(process.pid),
    String(port),
    BOOT_CWD,
    LOG_FILE,
    process.execPath,
    ...BOOT_ARGV,
  ], {
    detached: true,
    stdio: 'ignore',
    env: cleanEnv(),
  })
  child.on('error', (e) => logLine('spawn-error', String(e?.message ?? e)))
  child.unref()
  return { ok: true, pid: child.pid }
}

export function apply(ctx) {
  // Resolve the listening port from the live server rather than assuming 3080.
  let port = 3080
  try {
    const origin = ctx.webServer.getOrigin()
    const parsed = new URL(origin)
    if (parsed.port) port = Number(parsed.port)
  } catch { /* keep the default */ }

  // ctx.effect binds the disposer to this plugin's lifetime. The Windows plugin
  // skipped this, so its routes survived being disabled until the next host
  // restart; doing it properly keeps disable/re-enable clean.
  const route = (path, handle) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS)
        res.end()
        return
      }
      if (!isLoopback(req)) {
        logLine('denied', `${path} host=${req.headers?.host ?? '-'} remote=${req.socket?.remoteAddress ?? '-'}`)
        res.writeHead(403, { ...CORS, 'content-type': 'text/plain; charset=utf-8' })
        res.end('power API is loopback-only\n')
        return
      }
      try {
        sendJson(res, 200, await handle())
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }))

  // Read-only self-check: no side effects, safe to poll.
  route('/api/power-macos/status', () => ({
    ok: true,
    platform: process.platform,
    supported: IS_DARWIN,
    endpoints: ['/api/power-macos/restart', '/api/power-macos/close'],
    pid: process.pid,
    port,
    execPath: process.execPath,
    argv: BOOT_ARGV,
    cwd: BOOT_CWD,
    helper: HELPER,
    helperExists: existsSync(HELPER),
    logFile: LOG_FILE,
    logExists: existsSync(LOG_FILE),
  }))

  route('/api/power-macos/restart', () => {
    if (!IS_DARWIN) {
      throw new Error(`this build targets macOS only (running on ${process.platform}); use dsh-page-refresh there`)
    }
    logLine('restart', `port=${port} pid=${process.pid} argv=${JSON.stringify(BOOT_ARGV)}`)
    const started = launchHelper('restart', port)
    if (!started.ok) throw new Error(started.error)
    return {
      ok: true,
      kind: 'restart',
      helperPid: started.pid,
      delayMs: 800,
      logFile: LOG_FILE,
      message: '正在重启 DeepSeek Harness',
    }
  })

  route('/api/power-macos/close', () => {
    if (!IS_DARWIN) {
      throw new Error(`this build targets macOS only (running on ${process.platform}); use dsh-page-refresh there`)
    }
    logLine('close', `pid=${process.pid}`)
    const started = launchHelper('close', port)
    if (!started.ok) throw new Error(started.error)
    return {
      ok: true,
      kind: 'close',
      helperPid: started.pid,
      delayMs: 300,
      logFile: LOG_FILE,
      message: '正在关闭 DeepSeek Harness',
    }
  })
}
