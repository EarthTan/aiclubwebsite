import {
  ApiError,
  KEY_REJECTED,
  fetchEveryEvent,
  fetchPublishedEvents,
  fetchSettingsValue,
  putEvent,
  putEventStatus,
  putKey,
  putSettings,
  removeEvent,
  uploadImage,
  verifyKey,
} from './api'
import { fileToOptimisedImage } from './image'
import { readSiteKey, rememberSiteKey } from './siteKey'
import { deriveSummary } from './format'
import type { ArchivedEvent, EventRecord, SiteSettings } from './types'

export const FALLBACK_CATEGORIES = [
  'Workshop',
  'Talk',
  'Info Session',
  'Hackathon',
  'Field Trip',
  'Ceremony',
  'Social',
  'Event',
]

export const DEFAULT_SETTINGS: SiteSettings = {
  club_name: 'DKU AI Club',
  tagline: 'Artificial intelligence, built by students',
  hero_kicker: 'Duke Kunshan University · Student organization',
  hero_title: 'Learning AI by building it, together',
  hero_subtitle:
    'The DKU AI Club is a student community that turns curiosity about artificial intelligence into workshops, talks, hackathons and industry visits — open to every major and every level of experience.',
  hero_image: null,
  about_title: 'Who are we?',
  about_lead:
    'At DKU, the AI Club turns curiosity about artificial intelligence into workshops, talks, hackathons and industry visits. Everything we run is student-led and open to every major, with no prior experience expected.',
  about_body:
    'At DKU, our artificial intelligence club is more than a study group. We bring together students from computer science, finance, biology, design and the social sciences to work on the questions that AI raises in practice: how models are built, how they are evaluated, and what happens when they meet real users.\n\nOur programme runs across a full academic year — hands-on workshops, guest talks with researchers and practitioners, cross-disciplinary competitions, and field trips to the companies building the technology. Everything we run is student-led, and everything we run is open to members with no prior background.',
  history: [
    {
      period: '2025 – 2026',
      title: 'A first full year of programming',
      body: 'The club established a regular rhythm of workshops, information sessions and industry nights, and worked alongside partner organizations on the Digital Innovation Challenge, HackDKU and the DKU iGEM team.',
    },
    {
      period: '2026 Fall',
      title: 'Beyond ChatGPT',
      body: 'Our flagship session of the new semester brought the club together with the DKU iGEM 2026 team to trace how artificial intelligence moved from a research idea to a tool students use every day.',
    },
  ],
  contact_email: 'dkuaiclub@outlook.com',
  contact_note:
    'We welcome students from every major. Workshops are announced through the club mailing list, and no previous experience with machine learning is expected.',
  links: [
    { label: 'Duke Kunshan University', url: 'https://dukekunshan.edu.cn/' },
    { label: 'DKU Computer Science Club', url: 'https://www.dkucs.com/' },
  ],
  categories: FALLBACK_CATEGORIES,
}

/**
 * Postgres hands back a `date` column either as `2026-05-05` or, through some
 * drivers, as a timestamp that is midnight in the server's timezone. Reading
 * the first ten characters of the latter can land on the previous day, so a
 * Date is converted deliberately rather than stringified.
 */
function asDate(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  return String(value).slice(0, 10)
}

function toEvent(row: Record<string, unknown>): EventRecord {
  return {
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    summary: String(row.summary ?? ''),
    body: String(row.body ?? ''),
    category: String(row.category ?? 'Event'),
    event_date: asDate(row.event_date),
    location: (row.location as string | null) ?? null,
    cover_image: (row.cover_image as string | null) ?? null,
    gallery: Array.isArray(row.gallery) ? (row.gallery as string[]) : [],
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    role: (row.role as EventRecord['role']) ?? 'host',
    status: (row.status as EventRecord['status']) ?? 'published',
    featured: Boolean(row.featured),
    source_url: (row.source_url as string | null) ?? null,
    source_credit: (row.source_credit as string | null) ?? null,
    origin: 'database',
    id: typeof row.id === 'number' ? row.id : undefined,
    updated_at: (row.updated_at as string | null) ?? null,
  }
}

let archiveCache: EventRecord[] | null = null

/**
 * The event archive shipped inside the site bundle (`public/content/events.json`).
 *
 * It has two jobs, and neither is to be a second source of truth: it seeds an
 * empty database through `importArchive()`, and it keeps the public pages
 * readable if the database cannot be reached. Ordinary reads never touch it.
 */
export async function loadArchive(): Promise<EventRecord[]> {
  if (archiveCache) return archiveCache
  try {
    const res = await fetch('./content/events.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const rows = (await res.json()) as ArchivedEvent[]
    archiveCache = rows.map((a) => ({
      ...a,
      gallery: a.gallery ?? [],
      tags: a.tags ?? [],
      origin: 'archive' as const,
    }))
  } catch {
    archiveCache = []
  }
  return archiveCache
}

/**
 * Every event row the caller is allowed to see. Visitors get published rows
 * only; drafts and archived records are not sent to them at all.
 */
export async function fetchDatabaseEvents(): Promise<EventRecord[]> {
  const rows = await fetchPublishedEvents()
  return rows.map((row) => toEvent(row))
}

const newestFirst = (a: EventRecord, b: EventRecord) => (a.event_date < b.event_date ? 1 : -1)

/**
 * The published event library, as the public pages see it.
 *
 * The database is the source of truth. The shipped archive is only consulted
 * when the database holds no events at all — a freshly created environment,
 * before an administrator has run the one-time import. Visitors then see the
 * club's history rather than an empty page, and the administrator keeps the
 * prompt that puts those records into the library for good. As soon as one row
 * exists, the archive drops out of the read path entirely.
 */
export async function fetchPublicEvents(): Promise<EventRecord[]> {
  const rows = await fetchDatabaseEvents()
  if (rows.length > 0) {
    return rows.filter((e) => e.status === 'published').sort(newestFirst)
  }
  const archive = await loadArchive()
  return archive.filter((e) => e.status === 'published').sort(newestFirst)
}

/**
 * The whole library, drafts and archived records included.
 *
 * Drafts and archived records are not the public's to see, so this read is
 * asked for through the same key every write uses, and the server decides what
 * to answer.
 */
export async function fetchAllEvents(): Promise<EventRecord[]> {
  const rows = await guarded(fetchEveryEvent)
  return rows.map((row) => toEvent(row)).sort(newestFirst)
}

/**
 * Copies any archive event the database does not already hold.
 *
 * This is how a new environment is seeded: the site ships with the club's
 * history, and an administrator promotes it into the library once. Slugs that
 * are already present are left untouched, so running it again is harmless and
 * never overwrites an edited write-up. Returns how many records were added.
 */
export async function importArchive(): Promise<number> {
  // Deliberately the whole library rather than the public view: an event that was
  // archived or drafted is still present, and must not be mistaken for one that
  // has never been imported.
  const [archive, existing] = await Promise.all([loadArchive(), fetchAllEvents()])
  const present = new Set(existing.map((e) => e.slug))
  const missing = archive.filter((e) => !present.has(e.slug))
  for (const event of missing) {
    await saveEvent({
      slug: event.slug,
      title: event.title,
      summary: event.summary,
      body: event.body,
      category: event.category,
      event_date: event.event_date,
      location: event.location ?? null,
      cover_image: event.cover_image ?? null,
      gallery: event.gallery,
      tags: event.tags,
      role: event.role,
      status: event.status,
      featured: event.featured,
      source_url: event.source_url ?? null,
      source_credit: event.source_credit ?? null,
    })
  }
  return missing.length
}

export interface EventDraft {
  slug: string
  title: string
  summary: string
  body: string
  category: string
  event_date: string
  location: string | null
  cover_image: string | null
  gallery: string[]
  tags: string[]
  role: EventRecord['role']
  status: EventRecord['status']
  featured: boolean
  source_url: string | null
  source_credit: string | null
}

/** Creates or overwrites an event row. Keyed on `slug`. */
export async function saveEvent(draft: EventDraft): Promise<EventRecord[]> {
  const payload = {
    slug: draft.slug,
    title: draft.title,
    summary: draft.summary || deriveSummary(draft.body),
    body: draft.body,
    category: draft.category,
    event_date: draft.event_date,
    location: draft.location,
    cover_image: draft.cover_image,
    gallery: draft.gallery,
    tags: draft.tags,
    role: draft.role,
    status: draft.status,
    featured: draft.featured,
    source_url: draft.source_url,
    source_credit: draft.source_credit,
  }
  const saved = await guarded(() => putEvent(payload))
  return [toEvent(saved)]
}

/** Hides an event from the public site without destroying the record. */
export async function archiveEvent(slug: string): Promise<void> {
  await setStatus(slug, 'archived')
}

/** Puts an archived or draft event back on the public site. */
export async function restoreEvent(slug: string): Promise<void> {
  await setStatus(slug, 'published')
}

async function setStatus(slug: string, status: EventRecord['status']): Promise<void> {
  if (!(await guarded(() => putEventStatus(slug, status)))) {
    throw new Error('That event is no longer in the library. Reload the page and try again.')
  }
}

/** Removes an event from the library for good. */
export async function deleteEvent(slug: string): Promise<number> {
  if (!(await guarded(() => removeEvent(slug)))) {
    throw new Error('That event is no longer in the library. Reload the page and try again.')
  }
  return 1
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export async function fetchSettings(): Promise<SiteSettings> {
  try {
    const value = (await fetchSettingsValue()) as Partial<SiteSettings> | null
    if (!value) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...value }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(settings: SiteSettings): Promise<void> {
  if (!(await guarded(() => putSettings({ ...settings })))) {
    throw new Error('The change was rejected. Reload the page and try again.')
  }
}

/* -------------------------------------------------------------------------- */
/* Photographs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Shrinks a chosen photograph and stores it, answering with the URL to refer to
 * it by.
 *
 * The shrink happens on the machine that already has the file open, and the
 * bytes are stored outside the database, so an event's row stays a row rather
 * than growing into a photo album.
 */
export async function storeImage(file: File, name: string, maxEdge = 1400): Promise<string> {
  const blob = await fileToOptimisedImage(file, maxEdge)
  return guarded(() => uploadImage(blob, name))
}

/* -------------------------------------------------------------------------- */
/* The key that opens the panel                                               */
/* -------------------------------------------------------------------------- */

export interface AdminState {
  /** True when this browser is holding a key at all. */
  hasKey: boolean
  /** True when the database accepted that key. */
  isAdmin: boolean
}

/**
 * Turns a refusal from the server into the sentence the panel shows.
 *
 * A key that was replaced on another machine and a key that was never right
 * look identical from here, and are worth the same sentence.
 */
function writeError(err: unknown): Error {
  if (err instanceof ApiError && err.code === KEY_REJECTED) {
    return new Error('The site key was not accepted. It may have been replaced.')
  }
  return err instanceof Error ? err : new Error('That change was not accepted.')
}

/** Runs a call and reports any refusal in the panel's own words. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw writeError(err)
  }
}

/**
 * Whether the panel should open, asked of the server rather than decided here.
 *
 * A key that is present but no longer valid is reported as such instead of being
 * forgotten, so that a key replaced on another machine produces a sentence rather
 * than a silent return to the key prompt.
 */
export async function readAdminState(): Promise<AdminState> {
  const key = readSiteKey()
  if (!key) return { hasKey: false, isAdmin: false }
  try {
    return { hasKey: true, isAdmin: await verifyKey(key) }
  } catch {
    return { hasKey: true, isAdmin: false }
  }
}

/**
 * Checks a key against the server and, if it is accepted, keeps it.
 *
 * The key is never validated in the browser. This page is public, so a check
 * that could be performed here would be a check anyone could read the answer to.
 */
export async function openWithSiteKey(key: string): Promise<void> {
  const candidate = key.trim()
  if (!(await verifyKey(candidate))) throw new Error('That key was not accepted.')
  rememberSiteKey(candidate)
}

/** Forgets the key on this browser. The key itself is unaffected. */
export function forgetSiteKey(): void {
  rememberSiteKey(null)
}

/**
 * Replaces the key everywhere, for the whole site.
 *
 * The current key is required, so an abandoned browser is not by itself enough to
 * lock the club out of its own site.
 */
export async function replaceSiteKey(current: string, next: string): Promise<void> {
  const replacement = next.trim()
  if (replacement.length < 24) {
    throw new Error('A site key needs at least 24 characters.')
  }
  if (!(await guarded(() => putKey(current, replacement)))) {
    throw new Error('The key was not replaced. Reload the page and try again.')
  }
  rememberSiteKey(replacement)
}
