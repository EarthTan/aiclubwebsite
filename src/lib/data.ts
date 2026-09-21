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
  // Empty on purpose: which events lead the home page is a decision for the
  // club, made in the panel, not something the code should guess at.
  home_slugs: [],
  about_title: 'Who are we?',
  about_lead:
    'At DKU, the AI Club turns curiosity about artificial intelligence into workshops, talks, hackathons and industry visits. Everything we run is student-led and open to every major, with no prior experience expected.',
  about_body:
    'At DKU, our artificial intelligence club is more than a study group. We bring together students from computer science, finance, biology, design and the social sciences to work on the questions that AI raises in practice: how models are built, how they are evaluated, and what happens when they meet real users.\n\nOur programme runs across a full academic year — hands-on workshops, guest talks with researchers and practitioners, cross-disciplinary competitions, and field trips to the companies building the technology. Everything we run is student-led, and everything we run is open to members with no prior background.',
  history_title: 'Our history',
  history_lead:
    'The DKU AI Club began in the autumn of 2024, with a proposal written by ten students on the argument that artificial intelligence should not belong to a single major. What follows is how that proposal became a club, and what it ran in its first semester.',
  // Each phase carries Markdown: a long one runs to several paragraphs, and the
  // rolls of names live inside the prose rather than in a list beside it.
  history: [
    {
      period: 'August 2024',
      title: 'Before there was a club',
      body: `On 26 August 2024, Jiahe (Jay) Chen wrote to Prof. Luyao Zhang to ask whether she would act as the club's faculty advisor. The message described the club as something being started rather than something that already existed — a group that would run applied sessions on artificial intelligence, beginning with prompt engineering and a few tools worth knowing about. Prof. Zhang agreed the same morning, and named the step that came next: a formal application to the university's student organization office.

The proposal that followed set the terms the club still works on. It argued that AI is reshaping how people work while remaining, for most students, something that appears to belong to computer science — and that this was precisely the reason to build a club for the general student body rather than for one department. Membership was deliberately not restricted by major or by prior experience, and three commitments were written down: making AI legible to students in every discipline, giving members the support to turn AI-related ideas into working projects, and connecting them with people already working in the field.

One detail in that document is worth keeping. Its hackathon was specified as a competition in which AI is **required** rather than banned, so that participants would practise directing a model to write code, on the reasoning that the ability to solve a problem matters more than fluency in a programming language. The students who signed the proposal were Jiahe Chen, Yuhan Wei, Ruisheng Sun, Qianhui Huang, Junyan Li, Rime Tessa, Jingfeng Chen, Zihan Chen, Jiesen Huang and Shengyang Wang. Its first officers were Jiahe Chen as President, Ruisheng Sun as Secretary, Yuhan Wei as Treasurer and Qianhui Huang as Social Media Director.`,
    },
    {
      period: 'December 2024',
      title: 'The first board meeting',
      body: `On 29 December 2024 the club held its first board meeting. The deck it opened with was plain about what the club was: a student club, student-centred, technical and applied, drawing on academic and non-academic backgrounds alike. Underneath sat a three-tier structure that has lasted — officers who make decisions, active members who carry them out, and the wider DKU community the club exists to serve.

The officer list had already changed in the months since the proposal. Haoxin Feng had joined Ruisheng Sun as Vice President and taken responsibility for media; Ruisheng Sun had added the secretary's role; Yuhan Wei had become a project leader; and Prof. Luyao Zhang was confirmed as advisor. The meeting then set out the semester ahead, which the deck itself labelled the club's third session: a club expo built around playful demonstrations, a kickoff that would introduce AI through a product rather than a lecture, a fintech forum run with the Finance Club, workshops in prompt engineering and video generation, and a tour of a local technology company. Four further ideas were listed for the sessions after that — AI in high school, in the humanities and in art — each of which would need a partner outside the club. The last slide read: **Dream Big**.`,
    },
    {
      period: 'January – May 2025',
      title: 'The first semester',
      body: `Club Expo on 10 January 2025 was the first time the club appeared in public, and it was built for people walking past rather than for a seated audience: cartoon portraits generated from photographs of passers-by, video generated the same way, and a description of the club short enough to read while standing — who we are, what we are trying to do, what we run, and why to join. Recruitment for the core team opened at the same table.

Ten sessions followed before the semester ended: a kickoff, then workshops in AI writing, AI in film and diffusion models; a fintech forum with the Finance Club; a computer-science information session for students choosing a major; sessions on AI policy and on technology in finance; and HackDKU, which the club helped run in April.

Three words were put on a slide at the end of the term to describe what the year had been about — innovation, interdisciplinary, international. They were the same three ideas the founding proposal had argued for, and they became the club's stated values.

By the end of that first semester the board had grown to seven students and an advisor. Jiahe (Jay) Chen was President; Ruisheng Sun was Vice President and Program Manager; Zihan Chen and Xiaomu Hong were Program Managers; Ximin Yu was Director of Communications; Ke Ning was Director of Operations; Qianhui Huang was Treasurer; and Prof. Luyao Zhang was Faculty Advisor. Six student leaders sat on an advisory board alongside them: Kaiqi Wu ('24), an AI film specialist; Ruikang Wang ('26), SLB co-chair; Beilong Tang ('25), an AI researcher; Yuanjun Du ('27), President of the Finance Club; Guangzhi Su ('26), President of the CS Club; and Haoxin Feng ('26), an emeritus board member. Beneath the board, eight officers ran communications and operations — Andi Wan, Ruoying Wang, Yu Sun, Jiesen Huang and Chen Chen in communications, Siqi Rui, Luyao Xu and Fengyu Zou in operations — together with seventeen active members: Runqi Li, Dilnoza Tirkashova, Tony Li, Weijia Han, Tianyi Xie, Zhongyan Li, Rabin Mahatara, Leyan Zhang, Haoxuan Zhang, Runtian Shi, Yuelin Hou, Zichun Guo, Chi Zhang, Yifan Wu, Ruitian Shi, Kundi Wang and Eunice Gu.

The term closed with a formal note of thanks to Haoxin Feng, who had served as Vice President and Director of Communications, designed the club's logo, and founded the club's media team.

One thing came out of that semester that the club had not planned for. YAS — the Youth AI Society — began inside the club as an education-technology initiative and was accepted into the university's innovation incubator (Dii). Its programme was still undecided when the term ended: a website, a budget and a first cohort of students were on the list, along with whatever the membership brought to the next meeting.`,
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

/**
 * The stored copy, narrowed to the fields the site still has.
 *
 * The row is one JSON document rather than one column per field, so a field
 * that has since been retired would otherwise be merged back in and written out
 * again on the next save — outliving the code that understood it. Only known
 * keys cross this line, which is also what retires them for good.
 */
function asSettings(stored: unknown): SiteSettings {
  const source = (stored ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (source[key] !== undefined) merged[key] = source[key]
  }
  // An ordered list is the one shape worth insisting on: anything else would
  // reach the home page and be walked as a sequence.
  if (!Array.isArray(merged.home_slugs)) merged.home_slugs = []
  return merged as unknown as SiteSettings
}

export async function fetchSettings(): Promise<SiteSettings> {
  try {
    return asSettings(await fetchSettingsValue())
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
