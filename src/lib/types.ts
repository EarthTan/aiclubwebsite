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

export interface HistoryEntry {
  period: string
  title: string
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
  history: HistoryEntry[]
  contact_email: string
  contact_note: string
  links: { label: string; url: string }[]
  categories: string[]
}
