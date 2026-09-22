import type { EventRecord, EventStatus } from './types'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** `2026-03-28` → `March 28, 2026`. Falls back to the raw value if unparseable. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return iso ?? ''
  const [, y, mo, d] = m
  return `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`
}

/** `2026-03-28` → `Mar 2026`; used for compact timeline labels. */
export function formatMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? '')
  if (!m) return iso ?? ''
  return `${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${m[1]}`
}

/**
 * How many words of a title a slug keeps.
 *
 * A slug is an address, not a summary. Left unbounded, a title that runs to a
 * full sentence produces an address of sixty-odd characters that nobody can
 * read, paste or say out loud. Five words is enough to recognise the event by,
 * and the full title is on the page either way.
 */
export const SLUG_WORDS = 5

/** Turns a title into a URL-safe slug, keeping only its first few words. */
export function slugify(input: string, maxWords: number = SLUG_WORDS): string {
  const base = input
    // Cut on the words of the title rather than on the finished slug: a word
    // can contain a hyphen of its own, and splitting the slug afterwards would
    // count its halves as two words.
    .trim()
    .split(/\s+/)
    .slice(0, maxWords)
    .join(' ')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’"“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return base || `event-${Date.now().toString(36)}`
}

export function isVisible(event: Pick<EventRecord, 'status'>): boolean {
  return event.status === 'published'
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  published: 'Published',
  draft: 'Draft',
  archived: 'Archived',
}

export const ROLE_LABEL: Record<EventRecord['role'], string> = {
  host: 'Hosted by the DKU AI Club',
  'co-host': 'Co-hosted with a partner club',
  partner: 'Supported by the DKU AI Club',
}

/** A short, plain-text stand-in for the body, used when no summary was written. */
export function deriveSummary(body: string, limit = 220): string {
  const paragraphs = (body ?? '').split(/\n\s*\n/)
  for (const raw of paragraphs) {
    const p = raw.trim()
    if (!p || p.startsWith('#') || p.startsWith('![') || p.startsWith('<')) continue
    const plain = p
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/[*_`>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!plain) continue
    return plain.length > limit ? `${plain.slice(0, limit - 1).replace(/\s\S*$/, '')}…` : plain
  }
  return ''
}

/**
 * Summaries are displayed as plain text — on cards and above an article — so the
 * markdown markers that occasionally come with the copy, such as a blockquote
 * arrow, are removed before display.
 */
export function plainSummary(summary: string): string {
  return (summary ?? '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
