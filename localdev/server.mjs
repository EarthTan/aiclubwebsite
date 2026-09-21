/**
 * Local development API.
 *
 * The site normally talks to a hosted backend. This server stands in for it on
 * this machine, backed by the local PostgreSQL database, so the whole site can
 * be exercised — reading the event library, editing events and site copy,
 * replacing the site key — without touching the hosted data.
 *
 * It speaks the same small slice of protocol the site actually uses:
 *
 *   POST /api/db          a table operation (select / insert / update / upsert / delete)
 *   POST /api/rpc         a database function
 *
 * There is no account system and no auth endpoint: the panel's only credential
 * is the site key, and it travels as an ordinary function argument. That means
 * every request this server handles runs as `anon` — which is also true of
 * production, since the hosted data plane is called without a token. The
 * row-level security policies in schema.sql therefore apply exactly as they do
 * there: a read that would be refused in production is refused here.
 */

import http from 'node:http'
import pg from 'pg'
import { API_PORT, DATABASE_URL } from './config.mjs'

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 })

// A `date` column arrives as a JavaScript Date at midnight local time, which
// serialises to the *previous* day once the offset is applied. The hosted API
// answers with the plain calendar date, so the driver is told to do the same.
pg.types.setTypeParser(1082, (value) => value)

/* -------------------------------------------------------------------------- */
/* SQL construction                                                           */
/* -------------------------------------------------------------------------- */

/** Only these tables can be reached. Anything else is a bug, not a feature. */
const TABLES = new Set(['events', 'site_settings'])

/**
 * Columns the driver must hand to Postgres as JSON text rather than as a value.
 * `events.tags` is deliberately absent: it is a real Postgres array, so the
 * driver is given the array itself and writes the array literal.
 */
const JSONB_COLUMNS = {
  events: new Set(['gallery']),
  site_settings: new Set(['value']),
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

function quote(identifier) {
  if (!IDENTIFIER.test(identifier)) {
    throw new HttpError(400, `Unsafe identifier: ${identifier}`, 'BAD_REQUEST')
  }
  return `"${identifier}"`
}

function selectList(spec) {
  if (!spec || spec === '*') return '*'
  return String(spec)
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      // PostgREST's `alias:column` form is accepted; the site does not use it.
      const [alias, column] = raw.includes(':') ? raw.split(':') : [null, raw]
      return alias ? `${quote(alias)}:${quote(column)}` : quote(column)
    })
    .join(', ')
}

function toParameter(table, column, value) {
  if (value === null || value === undefined) return value
  if (JSONB_COLUMNS[table]?.has(column)) {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  // A Postgres array column (`events.tags`) takes the array as it stands.
  if (Array.isArray(value)) return value
  return typeof value === 'object' ? JSON.stringify(value) : value
}

/**
 * Builds the `where` clause. Only the operators the site actually issues are
 * accepted, so an unsupported filter fails loudly instead of being ignored —
 * a silently dropped filter would be far worse than an error here.
 */
function whereClause(filters, params) {
  if (!filters.length) return ''
  const clauses = filters.map(({ op = 'eq', column, value }) => {
    const col = quote(column)
    switch (op) {
      case 'eq':
        if (value === null) return `${col} is null`
        params.push(value)
        return `${col} = $${params.length}`
      case 'neq':
        if (value === null) return `${col} is not null`
        params.push(value)
        return `${col} <> $${params.length}`
      case 'in':
        params.push(value)
        return `${col} = any($${params.length})`
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const symbol = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]
        params.push(value)
        return `${col} ${symbol} $${params.length}`
      }
      default:
        throw new HttpError(400, `Unsupported filter: ${op}`, 'BAD_REQUEST')
    }
  })
  return ` where ${clauses.join(' and ')}`
}

function orderClause(order) {
  if (!order.length) return ''
  return (
    ' order by ' +
    order
      .map(({ column, ascending = true }) => `${quote(column)} ${ascending ? 'asc' : 'desc'}`)
      .join(', ')
  )
}

function buildStatement(request) {
  const { action = 'select' } = request
  const table = request.table
  if (!TABLES.has(table)) {
    throw new HttpError(400, `Unknown table: ${table}`, 'BAD_REQUEST')
  }
  // Parameters are numbered in the order they are bound, so each shape below
  // builds its own `where` clause rather than sharing one.
  const params = []

  if (action === 'select') {
    const sql =
      `select ${selectList(request.columns)} from ${quote(table)}` +
      whereClause(request.filters ?? [], params) +
      orderClause(request.order ?? []) +
      (request.limit ? ` limit ${Number(request.limit)}` : '')
    return { sql, params }
  }

  if (action === 'insert' || action === 'upsert') {
    const rows = Array.isArray(request.payload) ? request.payload : [request.payload]
    if (!rows.length || rows[0] == null) {
      throw new HttpError(400, 'Nothing to insert', 'BAD_REQUEST')
    }
    const columns = Object.keys(rows[0])
    const values = rows.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(toParameter(table, column, row[column]))
        return `$${params.length}`
      })
      return `(${placeholders.join(', ')})`
    })
    let sql =
      `insert into ${quote(table)} (${columns.map(quote).join(', ')}) ` +
      `values ${values.join(', ')}`
    if (action === 'upsert') {
      if (!request.onConflict) {
        throw new HttpError(400, 'An upsert needs onConflict', 'BAD_REQUEST')
      }
      const conflictColumns = String(request.onConflict).split(',').map((c) => c.trim())
      const conflict = conflictColumns.map(quote).join(', ')
      const updates = columns
        .filter((c) => !conflictColumns.includes(c))
        .map((c) => `${quote(c)} = excluded.${quote(c)}`)
      sql += ` on conflict (${conflict}) do ${updates.length ? `update set ${updates.join(', ')}` : 'nothing'}`
    }
    if (request.returning) sql += ' returning *'
    return { sql, params }
  }

  if (action === 'update') {
    if (!request.filters?.length) {
      throw new HttpError(400, 'Refusing to update every row', 'BAD_REQUEST')
    }
    const entries = Object.entries(request.payload ?? {})
    if (!entries.length) throw new HttpError(400, 'Nothing to update', 'BAD_REQUEST')
    // Assignments are bound first, then the filter that selects the rows.
    const assignments = entries.map(([column, value]) => {
      params.push(toParameter(table, column, value))
      return `${quote(column)} = $${params.length}`
    })
    const sql =
      `update ${quote(table)} set ${assignments.join(', ')}` +
      whereClause(request.filters, params) +
      (request.returning ? ' returning *' : '')
    return { sql, params }
  }

  if (action === 'delete') {
    if (!request.filters?.length) {
      throw new HttpError(400, 'Refusing to delete every row', 'BAD_REQUEST')
    }
    const sql =
      `delete from ${quote(table)}` +
      whereClause(request.filters, params) +
      (request.returning ? ' returning *' : '')
    return { sql, params }
  }

  throw new HttpError(400, `Unsupported action: ${action}`, 'BAD_REQUEST')
}

/* -------------------------------------------------------------------------- */
/* Request handling                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Runs one database request as `anon`, which is the only role this site ever
 * acts as — locally and in production alike. Lowering the connection is what
 * makes the schema's policies and grants apply; the API's own role owns the
 * tables and would otherwise bypass both.
 */
async function runAs(statement) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local role anon')
    const result = await client.query(statement.sql, statement.params)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      // Event cover images travel as data URLs, so allow a generous body.
      if (size > 24 * 1024 * 1024) {
        reject(new HttpError(413, 'Request body too large', 'PAYLOAD_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new HttpError(400, 'Body was not valid JSON', 'BAD_REQUEST'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Postgres errors the site is expected to provoke — a refused write, a
 * duplicate, a value that does not fit its column. They are answers, not
 * faults, so they are reported as ordinary failures and kept out of the log.
 *
 * The code is passed through as Postgres raised it. The hosted gateway prefixes
 * it with the module that raised it (`DATABASE_42501`), which is a divergence
 * worth knowing about; the client matches on the end of the code so that either
 * form reads the same.
 */
const EXPECTED_DATABASE_ERRORS = new Set([
  '42501', // insufficient privilege / row-level security / refused key
  '23505', // unique violation
  '23503', // foreign key violation
  '23502', // not null violation
  '22P02', // invalid text representation
  '22001', // value too long
  '22023', // invalid parameter value
  '42883', // no function matches the name and arguments that were sent
  '42P01', // undefined table
  '42703', // undefined column
])

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  // The site is proxied by Vite, so it is same-origin; these headers only make
  // the API usable from a plain `curl` or a differently-ported dev server.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  const send = (status, payload) => {
    const body = JSON.stringify(payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body)
  }

  try {
    if (url.pathname === '/api/health') {
      const { rows } = await pool.query('select 1 as ok')
      send(200, { ok: rows[0].ok === 1, database: DATABASE_URL.replace(/:[^:@]*@/, ':***@') })
      return
    }

    if (req.method !== 'POST') {
      throw new HttpError(405, 'Only POST is supported', 'METHOD_NOT_ALLOWED')
    }

    const body = await readBody(req)

    if (url.pathname === '/api/db') {
      const result = await runAs(buildStatement(body))
      const requested = body.action ?? 'select'
      const rows = result.rows ?? []
      let data
      if (requested === 'select') {
        if (body.mode === 'maybeSingle') data = rows[0] ?? null
        else if (body.mode === 'single') data = rows[0] ?? null
        else data = rows
      } else {
        data = body.returning ? rows : null
      }
      if (process.env.LOCAL_API_VERBOSE) {
        console.log(`  db ${requested} ${body.table} as anon → ${rows.length} row(s)`)
      }
      send(200, { data, error: null })
      return
    }

    if (url.pathname === '/api/rpc') {
      const fn = String(body.fn ?? '')
      if (!IDENTIFIER.test(fn)) throw new HttpError(400, `Unknown function: ${fn}`, 'BAD_REQUEST')
      // Arguments travel by name, the way PostgREST sends them, so the function's
      // own parameter list decides what it accepts. Names are checked against the
      // identifier rule and the values are bound, never interpolated. The site
      // key travels this way too — as an ordinary argument, not as a header.
      const args = body.args && typeof body.args === 'object' ? body.args : {}
      const names = Object.keys(args)
      for (const name of names) {
        if (!IDENTIFIER.test(name)) {
          throw new HttpError(400, `Unknown argument: ${name}`, 'BAD_REQUEST')
        }
      }
      const call = names.length
        ? `select public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) as result`
        : `select public.${fn}() as result`
      const result = await runAs({ sql: call, params: names.map((n) => args[n]) })
      send(200, { data: result.rows[0]?.result ?? null, error: null })
      return
    }

    throw new HttpError(404, `Unknown endpoint: ${url.pathname}`, 'NOT_FOUND')
  } catch (error) {
    const expected = EXPECTED_DATABASE_ERRORS.has(error.code)
    const status = error.status ?? (expected ? 400 : 500)
    if (status >= 500) console.error('  !  ', error)
    send(status, { data: null, error: { message: error.message, code: error.code ?? 'INTERNAL' } })
  }
})

server.listen(API_PORT, '127.0.0.1', async () => {
  try {
    await pool.query('select 1')
  } catch (error) {
    console.error(
      `\nCannot reach the local database (${DATABASE_URL}).\n` +
        `Run:  node localdev/setup.mjs\n\n${error.message}\n`,
    )
    process.exit(1)
  }
  console.log(`  local API ready on http://127.0.0.1:${API_PORT}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)))
  })
}
