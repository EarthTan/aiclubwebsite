/**
 * The site's own API, which is the same origin as the site itself.
 *
 * Everything the pages need from a server goes through here. Reads of published
 * content are open; every call that is passed `true` for `withKey` carries the
 * panel's key in a header, and is refused without it. That is the whole of the
 * site's access control — there is no account, no session and no token.
 *
 * A refusal of the key arrives as `ApiError` with the code `KEY_REJECTED`,
 * whichever endpoint produced it, so the panel has one sentence to show rather
 * than one per call.
 */

import { readSiteKey } from './siteKey'

/** One row of the event library, as the server sends it. */
export type EventRow = Record<string, unknown>

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

async function call<T>(path: string, init: RequestInit = {}, withKey = false): Promise<T> {
  const headers = new Headers(init.headers)
  if (withKey) {
    const key = readSiteKey()
    if (!key) throw new Error('This browser is no longer holding the site key.')
    headers.set('x-site-key', key)
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

/**
 * Stores one photograph and answers with the URL that serves it.
 *
 * The bytes go to object storage and only the URL is written into the event, so
 * a page of pictures is not carried inside the database.
 */
export async function uploadImage(blob: Blob, name: string): Promise<string> {
  const query = name ? `?name=${encodeURIComponent(name)}` : ''
  const answer = await call<{ url: string }>(
    `/api/admin/images${query}`,
    {
      method: 'POST',
      headers: { 'content-type': blob.type || 'image/jpeg' },
      body: blob,
    },
    true,
  )
  return answer.url
}
