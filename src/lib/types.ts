export type EventRole = 'host' | 'co-host' | 'partner'
export type EventStatus = 'published' | 'draft' | 'archived'

/** Where a record came from: the shipped archive, or the editable cloud database. */
export type EventOrigin = 'archive' | 'database'

export interface EventRecord {
  /** Stable public identifier; also the URL segment on /events/<slug>. */
  slug: string
  title: string
  summary: string
  /** Markdown. */
  body: string
  category: string
  /** ISO date, `YYYY-MM-DD`. */
  event_date: string
  location?: string | null
  cover_image?: string | null
  gallery: string[]
  tags: string[]
  role: EventRole
  status: EventStatus
  featured: boolean
  source_url?: string | null
  source_credit?: string | null
  origin: EventOrigin
  /** Database row id; absent for archive-only records. */
  id?: number
  updated_at?: string | null
}

/** The shape written to `public/content/events.json` — the shipped event archive. */
export interface ArchivedEvent {
  slug: string
  title: string
  summary: string
  body: string
  category: string
  event_date: string
  cover_image: string | null
  gallery: string[]
  status: EventStatus
  featured: boolean
  source_url: string | null
  source_credit: string | null
  role: EventRole
  tags: string[]
  location: string | null
  end_date: string | null
}

/** One phase of the club's history, as the `/history` page lays it out. */
export interface HistoryEntry {
  /** The date label shown above the headline, e.g. `January – May 2025`. */
  period: string
  title: string
  /** Markdown. A phase may run to several paragraphs. */
  body: string
}

export interface SiteSettings {
  club_name: string
  tagline: string
  hero_kicker: string
  hero_title: string
  hero_subtitle: string
  hero_image: string | null
  about_title: string
  /** Two-sentence lead shown on the home page. */
  about_lead: string
  /** The full introduction, used on the about page. */
  about_body: string
  /** Heading of the `/history` page. */
  history_title: string
  /** One paragraph standing between that heading and the timeline. */
  history_lead: string
  /** The phases of the club's history, oldest first. */
  history: HistoryEntry[]
  contact_email: string
  contact_note: string
  links: { label: string; url: string }[]
  categories: string[]
}
