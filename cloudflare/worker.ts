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
 * There are two credentials, and they are not two of the same thing.
 *
 * Reads of published content are open to anyone: the events list, the site copy
 * and the photographs. Everything else is checked, and the two checks are
 * deliberately separate.
 *
 * The first credential is the site's own key, a long string of which only a
 * SHA-256 is stored. The browser never sees whether it is right — it hands the
 * string over and is told yes or no. It opens everything: every event, the site
 * copy, and the key itself.
 *
 * The second is a shared editing link, which the panel makes from an event's
 * own page and which opens exactly that one event until it expires. It exists
 * because the people who write events up are not administrators and should not
 * have to hold the site's key to add a paragraph and a few photographs. It
 * cannot reach a different event, cannot publish, unpublish or delete anything,
 * and cannot see the site copy.
 *
 * The two are checked by separate functions and answer on separate routes, so
 * that adding the narrow one left the wide one exactly as it was.
 *
 * Because a link lets somebody who is not an administrator rewrite an event,
 * every save also keeps the version it replaced — one version back, which is
 * what it takes to undo an edit nobody meant to make rather than to keep a
 * history. That copy is the panel's to read and to put back; a link does not
 * see it, and a link cannot restore one.
 *
 * Because this Worker is the only thing holding a database connection, the
 * checks below are the site's only guard, and they are written to fail closed:
 * a request that gets past them is one that named a credential correctly.
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

/** Where a shared editing link's token travels. Its own header, so neither can be mistaken for the other. */
const SHARE_HEADER = 'x-event-token'

/** A refused link — unknown, expired or revoked. They are one answer on purpose. */
const SHARE_REJECTED = 'SHARE_REJECTED'

/**
 * How long a shared editing link may run, and what it gets when the panel does
 * not say. A ceiling rather than an open question: a link is a credential sent
 * through a chat message, and "indefinitely" is not one of the things it should
 * be possible to ask for by accident.
 */
const SHARE_DAYS_MIN = 1
const SHARE_DAYS_MAX = 90
const SHARE_DAYS_DEFAULT = 7
const DAY_MS = 24 * 60 * 60 * 1000

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

/** One row of `event_tokens`, which is one shared editing link. */
interface ShareRow {
  token: string
  slug: string
  label: string
  created_at: string
  expires_at: string
  last_used_at: string | null
}

/**
 * A fresh token: 24 random bytes, in a form that survives a chat message.
 *
 * Base64url, so the link holds no character that has to be escaped, wrapped or
 * explained — a link that breaks when pasted into WeChat is a link that comes
 * back as a support question.
 */
function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * The shared editing link a request names, if it names one that still works.
 *
 * Three ways to be refused — never issued, taken back, or past its date — and
 * they are answered identically. Whoever is holding the link is not owed the
 * difference between them; the administrator can see the list of live links in
 * the panel, which is where that question belongs.
 *
 * The expiry is compared here rather than in SQL because the two sides write
 * dates differently: `datetime('now')` produces `2026-09-22 13:00:00` and a
 * JavaScript `toISOString()` produces `2026-09-22T13:00:00.000Z`, and text
 * comparison between those two shapes is not a comparison of moments. A date
 * that cannot be read at all is refused rather than trusted.
 *
 * Reading a link is also what marks it used, so the panel can say when it was
 * last opened — the single most useful thing to know about a link that has been
 * sent to somebody else.
 */
async function shareFor(request: Request, env: Env): Promise<ShareRow> {
  const token = request.headers.get(SHARE_HEADER)
  if (!token) throw new HttpError(403, 'this link is no longer good', SHARE_REJECTED)

  const row = await env.DB.prepare('select * from event_tokens where token = ?')
    .bind(token)
    .first<ShareRow>()

  const expiresAt = row ? Date.parse(row.expires_at) : Number.NaN
  if (!row || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(403, 'this link is no longer good', SHARE_REJECTED)
  }

  await env.DB.prepare(`update event_tokens set last_used_at = datetime('now') where token = ?`)
    .bind(token)
    .run()
  return row
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
 *
 * `fixed` pins the fields that the caller does not get to choose. A shared
 * editing link passes the event it was made for and that event's current
 * publishing state, so neither is read from the request: no value the holder of
 * a link could send reaches another event, takes one off the public site, or
 * puts one on it. It also carries which door the save came through, which is
 * recorded with the version this save displaces rather than with the event.
 */
async function saveEvent(
  env: Env,
  input: Record<string, unknown>,
  fixed: { slug?: string; status?: string; via?: RevisionVia } = {},
): Promise<Response> {
  const slug = (fixed.slug ?? text(input.slug)).trim()
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

  const status = fixed.status ?? (text(input.status).trim() || 'draft')
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

  /*
    Everything the row will hold, named once. The same object is what gets
    written and what gets compared against the row being replaced, so the
    comparison cannot drift away from the write: a column added to one is a
    column added to both, because there is only one of them.
  */
  const content = {
    title,
    summary: text(input.summary),
    body,
    category: text(input.category).trim() || 'Event',
    event_date: eventDate,
    end_date: endDate,
    location: optionalText(input.location),
    role,
    cover_image: cover,
    gallery: JSON.stringify(gallery),
    tags: JSON.stringify(stringArray(input.tags, MAX_TAGS, 'tags')),
    source_url: optionalText(input.source_url),
    source_credit: optionalText(input.source_credit),
  }

  // What is about to be replaced, read before it is. An event that has never
  // been saved has nothing to keep, which is also why this is not an error.
  const previous = await env.DB.prepare('select * from events where slug = ?')
    .bind(slug)
    .first<Record<string, unknown>>()

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
      content.title,
      content.summary,
      content.body,
      content.category,
      content.event_date,
      content.end_date,
      content.location,
      content.role,
      content.cover_image,
      content.gallery,
      content.tags,
      status,
      input.featured ? 1 : 0,
      content.source_url,
      content.source_credit,
    )
    .run()

  // Only once the write has gone through, and only when it changed something.
  // Pressing Save on a page nobody has touched writes the same words back, and
  // that must not be allowed to replace the kept version with a copy of what is
  // already on screen — which would quietly throw away the one worth having.
  if (previous && !sameContent(previous, content)) {
    await keepRevision(env, previous, fixed.via ?? 'panel')
  }

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
  // The kept version goes with it. "For good" has to mean the copy as well, and
  // a version left behind would come back to life the next time the same slug
  // was used — as a version of an event it was never a version of.
  if (changed(result)) {
    await env.DB.prepare('delete from event_revisions where slug = ?').bind(slug).run()
  }
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
/* The version kept from before the last save                                 */
/*                                                                            */
/* An event is written from two places, and the second one is somebody else.   */
/* One version back is what makes that safe: not a history, and not a way to   */
/* review an edit before it lands — just the answer to "put back what was      */
/* there before this happened".                                               */
/* -------------------------------------------------------------------------- */

/** Which door performed a save, recorded with the version that save displaced. */
type RevisionVia = 'panel' | 'link' | 'restore'

/**
 * The columns an earlier version holds, and the only ones a restore puts back.
 *
 * Publishing state is deliberately not among them. `status` decides whether the
 * event is on the public site and `featured` whether the home page leads with
 * it: both are the panel's decisions about where an event appears, and a
 * recovery that silently moved an event onto or off the public site would be a
 * second change nobody asked for. The words come back; the placement stays.
 */
const REVISION_COLUMNS = [
  'title',
  'summary',
  'body',
  'category',
  'event_date',
  'end_date',
  'location',
  'role',
  'cover_image',
  'gallery',
  'tags',
  'source_url',
  'source_credit',
] as const

/**
 * Whether a stored row already holds exactly this content.
 *
 * Compared column by column rather than serialised whole, because the row
 * carries timestamps and an id that no save has an opinion about. `null` and a
 * missing column are the same answer here, which is what an optional column
 * means.
 */
function sameContent(row: Record<string, unknown>, content: Record<string, unknown>): boolean {
  return REVISION_COLUMNS.every((column) => (row[column] ?? null) === (content[column] ?? null))
}

/**
 * Puts the version a save is about to replace into the one slot kept per event.
 *
 * Replacing rather than appending is the whole design: the slot answers "what
 * was here a moment ago", and a second row would only raise a question — how
 * far back, and how far is too far — that nothing in the site needs answered.
 */
async function keepRevision(env: Env, row: Record<string, unknown>, via: RevisionVia): Promise<void> {
  await env.DB.prepare(
    `insert into event_revisions (
       slug, title, summary, body, category, event_date, end_date, location, role,
       cover_image, gallery, tags, source_url, source_credit, saved_at, via
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
     on conflict (slug) do update set
       title = excluded.title, summary = excluded.summary, body = excluded.body,
       category = excluded.category, event_date = excluded.event_date,
       end_date = excluded.end_date, location = excluded.location, role = excluded.role,
       cover_image = excluded.cover_image, gallery = excluded.gallery, tags = excluded.tags,
       source_url = excluded.source_url, source_credit = excluded.source_credit,
       saved_at = excluded.saved_at, via = excluded.via`,
  )
    .bind(
      row.slug,
      row.title ?? '',
      row.summary ?? '',
      row.body ?? '',
      row.category ?? 'Event',
      row.event_date,
      row.end_date ?? null,
      row.location ?? null,
      row.role ?? 'host',
      row.cover_image ?? null,
      row.gallery ?? '[]',
      row.tags ?? '[]',
      row.source_url ?? null,
      row.source_credit ?? null,
      via,
    )
    .run()
}

/** A kept version, with the two list columns turned back into lists. */
function rowToRevision(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, gallery: parseJsonArray(row.gallery), tags: parseJsonArray(row.tags) }
}

/**
 * The version kept for one event, or nothing when the event has not been
 * overwritten since it was first saved.
 *
 * Panel-only, like every other question about how an event came to look the way
 * it does. Whoever holds a link sees the event as it stands; what it said before
 * they touched it is the administrator's, not theirs.
 */
async function readRevision(env: Env, slug: string): Promise<Response> {
  if (!slug) throw new HttpError(400, 'Which event?')
  const row = await env.DB.prepare('select * from event_revisions where slug = ?')
    .bind(slug)
    .first<Record<string, unknown>>()
  return send({ revision: row ? rowToRevision(row) : null })
}

/**
 * Puts the kept version back.
 *
 * Written as one call to `saveEvent` rather than as an update of its own, which
 * is what makes a restore itself recoverable: the save that takes the kept
 * version out of the slot pushes the current one in, so the two change places.
 * Restoring a second time therefore returns to where the first one started,
 * without any of that being arranged for separately.
 *
 * The publishing state is read now and passed in, because `saveEvent` will not
 * take it from the revision — recovering the words is not a reason for an event
 * to change where it appears.
 */
async function restoreRevision(env: Env, input: Record<string, unknown>): Promise<Response> {
  const slug = text(input.slug).trim()
  if (!slug) throw new HttpError(400, 'Which event?')

  const kept = await env.DB.prepare('select * from event_revisions where slug = ?')
    .bind(slug)
    .first<Record<string, unknown>>()
  if (!kept) {
    throw new HttpError(404, 'There is no earlier version of this event to put back.', 'NOT_FOUND')
  }

  const current = await env.DB.prepare('select * from events where slug = ?')
    .bind(slug)
    .first<Record<string, unknown>>()
  if (!current) throw new HttpError(404, 'That event is no longer in the library.', 'NOT_FOUND')

  return saveEvent(
    env,
    { ...rowToRevision(kept), slug, featured: Boolean(current.featured) },
    { slug, status: text(current.status).trim() || 'draft', via: 'restore' },
  )
}

/* -------------------------------------------------------------------------- */
/* Shared editing links                                                       */
/*                                                                            */
/* Making, seeing and taking back the links an administrator hands out; and   */
/* what one of those links can do once it is opened. The first three are on    */
/* the panel's side of the wall and need the key. The last two are the whole   */
/* of what a link reaches, and they are written to answer about one event and  */
/* nothing else.                                                              */
/* -------------------------------------------------------------------------- */

/** How long a requested link should run, kept inside the allowed range. */
function shareDays(value: unknown): number {
  const days = Math.round(Number(value))
  if (!Number.isFinite(days)) return SHARE_DAYS_DEFAULT
  return Math.min(SHARE_DAYS_MAX, Math.max(SHARE_DAYS_MIN, days))
}

/**
 * Issues a link for one event.
 *
 * The event has to exist first: a link is addressed to a record, and a token
 * pointing at a slug that has never been saved would open a page that could
 * only apologise. The panel therefore offers this once the event is saved.
 */
async function createShare(env: Env, input: Record<string, unknown>): Promise<Response> {
  const slug = text(input.slug).trim()
  if (!slug) throw new HttpError(400, 'Which event?')

  const exists = await env.DB.prepare('select slug from events where slug = ?').bind(slug).first()
  if (!exists) {
    throw new HttpError(404, 'Save the event before sharing a link to it.', 'NOT_FOUND')
  }

  const days = shareDays(input.days)
  const token = newShareToken()
  const expiresAt = new Date(Date.now() + days * DAY_MS).toISOString()
  const label = text(input.label).trim().slice(0, 60)

  await env.DB.prepare(
    'insert into event_tokens (token, slug, label, expires_at) values (?, ?, ?, ?)',
  )
    .bind(token, slug, label, expiresAt)
    .run()

  return send({
    share: { token, slug, label, expires_at: expiresAt, created_at: null, last_used_at: null },
  })
}

/** The links standing open for one event, newest first. */
async function listShares(env: Env, slug: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'select * from event_tokens where slug = ? order by created_at desc, rowid desc',
  )
    .bind(slug)
    .all()
  return send({ shares: results ?? [] })
}

/**
 * Takes a link back.
 *
 * The row is removed rather than marked, because a revoked link and a link that
 * was never issued are the same thing to everyone who might present one, and
 * one representation of "does not work" is easier to be sure of than two.
 */
async function revokeShare(env: Env, token: string): Promise<Response> {
  const result = await env.DB.prepare('delete from event_tokens where token = ?').bind(token).run()
  return send({ ok: changed(result) })
}

/**
 * The one event a link is for — any status, drafts included.
 *
 * Deliberately not the panel's event list narrowed down: that read answers with
 * the whole library, and the whole library is exactly what a link is not for.
 * This answers about the addressed row or not at all.
 */
async function readSharedEvent(env: Env, share: ShareRow): Promise<Response> {
  const row = await env.DB.prepare('select * from events where slug = ?')
    .bind(share.slug)
    .first<Record<string, unknown>>()
  if (!row) {
    throw new HttpError(404, 'The event this link was made for is no longer here.', 'NOT_FOUND')
  }
  return send({ event: rowToEvent(row) })
}

/**
 * Saves the one event a link is for, leaving its publishing state as it was.
 *
 * A link holder edits words and photographs; whether the result is on the
 * public site stays where it was, and stays the administrator's decision. That
 * is enforced by passing the current status in rather than by trusting the
 * request to leave it alone.
 */
async function saveSharedEvent(
  request: Request,
  env: Env,
  share: ShareRow,
): Promise<Response> {
  const current = await env.DB.prepare('select status from events where slug = ?')
    .bind(share.slug)
    .first<{ status: string }>()
  if (!current) {
    throw new HttpError(404, 'The event this link was made for is no longer here.', 'NOT_FOUND')
  }
  return saveEvent(env, await readJson(request), {
    slug: share.slug,
    status: current.status,
    via: 'link',
  })
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
 *
 * Reached through either gate: the panel uploads, and so does whoever is
 * holding a shared editing link, which is the point of sending them one. What
 * differs is only which door they came through.
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

  /*
    A shared editing link, checked against its own table and answered on its own
    routes. It reaches three things and no more: the event it was made for, the
    right to save that event, and the image store. Everything else the site can
    do — every other event, the site copy, publishing, deleting, the key — is
    behind `/api/admin/` below, where this token is worth nothing.
  */
  if (pathname.startsWith('/api/share/')) {
    const share = await shareFor(request, env)
    if (pathname === '/api/share/event' && method === 'GET') return readSharedEvent(env, share)
    if (pathname === '/api/share/event' && method === 'PUT') {
      return saveSharedEvent(request, env, share)
    }
    if (pathname === '/api/share/images' && method === 'POST') {
      return uploadImage(request, env, url.searchParams.get('name') ?? '')
    }
    throw new HttpError(404, 'Not found', 'NOT_FOUND')
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
    /*
      The version kept from before the last save: read it, or put it back.
      Neither is reachable with a link — the token routes above answer about one
      event as it stands and offer no way to reach behind it.
    */
    if (pathname === '/api/admin/events/revision' && method === 'GET') {
      return readRevision(env, url.searchParams.get('slug') ?? '')
    }
    if (pathname === '/api/admin/events/revision' && method === 'POST') {
      return restoreRevision(env, await readJson(request))
    }
    if (pathname === '/api/admin/shares' && method === 'GET') {
      const slug = url.searchParams.get('slug')
      if (!slug) throw new HttpError(400, 'Which event?')
      return listShares(env, slug)
    }
    if (pathname === '/api/admin/shares' && method === 'POST') {
      return createShare(env, await readJson(request))
    }
    if (pathname === '/api/admin/shares' && method === 'DELETE') {
      const token = url.searchParams.get('token')
      if (!token) throw new HttpError(400, 'Which link?')
      return revokeShare(env, token)
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
