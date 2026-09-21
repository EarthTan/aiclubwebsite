/**
 * Starts the site against the local development backend.
 *
 *   npm run local
 *
 * Three steps, in order: make sure the local database exists, start the API on
 * top of it, then start Vite with the flag that points the site at that API.
 * Ctrl-C stops everything.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { API_PORT, SITE_PORT } from './config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const children = []
let shuttingDown = false

function run(command, args, env, { label, fatal = true } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)

  const forward = (stream, target) => {
    stream.setEncoding('utf8')
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        target.write(`${label} ${line}\n`)
      }
    })
  }
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)

  // The setup step is awaited explicitly, so its normal exit is not a failure.
  if (fatal) {
    child.on('exit', (code, signal) => {
      if (shuttingDown) return
      console.error(`\n${label} stopped (${signal ?? `exit ${code}`}). Shutting down.\n`)
      shutdown(code ?? 1)
    })
  }

  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 150)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function waitFor(stream) {
  return new Promise((resolve, reject) => {
    stream.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
    stream.once('error', reject)
  })
}

async function apiIsUp() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${API_PORT}/api/health`)
      if (response.ok) return true
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

console.log('\nLocal development mode — the site will use the local database.\n')

const setup = run(process.execPath, [path.join(here, 'setup.mjs')], {}, { label: '[db] ', fatal: false })
try {
  await waitFor(setup)
} catch {
  process.exit(1)
}

run(process.execPath, [path.join(here, 'server.mjs')], {}, { label: '[api]' })

if (!(await apiIsUp())) {
  console.error(`\nThe local API did not come up on port ${API_PORT}.\n`)
  shutdown(1)
}

console.log(
  `\n  Site:  http://localhost:${SITE_PORT}/#/admin\n` +
    `  API:   http://127.0.0.1:${API_PORT}/api/health\n` +
    `  Data:  /api  →  local PostgreSQL\n`,
)

run(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')],
  { VITE_LOCAL_BACKEND: '1', PORT: String(SITE_PORT) },
  { label: '[web]' },
)
