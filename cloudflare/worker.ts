/**
 * The site's server: the built site, plus the small API the public pages and
 * the administrator panel use.
 *
 * Two things live here, and they are the whole back end:
 *
 *   * the static build, handed straight to Cloudflare's edge — files are served
 *     without running this code at all;
 *   * `/api/*`, which reads and writes the event library and the site copy in
 *     D1, and `/media/*`, which serves uploaded photographs out of R2.
 *
 * There is one credential for the whole site: a long key, of which only a
 * SHA-256 is stored. The browser never sees whether it is right — it hands the
 * string over and is told yes or no. Reads of published content are open to
 * anyone; every write, and the read that includes drafts, needs the key.
 *
 * Because this Worker is the only thing holding a database connection, the
 * checks below are the site's only guard, and they are written to fail closed:
 * a request that gets past them is one that named the key correctly.
 */

interface Env {
  /** The event library and the site copy. */
  DB: D1Database
  /** Uploaded photographs. */
  IMAGES: R2Bucket
  /** The Vite build, served from the edge. */
  ASSETS: Fetcher
}

/** Where the panel's key travels. Same origin, so no header rewriting is involved. */
const KEY_HEADER = 'x-site-key'

/** A refused key. The panel turns this into one sentence of its own. */
const KEY_REJECTED = 'KEY_REJECTED'

/**
 * Length floors, carried over from the previous design unchanged.
 *
 * The comparison floor is not decoration: without it a stored hash of a short
 * or empty string would be reachable by supplying that same short string. The
 * replacement floor is higher so a key cannot be swapped for one that the
 * comparison would then refuse.
 */
const COMPARE_LENGTH_FLOOR = 16
const KEY_MIN_LENGTH = 24

/** A write-up, not a file. D1 refuses a statement much larger than this. */
const MAX_BODY_BYTES = 64 * 1024
const MAX_JSON_BYTES = 512 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_GALLERY = 40
const MAX_TAGS = 30

const STATUSES = new Set(['draft', 'published', 'archived'])
const ROLES = new Set(['host', 'co-host', 'partner'])
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'BAD_REQUEST',
  ) {
    super(message)
  }
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function send(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Compared without an early exit, so how long the answer takes says nothing. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Whether the supplied key is the site's key. */
async function keyIsCorrect(env: Env, candidate: string | null): Promise<boolean> {
  if (!candidate || candidate.length < COMPARE_LENGTH_FLOOR) return false
  const row = await env.DB.prepare('select key_hash from site_access where only_row = 1').first<{
    key_hash: string
  }>()
  if (!row) return false
  return sameHash(row.key_hash, await sha256Hex(candidate))
}

/**
 * The gate every write passes through.
 *
 * Every refusal carries the same code, because the panel shows the same
 * sentence for all of them: a key that was replaced elsewhere and a key that
 * was never right look identical from the outside, and that is deliberate.
 */
async function requireKey(request: Request, env: Env): Promise<void> {
  const supplied = request.headers.get(KEY_HEADER)
  if (!(await keyIsCorrect(env, supplied))) {
    throw new HttpError(403, 'the site key was not accepted', KEY_REJECTED)
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text()
  if (raw.length > MAX_JSON_BYTES) {
    throw new HttpError(413, 'That change is too large to save.', 'TOO_LARGE')
  }
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'The request body was not valid JSON.', 'BAD_REQUEST')
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** An optional column: an absent value and an empty one both mean "nothing". */
function optionalText(value: unknown): string | null {
  const trimmed = text(value).trim()
  return trimmed === '' ? null : trimmed
}

function stringArray(value: unknown, limit: number, field: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new HttpError(400, `"${field}" must be a list.`)
  const items = value.map((item) => text(item).trim()).filter(Boolean)
  if (items.length > limit) throw new HttpError(400, `"${field}" holds too many entries.`)
  return items
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

/**
 * A row as the site expects it.
 *
 * The database keeps `gallery` and `tags` as JSON text and `featured` as 0 or
 * 1, because SQLite has neither arrays nor a boolean. They are turned back into
 * a list and a boolean here so that nothing above this line has to know.
 */
function rowToEvent(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    gallery: parseJsonArray(row.gallery),
    tags: parseJsonArray(row.tags),
    featured: row.featured === 1 || row.featured === true,
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The published library, as anyone sees it.
 *
 * Drafts and archived records are filtered out in the query rather than after
 * it, so they are never loaded, let alone sent.
 */
async function publicEvents(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select * from events where status = 'published' order by event_date desc, id desc`,
  ).all()
  return send({ events: (results ?? []).map((row) => rowToEvent(row as Record<string, unknown>)) })
}

/** The whole library, drafts and archived records included — for the panel. */
async function adminEvents(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'select * from events order by event_date desc, id desc',
  ).all()
  return send({ events: (results ?? []).map((row) => rowToEvent(row as Record<string, unknown>)) })
}

/** The site copy, or nothing when it has never been edited. */
async function readSettings(env: Env): Promise<Response> {
  const row = await env.DB.prepare('select value from site_settings where key = ?')
    .bind('site')
    .first<{ value: string }>()
  if (!row) return send({ settings: null })
  try {
    return send({ settings: JSON.parse(row.value) })
  } catch {
    return send({ settings: null })
  }
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Creates or overwrites one event, keyed on `slug`.
 *
 * The columns are named one by one rather than taken from the row as sent: the
 * caller's JSON is input to be interpreted, never a row to be written
 * wholesale. `id` and `created_at` are therefore not reachable from the panel
 * at all.
 *
 * `cover_image` and every entry of `gallery` must be a URL this site serves.
 * Photographs are uploaded first and stored in R2; a data URL pasted in as a
 * cover would be a few hundred kilobytes inside a database reasonably sized in
 * kilobytes, which D1 refuses outright.
 */
async function saveEvent(env: Env, input: Record<string, unknown>): Promise<Response> {
  const slug = text(input.slug).trim()
  const title = text(input.title).trim()
  const eventDate = text(input.event_date).trim()
  if (!slug || !title) throw new HttpError(400, 'An event needs a slug and a title.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new HttpError(400, 'An event needs a date, as YYYY-MM-DD.')
  }

  const body = text(input.body)
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'That write-up is too long to save.', 'TOO_LARGE')
  }

  const status = text(input.status).trim() || 'draft'
  if (!STATUSES.has(status)) throw new HttpError(400, `Unknown status: ${status}`)
  const role = text(input.role).trim() || 'host'
  if (!ROLES.has(role)) throw new HttpError(400, `Unknown role: ${role}`)

  const endDate = optionalText(input.end_date)
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new HttpError(400, 'The end date has to be YYYY-MM-DD.')
  }

  const cover = optionalText(input.cover_image)
  const gallery = stringArray(input.gallery, MAX_GALLERY, 'gallery')
  for (const src of [cover, ...gallery]) {
    if (src && src.startsWith('data:')) {
      throw new HttpError(
        400,
        'Photographs have to be uploaded rather than pasted in. Save the event again after re-adding the image.',
      )
    }
  }

  await env.DB.prepare(
    `insert into events (
       slug, title, summary, body, category, event_date, end_date, location, role,
       cover_image, gallery, tags, status, featured, source_url, source_credit,
       created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     on conflict (slug) do update set
       title = excluded.title, summary = excluded.summary, body = excluded.body,
       category = excluded.category, event_date = excluded.event_date,
       end_date = excluded.end_date, location = excluded.location, role = excluded.role,
       cover_image = excluded.cover_image, gallery = excluded.gallery, tags = excluded.tags,
       status = excluded.status, featured = excluded.featured,
       source_url = excluded.source_url, source_credit = excluded.source_credit,
       updated_at = datetime('now')`,
  )
    .bind(
      slug,
      title,
      text(input.summary),
      body,
      text(input.category).trim() || 'Event',
      eventDate,
      endDate,
      optionalText(input.location),
      role,
      cover,
      JSON.stringify(gallery),
      JSON.stringify(stringArray(input.tags, MAX_TAGS, 'tags')),
      status,
      input.featured ? 1 : 0,
      optionalText(input.source_url),
      optionalText(input.source_credit),
    )
    .run()

  const saved = await env.DB.prepare('select * from events where slug = ?')
    .bind(slug)
    .first<Record<string, unknown>>()
  if (!saved) throw new HttpError(500, 'The change was saved but could not be read back.', 'INTERNAL')
  return send({ event: rowToEvent(saved) })
}

/** Publishes, drafts or archives one event, without destroying the record. */
async function setEventStatus(env: Env, input: Record<string, unknown>): Promise<Response> {
  const slug = text(input.slug).trim()
  const status = text(input.status).trim()
  if (!slug) throw new HttpError(400, 'Which event?')
  if (!STATUSES.has(status)) throw new HttpError(400, `Unknown status: ${status}`)
  const result = await env.DB.prepare(
    `update events set status = ?, updated_at = datetime('now') where slug = ?`,
  )
    .bind(status, slug)
    .run()
  return send({ ok: changed(result) })
}

/** Removes an event from the library for good. */
async function deleteEvent(env: Env, slug: string): Promise<Response> {
  const result = await env.DB.prepare('delete from events where slug = ?').bind(slug).run()
  return send({ ok: changed(result) })
}

/** Whether a statement touched anything. */
function changed(result: { meta?: { changes?: number } }): boolean {
  return (result.meta?.changes ?? 0) > 0
}

/** Replaces the site copy as a whole. */
async function saveSettings(env: Env, value: unknown): Promise<Response> {
  const payload = JSON.stringify(value ?? {})
  if (payload.length > MAX_JSON_BYTES) {
    throw new HttpError(413, 'That change is too large to save.', 'TOO_LARGE')
  }
  await env.DB.prepare(
    `insert into site_settings (key, value, updated_at) values ('site', ?, datetime('now'))
     on conflict (key) do update set value = excluded.value, updated_at = datetime('now')`,
  )
    .bind(payload)
    .run()
  return send({ ok: true })
}

/**
 * Replaces the key itself.
 *
 * The current key is required, so a browser left open does not by itself allow
 * the club to be locked out of its own site.
 */
async function replaceKey(env: Env, input: Record<string, unknown>): Promise<Response> {
  const current = text(input.current)
  const next = text(input.next)
  if (!(await keyIsCorrect(env, current))) {
    throw new HttpError(403, 'the site key was not accepted', KEY_REJECTED)
  }
  if (next.length < KEY_MIN_LENGTH) {
    throw new HttpError(400, `A site key needs at least ${KEY_MIN_LENGTH} characters.`)
  }
  const stored = await env.DB.prepare(
    `update site_access set key_hash = ?, updated_at = datetime('now') where only_row = 1`,
  )
    .bind(await sha256Hex(next))
    .run()
  if (!changed(stored)) {
    throw new HttpError(500, 'This database has no site key row to replace.', 'INTERNAL')
  }
  return send({ ok: true })
}

/* -------------------------------------------------------------------------- */
/* Photographs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Stores one uploaded photograph and answers with the URL that serves it.
 *
 * The bytes go to R2 and only the URL goes to the database, so a write-up and
 * its pictures no longer share a row limit — which is the reason the site can
 * hold a gallery of any size rather than being kept small on purpose.
 */
async function uploadImage(request: Request, env: Env, name: string): Promise<Response> {
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const extension = IMAGE_TYPES[contentType]
  if (!extension) {
    throw new HttpError(415, 'Only JPEG, PNG, WebP or AVIF images can be uploaded.', 'BAD_TYPE')
  }
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength === 0) throw new HttpError(400, 'That file was empty.')
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'That image is larger than 8 MB.', 'TOO_LARGE')
  }

  // Named for when it was added and what it belongs to, so the bucket stays
  // readable; made unique so two uploads cannot collide.
  const stem = (name || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  const key = `events/${new Date().toISOString().slice(0, 7)}/${stem || 'image'}-${crypto.randomUUID().slice(0, 8)}.${extension}`

  await env.IMAGES.put(key, bytes, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
  })
  return send({ url: `/media/${key}`, key })
}

/** Serves an uploaded photograph. Its contents never change, so it caches for a year. */
async function serveImage(request: Request, env: Env, key: string): Promise<Response> {
  if (!key) throw new HttpError(404, 'Not found', 'NOT_FOUND')
  const object = await env.IMAGES.get(key)
  if (!object) throw new HttpError(404, 'Not found', 'NOT_FOUND')

  const etag = object.httpEtag
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } })
  }
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', etag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  // Whatever the bytes turn out to be, the browser is told to trust the type
  // the upload declared rather than to sniff one from the contents.
  headers.set('x-content-type-options', 'nosniff')
  return new Response(object.body, { headers })
}

/* -------------------------------------------------------------------------- */
/* Routing                                                                    */
/* -------------------------------------------------------------------------- */

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url
  const method = request.method

  if (pathname.startsWith('/media/')) {
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Not allowed')
    return serveImage(request, env, pathname.slice('/media/'.length))
  }

  if (pathname === '/api/health') {
    const row = await env.DB.prepare('select count(*) as events from events').first<{ events: number }>()
    return send({ ok: true, events: row?.events ?? 0 })
  }

  // Open to anyone: what the public pages need and nothing more.
  if (pathname === '/api/events' && method === 'GET') return publicEvents(env)
  if (pathname === '/api/settings' && method === 'GET') return readSettings(env)

  if (pathname === '/api/admin/verify' && method === 'POST') {
    const body = await readJson(request)
    return send({ ok: await keyIsCorrect(env, text(body.key)) })
  }

  if (pathname.startsWith('/api/admin/')) {
    await requireKey(request, env)

    if (pathname === '/api/admin/events' && method === 'GET') return adminEvents(env)
    if (pathname === '/api/admin/events' && method === 'PUT') {
      return saveEvent(env, await readJson(request))
    }
    if (pathname === '/api/admin/events/status' && method === 'POST') {
      return setEventStatus(env, await readJson(request))
    }
    if (pathname === '/api/admin/events' && method === 'DELETE') {
      const slug = url.searchParams.get('slug')
      if (!slug) throw new HttpError(400, 'Which event?')
      return deleteEvent(env, slug)
    }
    if (pathname === '/api/admin/settings' && method === 'PUT') {
      const body = await readJson(request)
      return saveSettings(env, body.settings)
    }
    if (pathname === '/api/admin/key' && method === 'POST') {
      return replaceKey(env, await readJson(request))
    }
    if (pathname === '/api/admin/images' && method === 'POST') {
      return uploadImage(request, env, url.searchParams.get('name') ?? '')
    }
    throw new HttpError(404, 'Not found', 'NOT_FOUND')
  }

  // Anything else: a file from the build, or the edge's own 404.
  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Not allowed')
  return env.ASSETS.fetch(request)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env, new URL(request.url))
    } catch (error) {
      if (error instanceof HttpError) {
        return send({ error: { message: error.message, code: error.code } }, error.status)
      }
      console.error('unhandled', error)
      return send({ error: { message: 'Something went wrong.', code: 'INTERNAL' } }, 500)
    }
  },
}
