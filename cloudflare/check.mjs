/**
 * End-to-end checks for the site's Cloudflare back end.
 *
 * Runs the Worker in Cloudflare's own local runtime — a real D1 database and a
 * real R2 bucket, on this machine, with no account involved — against a state
 * directory of its own, so it never touches the database the site is using.
 *
 *   npm run cf:check
 *
 * What it is for: the site's access control is two credentials checked in one
 * place — the panel key, which opens everything, and a shared editing link,
 * which opens one event for a few days — and the public/private split of the
 * event library rests entirely on them. Those are the things worth asserting
 * after every change, so they are asserted here rather than hoped for.
 *
 * The one version kept from before each save is asserted here too, because it
 * only exists to make the narrower credential safe to hand out: a link lets
 * somebody who is not an administrator overwrite an event, and a copy of what
 * they overwrote is the whole of what stands behind that.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PERSIST = path.join(root, '.wrangler/check-state')
const PORT = Number(process.env.CHECK_PORT || 8788)
const BASE = `http://127.0.0.1:${PORT}`
const DB = 'dku-ai-club'

const localWrangler = path.join(root, 'node_modules/.bin/wrangler')
const wrangler = existsSync(localWrangler) ? localWrangler : 'wrangler'

/* -------------------------------------------------------------------------- */
/* A very small test harness                                                  */
/* -------------------------------------------------------------------------- */

let passed = 0
const failures = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function check(name, run) {
  try {
    const detail = await run()
    passed += 1
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL  ${name} — ${error.message}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Talking to the Worker                                                      */
/* -------------------------------------------------------------------------- */

async function api(route, options = {}) {
  const headers = {}
  if (options.key) headers['x-site-key'] = options.key
  if (options.share) headers['x-event-token'] = options.share
  let body
  if (options.raw !== undefined) {
    headers['content-type'] = options.contentType ?? 'application/octet-stream'
    body = options.raw
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const response = await fetch(BASE + route, { method: options.method ?? 'GET', headers, body })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* a non-JSON answer is itself worth seeing, so it is kept as text */
  }
  return { status: response.status, json, text, headers: response.headers }
}

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */

function runWrangler(args, label) {
  const result = spawnSync(wrangler, args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (exit ${result.status})\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    )
  }
}

let server = null

async function stopServer() {
  if (!server) return
  const child = server
  server = null
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    child.once('exit', resolve)
    setTimeout(resolve, 5000)
  })
}

async function startServer() {
  const child = spawn(wrangler, ['dev', '--port', String(PORT), '--persist-to', PERSIST], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  server = child
  const log = []
  child.stdout.on('data', (chunk) => log.push(String(chunk)))
  child.stderr.on('data', (chunk) => log.push(String(chunk)))

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited early (code ${child.exitCode})\n${log.join('')}`)
    }
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  throw new Error(`wrangler dev did not answer within two minutes\n${log.join('')}`)
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                 */
/* -------------------------------------------------------------------------- */

const key = (await readFile(path.join(root, 'cloudflare/.site-key.txt'), 'utf8')).trim()
const otherKey = 'a-different-key-that-is-long-enough-to-pass'

await stopServer()
await rm(PERSIST, { recursive: true, force: true })

console.log('  --    preparing a database of its own')
runWrangler(
  ['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', 'cloudflare/schema.sql'],
  'the schema',
)
runWrangler(
  ['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', 'cloudflare/seed.sql'],
  'the seed',
)

console.log('  --    starting the Worker')
await startServer()
console.log('')

try {
  /* ---- the seeded library ------------------------------------------------ */

  await check('the database holds the 12 seeded events', async () => {
    const { json } = await api('/api/health')
    assert(json?.events === 12, `expected 12 events, saw ${json?.events}`)
    return `${json.events} events`
  })

  await check('the public list is the published library, newest first', async () => {
    const { status, json } = await api('/api/events')
    assert(status === 200, `expected 200, saw ${status}`)
    assert(json.events.length === 12, `expected 12, saw ${json.events.length}`)
    assert(
      json.events.every((event) => event.status === 'published'),
      'a non-published event was served to the public',
    )
    const dates = json.events.map((event) => event.event_date)
    assert([...dates].sort().reverse().join() === dates.join(), 'the list is not newest-first')
    assert(typeof json.events[0].featured === 'boolean', 'featured did not come back as a boolean')
    assert(Array.isArray(json.events[0].gallery), 'gallery did not come back as a list')
    return `${dates[0]} → ${dates[dates.length - 1]}`
  })

  await check('a write-up arrives whole', async () => {
    const archive = JSON.parse(await readFile(path.join(root, 'public/content/events.json'), 'utf8'))
    const longest = archive.reduce((a, b) => ((a.body?.length ?? 0) > (b.body?.length ?? 0) ? a : b))
    const { json } = await api('/api/events')
    const served = json.events.find((event) => event.slug === longest.slug)
    assert(served, `${longest.slug} is missing from the public list`)
    assert(
      served.body === longest.body,
      `${longest.slug} came back ${served.body.length} characters, the archive holds ${longest.body.length}`,
    )
    assert(served.body.includes('##'), 'the write-up looks empty')
    return `${longest.slug}, ${longest.body.length} characters, byte for byte`
  })

  await check('the site copy is untouched, and readable', async () => {
    const { status, json } = await api('/api/settings')
    assert(status === 200, `expected 200, saw ${status}`)
    assert(json.settings === null, 'settings should start empty and fall back to the code defaults')
    return 'null, as expected on a fresh database'
  })

  /* ---- what the key protects --------------------------------------------- */

  await check('the panel cannot read the library without a key', async () => {
    const { status, json } = await api('/api/admin/events')
    assert(status === 403, `expected 403, saw ${status}`)
    assert(json.error.code === 'KEY_REJECTED', `expected KEY_REJECTED, saw ${json.error.code}`)
    return 'refused'
  })

  await check('the panel cannot read the library with the wrong key', async () => {
    const { status } = await api('/api/admin/events', { key: otherKey })
    assert(status === 403, `expected 403, saw ${status}`)
    return 'refused'
  })

  await check('nothing can be written without a key', async () => {
    const { status } = await api('/api/admin/events', {
      method: 'PUT',
      body: { slug: 'sneaking-in', title: 'x', event_date: '2026-01-01' },
    })
    assert(status === 403, `expected 403, saw ${status}`)
    const { json } = await api('/api/events')
    assert(!json.events.some((event) => event.slug === 'sneaking-in'), 'the write went through anyway')
    return 'refused, and nothing appeared'
  })

  await check('a key is confirmed or refused, never guessed at', async () => {
    const good = await api('/api/admin/verify', { method: 'POST', body: { key } })
    const bad = await api('/api/admin/verify', { method: 'POST', body: { key: 'not-the-key-at-all' } })
    assert(good.json.ok === true, 'the real key was not confirmed')
    assert(bad.json.ok === false, 'a wrong key was confirmed')
    return 'yes for the real one, no for the other'
  })

  /* ---- writing ----------------------------------------------------------- */

  const draft = {
    slug: 'check-suite-draft',
    title: 'A draft that should stay out of sight',
    summary: 'Written by the check suite.',
    body: '# Draft\n\nThis exists only while the checks run.',
    category: 'Workshop',
    event_date: '2026-05-05',
    location: 'DKU',
    role: 'host',
    status: 'draft',
    featured: false,
    gallery: [],
    tags: ['check'],
    cover_image: null,
    source_url: null,
    source_credit: null,
  }

  await check('a draft can be written, and stays out of the public list', async () => {
    const { status, json } = await api('/api/admin/events', { method: 'PUT', body: draft, key })
    assert(status === 200, `expected 200, saw ${status}`)
    assert(json.event.id > 0, 'the saved row has no id')
    assert(json.event.tags[0] === 'check', 'the tags did not survive the round trip')
    assert(json.event.featured === false, 'featured came back wrong')

    const publicList = await api('/api/events')
    assert(
      !publicList.json.events.some((event) => event.slug === draft.slug),
      'a draft was served to the public',
    )
    const admins = await api('/api/admin/events', { key })
    assert(admins.json.events.length === 13, `the panel should see 13, saw ${admins.json.events.length}`)
    return 'in the panel, not in public'
  })

  await check('publishing puts it in the public list, archiving takes it out', async () => {
    await api('/api/admin/events/status', {
      method: 'POST',
      body: { slug: draft.slug, status: 'published' },
      key,
    })
    const published = await api('/api/events')
    assert(
      published.json.events.some((event) => event.slug === draft.slug),
      'a published event is missing from the public list',
    )

    await api('/api/admin/events/status', {
      method: 'POST',
      body: { slug: draft.slug, status: 'archived' },
      key,
    })
    const archived = await api('/api/events')
    assert(
      !archived.json.events.some((event) => event.slug === draft.slug),
      'an archived event is still public',
    )
    const admins = await api('/api/admin/events', { key })
    const row = admins.json.events.find((event) => event.slug === draft.slug)
    assert(row?.status === 'archived', 'the record should survive archiving')
    return 'published, then hidden without being lost'
  })

  await check('saving the same slug again overwrites rather than duplicates', async () => {
    await api('/api/admin/events', {
      method: 'PUT',
      body: { ...draft, title: 'Renamed', status: 'published' },
      key,
    })
    const admins = await api('/api/admin/events', { key })
    const matches = admins.json.events.filter((event) => event.slug === draft.slug)
    assert(matches.length === 1, `expected one row, saw ${matches.length}`)
    assert(matches[0].title === 'Renamed', 'the title did not change')
    return 'one row, new title'
  })

  await check('an event can be deleted', async () => {
    const removed = await api(`/api/admin/events?slug=${draft.slug}`, { method: 'DELETE', key })
    assert(removed.json.ok === true, 'the delete reported nothing removed')
    const admins = await api('/api/admin/events', { key })
    assert(admins.json.events.length === 12, `expected 12 left, saw ${admins.json.events.length}`)
    return 'gone'
  })

  await check('deleting something that is not there says so', async () => {
    const again = await api(`/api/admin/events?slug=${draft.slug}`, { method: 'DELETE', key })
    assert(again.json.ok === false, 'a second delete claimed success')
    return 'reported honestly'
  })

  await check('a pasted-in photograph is refused, with a reason', async () => {
    const { status, json } = await api('/api/admin/events', {
      method: 'PUT',
      body: { ...draft, cover_image: 'data:image/jpeg;base64,AAAA' },
      key,
    })
    assert(status === 400, `expected 400, saw ${status}`)
    assert(/uploaded/.test(json.error.message), `unexpected message: ${json.error.message}`)
    return 'refused'
  })

  await check('an event without a title or date is refused', async () => {
    const noTitle = await api('/api/admin/events', {
      method: 'PUT',
      body: { slug: 'x', event_date: '2026-01-01' },
      key,
    })
    const noDate = await api('/api/admin/events', {
      method: 'PUT',
      body: { slug: 'x', title: 'x' },
      key,
    })
    assert(noTitle.status === 400 && noDate.status === 400, 'an incomplete event was accepted')
    return 'refused'
  })

  await check('the site copy can be saved and read back', async () => {
    const settings = { club_name: 'Set by the checks', home_slugs: ['hackdku2024', 'deepseek'] }
    const saved = await api('/api/admin/settings', { method: 'PUT', body: { settings }, key })
    assert(saved.json.ok === true, 'the save reported failure')
    const read = await api('/api/settings')
    assert(read.json.settings.club_name === 'Set by the checks', 'the copy did not come back')
    // The order is the whole point of the list, so it is checked rather than
    // the membership: a list that came back sorted would be a different answer.
    assert(
      read.json.settings.home_slugs.join() === 'hackdku2024,deepseek',
      `the home page order came back as ${JSON.stringify(read.json.settings.home_slugs)}`,
    )
    return 'round-tripped, in order'
  })

  /* ---- photographs ------------------------------------------------------- */

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])

  let storedUrl = null

  await check('a photograph can be uploaded and is served back', async () => {
    const upload = await api('/api/admin/images?name=' + draft.slug, {
      method: 'POST',
      raw: jpeg,
      contentType: 'image/jpeg',
      key,
    })
    assert(upload.status === 200, `expected 200, saw ${upload.status}: ${upload.text}`)
    assert(upload.json.url.startsWith('/media/'), `unexpected url: ${upload.json.url}`)
    storedUrl = upload.json.url

    const served = await fetch(BASE + storedUrl)
    assert(served.status === 200, `expected 200 from ${storedUrl}, saw ${served.status}`)
    assert(
      served.headers.get('content-type')?.startsWith('image/jpeg'),
      `unexpected content type: ${served.headers.get('content-type')}`,
    )
    assert(
      /immutable/.test(served.headers.get('cache-control') ?? ''),
      'an image that never changes should cache for a long time',
    )
    return storedUrl
  })

  await check('an uploaded photograph can be attached to an event', async () => {
    const saved = await api('/api/admin/events', {
      method: 'PUT',
      body: { ...draft, cover_image: storedUrl, gallery: [storedUrl], status: 'published' },
      key,
    })
    assert(saved.status === 200, `expected 200, saw ${saved.status}: ${saved.text}`)
    assert(saved.json.event.cover_image === storedUrl, 'the cover did not stick')
    assert(saved.json.event.gallery.length === 1, 'the gallery did not stick')
    await api(`/api/admin/events?slug=${draft.slug}`, { method: 'DELETE', key })
    return 'attached, then cleaned up'
  })

  await check('a file that is not an image is refused', async () => {
    const { status } = await api('/api/admin/images', {
      method: 'POST',
      raw: new TextEncoder().encode('<html></html>'),
      contentType: 'text/html',
      key,
    })
    assert(status === 415, `expected 415, saw ${status}`)
    return 'refused'
  })

  await check('uploading needs the key', async () => {
    const { status } = await api('/api/admin/images', {
      method: 'POST',
      raw: jpeg,
      contentType: 'image/jpeg',
    })
    assert(status === 403, `expected 403, saw ${status}`)
    return 'refused'
  })

  /* ---- shared editing links ---------------------------------------------- */

  /*
    The second credential, and the boundary that makes it worth having. A link
    is meant to be handed to somebody who is not an administrator, so every
    check here is written from their point of view: what the link reaches, and
    what it does not.
  */

  const shared = {
    slug: 'check-suite-shared',
    title: 'Written through a link',
    summary: 'Started by the check suite.',
    body: '# First pass\n\nWritten by somebody with a link and no key.',
    category: 'Workshop',
    event_date: '2026-06-06',
    location: 'DKU',
    role: 'host',
    status: 'draft',
    featured: false,
    gallery: [],
    tags: ['check'],
    cover_image: null,
    source_url: null,
    source_credit: null,
  }

  let link = null

  await check('a link can be made for one event, and opens it', async () => {
    await api('/api/admin/events', { method: 'PUT', body: shared, key })

    const made = await api('/api/admin/shares', {
      method: 'POST',
      body: { slug: shared.slug, days: 3, label: 'the check suite' },
      key,
    })
    assert(made.status === 200, `expected 200, saw ${made.status}: ${made.text}`)
    assert(/^[A-Za-z0-9_-]{30,}$/.test(made.json.share.token), `odd token: ${made.json.share.token}`)
    link = made.json.share.token

    const until = Date.parse(made.json.share.expires_at)
    const days = (until - Date.now()) / 86_400_000
    assert(days > 2.9 && days < 3.1, `three days was asked for, ${days} were given`)

    // A draft, deliberately: the person writing it up works on an event that is
    // not public yet, so a link that only opened published events would be of
    // no use for the job it exists to do.
    const opened = await api('/api/share/event', { share: link })
    assert(opened.status === 200, `expected 200, saw ${opened.status}: ${opened.text}`)
    assert(opened.json.event.slug === shared.slug, `opened ${opened.json.event.slug}`)
    assert(opened.json.event.status === 'draft', 'a draft should open, with its status')
    return `3 days, opening ${shared.slug}`
  })

  await check('a link saves words, and cannot reach another event', async () => {
    const other = await api('/api/admin/events', { key })
    const elsewhere = other.json.events.find((event) => event.slug === 'hackdku2024')
    assert(elsewhere, 'hackdku2024 should be in the seeded library')
    const untouched = elsewhere.title

    // The request names a different event and a different status. A link holder
    // has no way to know the second is refused; the first is not.
    const saved = await api('/api/share/event', {
      method: 'PUT',
      body: { ...shared, slug: 'hackdku2024', title: 'Rewritten', status: 'archived' },
      share: link,
    })
    assert(saved.status === 200, `expected 200, saw ${saved.status}: ${saved.text}`)
    assert(saved.json.event.slug === shared.slug, `it saved ${saved.json.event.slug} instead`)
    assert(saved.json.event.title === 'Rewritten', 'the words did not save')

    const after = await api('/api/admin/events', { key })
    const neighbour = after.json.events.find((event) => event.slug === 'hackdku2024')
    assert(neighbour?.title === untouched, 'a link reached an event it was not made for')

    const mine = after.json.events.find((event) => event.slug === shared.slug)
    assert(mine?.status === 'draft', `a link changed the status to ${mine?.status}`)
    assert(mine?.body.includes('Written by somebody with a link'), 'the write-up did not stick')
    return 'saved its own event, left its status and its neighbours alone'
  })

  await check('a link is worth nothing anywhere else', async () => {
    const library = await api('/api/admin/events', { share: link })
    const write = await api('/api/admin/events', {
      method: 'PUT',
      body: { ...shared, slug: 'sneaking-in-through-a-link' },
      share: link,
    })
    const settings = await api('/api/admin/settings', { method: 'PUT', body: { settings: {} }, share: link })
    const status = await api('/api/admin/events/status', {
      method: 'POST',
      body: { slug: shared.slug, status: 'published' },
      share: link,
    })
    const remove = await api(`/api/admin/events?slug=${shared.slug}`, { method: 'DELETE', share: link })
    // And the panel's own routes are not opened by presenting a link at all.
    for (const [name, answer] of [['the library', library], ['a write', write], ['the settings', settings], ['a status', status], ['a delete', remove]]) {
      assert(answer.status === 403, `${name} answered ${answer.status} to a link`)
      assert(answer.json.error.code === 'KEY_REJECTED', `${name} answered ${answer.json.error.code}`)
    }

    const stillThere = await api('/api/admin/events', { key })
    assert(
      stillThere.json.events.some((event) => event.slug === shared.slug),
      'a link deleted the event it was made for',
    )
    assert(
      !stillThere.json.events.some((event) => event.slug === 'sneaking-in-through-a-link'),
      'a link created an event',
    )
    return 'refused on every panel route'
  })

  await check('a site key is not a link, and a link is not a key', async () => {
    const asLink = await api('/api/share/event', { key })
    const asKey = await api('/api/admin/events', { share: link })
    assert(asLink.status === 403, `the key opened the link route (${asLink.status})`)
    assert(asLink.json.error.code === 'SHARE_REJECTED', `expected SHARE_REJECTED, saw ${asLink.json.error.code}`)
    assert(asKey.status === 403, `the link opened the panel (${asKey.status})`)
    assert(asKey.json.error.code === 'KEY_REJECTED', `expected KEY_REJECTED, saw ${asKey.json.error.code}`)
    return 'each refused by the other door'
  })

  await check('a link can add a photograph', async () => {
    const upload = await api('/api/share/images?name=' + shared.slug, {
      method: 'POST',
      raw: jpeg,
      contentType: 'image/jpeg',
      share: link,
    })
    assert(upload.status === 200, `expected 200, saw ${upload.status}: ${upload.text}`)

    const attached = await api('/api/share/event', {
      method: 'PUT',
      body: { ...shared, cover_image: upload.json.url },
      share: link,
    })
    assert(attached.json.event.cover_image === upload.json.url, 'the cover did not stick')

    const served = await fetch(BASE + upload.json.url)
    assert(served.status === 200, `the photograph is not served (${served.status})`)
    return upload.json.url
  })

  await check("the panel lists a link's expiry and when it was last used", async () => {
    const { status, json } = await api(`/api/admin/shares?slug=${shared.slug}`, { key })
    assert(status === 200, `expected 200, saw ${status}`)
    assert(json.shares.length === 1, `expected one link, saw ${json.shares.length}`)
    assert(json.shares[0].token === link, 'the listed token is not the one that was issued')
    assert(json.shares[0].label === 'the check suite', 'the label did not survive')
    assert(json.shares[0].last_used_at, 'a link that has been used should say when')
    assert(Date.parse(json.shares[0].expires_at) > Date.now(), 'the expiry is in the past')
    return `expires ${json.shares[0].expires_at}, last used ${json.shares[0].last_used_at}`
  })

  await check('a revoked link stops working at once', async () => {
    const gone = await api(`/api/admin/shares?token=${link}`, { method: 'DELETE', key })
    assert(gone.json.ok === true, 'the revoke reported nothing removed')

    const opened = await api('/api/share/event', { share: link })
    assert(opened.status === 403, `a revoked link still opened (${opened.status})`)
    assert(opened.json.error.code === 'SHARE_REJECTED', `expected SHARE_REJECTED, saw ${opened.json.error.code}`)
    assert(opened.json.error.message.includes('no longer good'), `unhelpful message: ${opened.json.error.message}`)

    const listed = await api(`/api/admin/shares?slug=${shared.slug}`, { key })
    assert(listed.json.shares.length === 0, 'a revoked link is still listed')
    return 'refused, and gone from the list'
  })

  await check('an expired link is refused', async () => {
    const made = await api('/api/admin/shares', {
      method: 'POST',
      body: { slug: shared.slug, days: 30 },
      key,
    })
    const stale = made.json.share.token

    const open = await api('/api/share/event', { share: stale })
    assert(open.status === 200, `a fresh link should open (${open.status})`)

    // 30 days is the ceiling the panel offers, so the past is reached by moving
    // the row rather than by waiting for it.
    runWrangler(
      [
        'd1',
        'execute',
        DB,
        '--local',
        '--persist-to',
        PERSIST,
        '--command',
        `update event_tokens set expires_at = '2020-01-01T00:00:00.000Z' where token = '${stale}'`,
      ],
      'backdating a link',
    )

    const after = await api('/api/share/event', { share: stale })
    assert(after.status === 403, `an expired link opened (${after.status})`)
    assert(after.json.error.code === 'SHARE_REJECTED', `expected SHARE_REJECTED, saw ${after.json.error.code}`)

    await api(`/api/admin/shares?token=${stale}`, { method: 'DELETE', key })
    return 'refused once its date had passed'
  })

  await check('making a link needs the key, and an event to point at', async () => {
    const withoutKey = await api('/api/admin/shares', {
      method: 'POST',
      body: { slug: shared.slug, days: 3 },
    })
    const noSuchEvent = await api('/api/admin/shares', {
      method: 'POST',
      body: { slug: 'no-such-event-here', days: 3 },
      key,
    })
    assert(withoutKey.status === 403, `expected 403, saw ${withoutKey.status}`)
    assert(noSuchEvent.status === 404, `expected 404, saw ${noSuchEvent.status}`)
    return 'refused without a key, and refused for an event that does not exist'
  })

  await check('an unknown link is the same answer as a dead one', async () => {
    const invented = await api('/api/share/event', { share: 'A'.repeat(32) })
    const nothing = await api('/api/share/event')
    assert(invented.status === 403 && nothing.status === 403, 'an unknown link was let through')
    assert(
      invented.json.error.message === nothing.json.error.message,
      'a guessable link should be indistinguishable from a missing one',
    )
    await api(`/api/admin/events?slug=${shared.slug}`, { method: 'DELETE', key })
    return 'one answer for all three ways of not having a link'
  })

  /* ---- the version kept from before the last save ------------------------ */

  /*
    One version back, and the reason it exists. Every check below is written
    from the administrator's side of the wall: something was overwritten, and
    the only question worth asking is whether what was there can be had again —
    and whether anyone else can reach it.
  */

  const kept = {
    slug: 'check-suite-kept',
    title: 'The version worth keeping',
    summary: 'Written before anybody else touched it.',
    body: '# The original\n\nThe paragraph somebody deleted.',
    category: 'Workshop',
    event_date: '2026-07-07',
    location: 'DKU',
    role: 'host',
    status: 'published',
    featured: false,
    gallery: [],
    tags: ['check'],
    cover_image: null,
    source_url: null,
    source_credit: null,
  }

  let keptLink = null

  await check('a brand-new event has nothing kept behind it', async () => {
    await api('/api/admin/events', { method: 'PUT', body: kept, key })
    const { status, json } = await api(`/api/admin/events/revision?slug=${kept.slug}`, { key })
    assert(status === 200, `expected 200, saw ${status}`)
    // Nothing, rather than an error: an event nobody has overwritten yet is the
    // ordinary case, and the panel shows no card for it.
    assert(json.revision === null, `expected nothing kept, saw ${JSON.stringify(json.revision)}`)
    return 'nothing, and that is the answer rather than a failure'
  })

  await check('an overwrite keeps the version it replaced', async () => {
    await api('/api/admin/events', {
      method: 'PUT',
      body: { ...kept, body: '# The original\n\nSomebody rewrote the lot.' },
      key,
    })
    const { json } = await api(`/api/admin/events/revision?slug=${kept.slug}`, { key })
    assert(json.revision, 'nothing was kept')
    assert(
      json.revision.body.includes('The paragraph somebody deleted'),
      'what was kept is not what was replaced',
    )
    assert(json.revision.title === kept.title, 'the kept title is wrong')
    assert(json.revision.via === 'panel', `a panel save was recorded as ${json.revision.via}`)
    assert(json.revision.saved_at, 'a kept version should say when it stopped being current')
    assert(
      Array.isArray(json.revision.gallery) && Array.isArray(json.revision.tags),
      'the lists did not come back as lists',
    )
    return `kept, marked ${json.revision.via}, saved ${json.revision.saved_at}`
  })

  await check('saving the same words again does not displace what is kept', async () => {
    const before = (await api(`/api/admin/events/revision?slug=${kept.slug}`, { key })).json.revision
    const unchanged = { ...kept, body: '# The original\n\nSomebody rewrote the lot.' }
    await api('/api/admin/events', { method: 'PUT', body: unchanged, key })
    const after = (await api(`/api/admin/events/revision?slug=${kept.slug}`, { key })).json.revision
    assert(
      after.saved_at === before.saved_at,
      'a save that changed nothing replaced the kept version with a copy of the current one',
    )
    return 'the kept version survived a save that changed nothing'
  })

  await check('putting the kept version back restores the words', async () => {
    const back = await api('/api/admin/events/revision', {
      method: 'POST',
      body: { slug: kept.slug },
      key,
    })
    assert(back.status === 200, `expected 200, saw ${back.status}: ${back.text}`)
    assert(
      back.json.event.body.includes('The paragraph somebody deleted'),
      'the words did not come back',
    )

    const now = await api(`/api/admin/events/revision?slug=${kept.slug}`, { key })
    assert(now.json.revision, 'the displaced version should have been kept in its place')
    assert(
      now.json.revision.body.includes('Somebody rewrote the lot'),
      'the wrong version was kept by the restore',
    )
    assert(now.json.revision.via === 'restore', `the swap was recorded as ${now.json.revision.via}`)
    return 'the words are back, and what they replaced is now the kept version'
  })

  await check('a restore leaves the publishing state where it was', async () => {
    // Taken off the public site first, so that a restore has something to get
    // wrong. Putting the words back is not a reason for an event to move.
    await api('/api/admin/events/status', {
      method: 'POST',
      body: { slug: kept.slug, status: 'draft' },
      key,
    })
    const back = await api('/api/admin/events/revision', {
      method: 'POST',
      body: { slug: kept.slug },
      key,
    })
    assert(
      back.json.event.status === 'draft',
      `a restore changed the status to ${back.json.event.status}`,
    )
    const publicList = await api('/api/events')
    assert(
      !publicList.json.events.some((event) => event.slug === kept.slug),
      'a restore put a draft back on the public site',
    )
    return 'still a draft, and still off the public list'
  })

  await check('restoring twice lands back where the first one started', async () => {
    await api('/api/admin/events/revision', { method: 'POST', body: { slug: kept.slug }, key })
    const admins = await api('/api/admin/events', { key })
    const row = admins.json.events.find((event) => event.slug === kept.slug)
    assert(
      row?.body.includes('The paragraph somebody deleted'),
      `the second restore landed on: ${row?.body}`,
    )
    return 'so a restore is itself restorable'
  })

  await check('a link keeps what it overwrites, and says it was a link', async () => {
    const made = await api('/api/admin/shares', {
      method: 'POST',
      body: { slug: kept.slug, days: 3 },
      key,
    })
    keptLink = made.json.share.token

    const saved = await api('/api/share/event', {
      method: 'PUT',
      body: { ...kept, body: '# Rewritten by somebody holding a link' },
      share: keptLink,
    })
    assert(saved.status === 200, `expected 200, saw ${saved.status}: ${saved.text}`)

    const { json } = await api(`/api/admin/events/revision?slug=${kept.slug}`, { key })
    assert(
      json.revision.body.includes('The paragraph somebody deleted'),
      'a link did not keep what it replaced',
    )
    assert(json.revision.via === 'link', `a save through a link was recorded as ${json.revision.via}`)
    return 'kept, and marked as having come through a link'
  })

  await check('a link can neither read nor put back a kept version', async () => {
    const read = await api(`/api/admin/events/revision?slug=${kept.slug}`, { share: keptLink })
    const put = await api('/api/admin/events/revision', {
      method: 'POST',
      body: { slug: kept.slug },
      share: keptLink,
    })
    for (const [name, answer] of [['reading it', read], ['putting it back', put]]) {
      assert(answer.status === 403, `${name} answered ${answer.status} to a link`)
      assert(answer.json.error.code === 'KEY_REJECTED', `${name} answered ${answer.json.error.code}`)
    }
    const still = await api('/api/admin/events/revision?slug=' + kept.slug, { key })
    assert(
      still.json.revision.body.includes('The paragraph somebody deleted'),
      'a link reached behind the event anyway',
    )
    return 'refused at both, and the kept version is untouched'
  })

  await check('reading a kept version needs the key', async () => {
    const withoutKey = await api(`/api/admin/events/revision?slug=${kept.slug}`)
    assert(withoutKey.status === 403, `expected 403, saw ${withoutKey.status}`)
    assert(
      withoutKey.json.error.code === 'KEY_REJECTED',
      `expected KEY_REJECTED, saw ${withoutKey.json.error.code}`,
    )
    return 'refused'
  })

  await check('restoring an event with nothing kept says so', async () => {
    const fresh = { ...kept, slug: 'check-suite-nothing-kept' }
    await api('/api/admin/events', { method: 'PUT', body: fresh, key })
    const { status, json } = await api('/api/admin/events/revision', {
      method: 'POST',
      body: { slug: fresh.slug },
      key,
    })
    assert(status === 404, `expected 404, saw ${status}`)
    assert(/no earlier version/.test(json.error.message), `unexpected message: ${json.error.message}`)
    await api(`/api/admin/events?slug=${fresh.slug}`, { method: 'DELETE', key })
    return 'refused, with a reason'
  })

  await check('deleting an event takes its kept version with it', async () => {
    await api(`/api/admin/events?slug=${kept.slug}`, { method: 'DELETE', key })
    await api(`/api/admin/shares?token=${keptLink}`, { method: 'DELETE', key })

    // The slug is put back to ask the question: a version left behind by the
    // delete would be found under the same name, describing an event it was
    // never a version of.
    await api('/api/admin/events', { method: 'PUT', body: kept, key })
    const { json } = await api(`/api/admin/events/revision?slug=${kept.slug}`, { key })
    assert(json.revision === null, 'a deleted event left its kept version behind')
    await api(`/api/admin/events?slug=${kept.slug}`, { method: 'DELETE', key })
    return 'gone with the record'
  })

  /* ---- the key itself ---------------------------------------------------- */

  await check('the key can be replaced, and the old one stops working', async () => {
    const next = 'a-replacement-key-for-the-checks-0001'
    const replaced = await api('/api/admin/key', {
      method: 'POST',
      body: { current: key, next },
      key,
    })
    assert(replaced.status === 200, `expected 200, saw ${replaced.status}: ${replaced.text}`)

    const withOld = await api('/api/admin/events', { key })
    assert(withOld.status === 403, `the old key still works (${withOld.status})`)
    const withNew = await api('/api/admin/events', { key: next })
    assert(withNew.status === 200, `the new key does not work (${withNew.status})`)

    const restored = await api('/api/admin/key', {
      method: 'POST',
      body: { current: next, next: key },
      key: next,
    })
    assert(restored.status === 200, 'could not put the original key back')
    const backAgain = await api('/api/admin/events', { key })
    assert(backAgain.status === 200, 'the original key was not restored')
    return 'old refused, new accepted, original restored'
  })

  await check('replacing the key needs the current one', async () => {
    const { status, json } = await api('/api/admin/key', {
      method: 'POST',
      body: { current: otherKey, next: 'another-replacement-key-long-enough' },
      key,
    })
    assert(status === 403, `expected 403, saw ${status}`)
    assert(json.error.code === 'KEY_REJECTED', `expected KEY_REJECTED, saw ${json.error.code}`)
    return 'refused'
  })

  await check('a short replacement key is refused', async () => {
    const { status } = await api('/api/admin/key', {
      method: 'POST',
      body: { current: key, next: 'too-short' },
      key,
    })
    assert(status === 400, `expected 400, saw ${status}`)
    return 'refused'
  })

  /* ---- the site itself --------------------------------------------------- */

  await check('the built site is served from the same origin', async () => {
    const page = await fetch(BASE + '/')
    const html = await page.text()
    assert(page.status === 200, `expected 200, saw ${page.status}`)
    assert(/<div id="root">/.test(html), 'the entry page does not look like the built site')
    return `${html.length} bytes of HTML`
  })

  await check('an unknown API path answers 404 rather than the site', async () => {
    const { status, json } = await api('/api/admin/nonsense', { key })
    assert(status === 404, `expected 404, saw ${status}`)
    assert(json.error.code === 'NOT_FOUND', `expected NOT_FOUND, saw ${json.error.code}`)
    return '404'
  })

  await check('a photograph that is not there answers 404', async () => {
    const response = await fetch(`${BASE}/media/events/2026-09/nothing-here.jpg`)
    assert(response.status === 404, `expected 404, saw ${response.status}`)
    return '404'
  })
} finally {
  await stopServer()
}

console.log('')
if (failures.length) {
  console.log(`  ${passed} passed, ${failures.length} failed`)
  for (const failure of failures) console.log(`    ${failure}`)
  process.exit(1)
}
console.log(`  ${passed} checks passed`)
