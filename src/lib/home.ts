import type { EventRecord, SiteSettings } from './types'

export interface HomeHighlight {
  event: EventRecord
  /** The event's cover photograph. Present by construction. */
  image: string
}

/**
 * The events the home page leads with, in the order an administrator arranged
 * them, each paired with the photograph that represents it.
 *
 * The sequence is held as slugs and resolved against the published library on
 * every read, which is what makes a stale entry harmless: an event that was
 * unpublished, deleted, or left without a cover photograph stops producing a
 * slide, and takes its place back if it returns. Nothing is inferred — an empty
 * list means no hero at all, not a fallback to whatever happens to be newest.
 *
 * A slide is a wide frame with a caption laid over it, so an event with no
 * cover photograph cannot produce one. It is skipped rather than padded, which
 * is also why the panel marks such an event as not showing yet.
 */
export function homeHighlights(events: EventRecord[], settings: SiteSettings): HomeHighlight[] {
  const bySlug = new Map(events.map((event) => [event.slug, event]))
  const chosen: HomeHighlight[] = []
  for (const slug of settings.home_slugs) {
    const event = bySlug.get(slug)
    if (!event || event.status !== 'published' || !event.cover_image) continue
    // The same slug listed twice is still one slide.
    if (chosen.some((row) => row.event.slug === event.slug)) continue
    chosen.push({ event, image: event.cover_image })
  }
  return chosen
}
