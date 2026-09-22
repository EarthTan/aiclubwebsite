/**
 * The site's own API, which is the same origin as the site itself.
 *
 * Everything the pages need from a server goes through here. Reads of published
 * content are open; a call that is passed `true` for `withKey` carries the
 * panel's key in a header and is refused without it, and one that is passed a
 * shared editing link carries that instead. Those two are the whole of the
 * site's access control — there is no account and no session.
 *
 * A refusal arrives as `ApiError` carrying the code the server used, whichever
 * endpoint produced it, so a page has one sentence to show rather than one per
 * call: `KEY_REJECTED` when the panel's key is wrong or missing, and
 * `SHARE_REJECTED` when an editing link is unknown, expired or taken back.
 */

import { readSiteKey } from './siteKey'

/** One row of the event library, as the server sends it. */
export type EventRow = Record<string, unknown>

/** One shared editing link, as the panel sees it. */
export interface ShareLinkRow {
  token: string
  slug: string
  /** Who it was made for. The administrator's own note, never shown to the holder. */
  label: string
  created_at: string | null
  expires_at: string
  last_used_at: string | null
}

/**
 * The version of an event that was there before its last save.
 *
 * Content only — the fields that say where an event appears are not part of it,
 * because putting the words back is not supposed to move the event.
 */
export interface RevisionRow {
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
  role: string
  source_url: string | null
  source_credit: string | null
  /** When this version stopped being the current one. */
  saved_at: string
  /** What displaced it: `panel`, `link`, or `restore`. */
  via: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** The key was not accepted, or none was held. */
export const KEY_REJECTED = 'KEY_REJECTED'

/** The editing link was not accepted: never issued, taken back, or past its date. */
export const SHARE_REJECTED = 'SHARE_REJECTED'

/**
 * What a call is asked to prove it may do.
 *
 * `true` means the panel's key, `false` means nothing, and a link means that
 * one event. Named rather than passed as a header string so that a page cannot
 * accidentally put a link where a key was meant, or the other way round.
 */
type Credential = boolean | { share: string }

async function call<T>(path: string, init: RequestInit = {}, credential: Credential = false): Promise<T> {
  const headers = new Headers(init.headers)
  if (credential === true) {
    const key = readSiteKey()
    if (!key) throw new Error('This browser is no longer holding the site key.')
    headers.set('x-site-key', key)
  } else if (credential) {
    headers.set('x-event-token', credential.share)
  }

  const response = await fetch(path, { ...init, headers })
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string; code?: string }
  } | null

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.message ?? `The server answered ${response.status}.`,
      payload?.error?.code ?? `HTTP_${response.status}`,
    )
  }
  return payload as T
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** The published library, as any visitor sees it. */
export async function fetchPublishedEvents(): Promise<EventRow[]> {
  return (await call<{ events: EventRow[] }>('/api/events')).events
}

/** The whole library, drafts and archived records included. */
export async function fetchEveryEvent(): Promise<EventRow[]> {
  return (await call<{ events: EventRow[] }>('/api/admin/events', {}, true)).events
}

/** The site copy, or nothing when it has never been edited. */
export async function fetchSettingsValue(): Promise<EventRow | null> {
  return (await call<{ settings: EventRow | null }>('/api/settings')).settings
}

/** Whether the supplied key is the site's key. Never decided in the browser. */
export async function verifyKey(candidate: string): Promise<boolean> {
  const answer = await call<{ ok: boolean }>(
    '/api/admin/verify',
    json('POST', { key: candidate }),
  )
  return answer.ok === true
}

/** Creates or overwrites one event, keyed on `slug`. Returns the stored row. */
export async function putEvent(event: EventRow): Promise<EventRow> {
  return (await call<{ event: EventRow }>('/api/admin/events', json('PUT', event), true)).event
}

/** Publishes, drafts or archives one event. False when there is no such event. */
export async function putEventStatus(slug: string, status: string): Promise<boolean> {
  const answer = await call<{ ok: boolean }>(
    '/api/admin/events/status',
    json('POST', { slug, status }),
    true,
  )
  return answer.ok === true
}

/** Removes one event for good. False when there was nothing to remove. */
export async function removeEvent(slug: string): Promise<boolean> {
  const answer = await call<{ ok: boolean }>(
    `/api/admin/events?slug=${encodeURIComponent(slug)}`,
    { method: 'DELETE' },
    true,
  )
  return answer.ok === true
}

/** Replaces the site copy as a whole. */
export async function putSettings(settings: EventRow): Promise<boolean> {
  const answer = await call<{ ok: boolean }>(
    '/api/admin/settings',
    json('PUT', { settings }),
    true,
  )
  return answer.ok === true
}

/** Replaces the panel key; the current key has to be supplied. */
export async function putKey(current: string, next: string): Promise<boolean> {
  const answer = await call<{ ok: boolean }>('/api/admin/key', json('POST', { current, next }), true)
  return answer.ok === true
}

/* -------------------------------------------------------------------------- */
/* Shared editing links                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Issues a link for one event. The event has to have been saved already.
 *
 * The token is handed back so the panel can build the URL a person will paste
 * into a chat message. Nothing about that URL is decided here — the panel knows
 * its own origin, and the server does not need to.
 */
export async function createEventShare(
  slug: string,
  days: number,
  label: string,
): Promise<ShareLinkRow> {
  const answer = await call<{ share: ShareLinkRow }>(
    '/api/admin/shares',
    json('POST', { slug, days, label }),
    true,
  )
  return answer.share
}

/** The links standing open for one event, newest first. */
export async function fetchEventShares(slug: string): Promise<ShareLinkRow[]> {
  const answer = await call<{ shares: ShareLinkRow[] }>(
    `/api/admin/shares?slug=${encodeURIComponent(slug)}`,
    {},
    true,
  )
  return answer.shares ?? []
}

/** Takes a link back for good. */
export async function revokeEventShare(token: string): Promise<boolean> {
  const answer = await call<{ ok: boolean }>(
    `/api/admin/shares?token=${encodeURIComponent(token)}`,
    { method: 'DELETE' },
    true,
  )
  return answer.ok === true
}

/* -------------------------------------------------------------------------- */
/* The version kept from before the last save                                 */
/* -------------------------------------------------------------------------- */

/**
 * The version an event held before its last save, or nothing.
 *
 * `null` is the ordinary answer for an event that has only been saved once, and
 * is not a failure: there is simply nothing behind it yet.
 */
export async function fetchEventRevision(slug: string): Promise<RevisionRow | null> {
  const answer = await call<{ revision: RevisionRow | null }>(
    `/api/admin/events/revision?slug=${encodeURIComponent(slug)}`,
    {},
    true,
  )
  return answer.revision
}

/** Puts the kept version back, and answers with the event as it now stands. */
export async function restoreEventRevision(slug: string): Promise<EventRow> {
  const answer = await call<{ event: EventRow }>(
    '/api/admin/events/revision',
    json('POST', { slug }),
    true,
  )
  return answer.event
}

/* -------------------------------------------------------------------------- */
/* What one of those links reaches                                            */
/* -------------------------------------------------------------------------- */

/** The single event a link is for, whatever its status. */
export async function fetchSharedEvent(token: string): Promise<EventRow> {
  const answer = await call<{ event: EventRow }>('/api/share/event', {}, { share: token })
  return answer.event
}

/** Saves the single event a link is for. The event and its status are not the link's to change. */
export async function putSharedEvent(token: string, event: EventRow): Promise<EventRow> {
  const answer = await call<{ event: EventRow }>(
    '/api/share/event',
    json('PUT', event),
    { share: token },
  )
  return answer.event
}

/**
 * Stores one photograph and answers with the URL that serves it.
 *
 * The bytes go to object storage and only the URL is written into the event, so
 * a page of pictures is not carried inside the database.
 */
async function uploadPhoto(path: string, blob: Blob, name: string, credential: Credential) {
  const query = name ? `?name=${encodeURIComponent(name)}` : ''
  const answer = await call<{ url: string }>(
    `${path}${query}`,
    {
      method: 'POST',
      headers: { 'content-type': blob.type || 'image/jpeg' },
      body: blob,
    },
    credential,
  )
  return answer.url
}

/** Stores one photograph through the panel's door. */
export async function uploadImage(blob: Blob, name: string): Promise<string> {
  return uploadPhoto('/api/admin/images', blob, name, true)
}

/** Stores one photograph through a shared editing link's door. */
export async function uploadSharedImage(token: string, blob: Blob, name: string): Promise<string> {
  return uploadPhoto('/api/share/images', blob, name, { share: token })
}
