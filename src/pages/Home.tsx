import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { EventCard } from '@/components/EventCard'
import { HeroCarousel, type HeroSlide } from '@/components/HeroCarousel'
import { formatMonth } from '@/lib/format'
import { homeHighlights } from '@/lib/home'
import type { EventRecord, SiteSettings } from '@/lib/types'

/**
 * How many of the chosen events also get a card in the section under the hero.
 * The first one is laid out as a wide card and the rest sit beside each other,
 * so the section is built for three.
 */
const FEATURED_CARDS = 3

function SectionHeading({
  title,
  action,
}: {
  title: string
  action?: { label: string; to: string }
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 self-start">
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {action && (
        <Link
          to={action.to}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          {action.label} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  )
}

export function Home({ events, settings }: { events: EventRecord[]; settings: SiteSettings }) {
  /**
   * Everything the home page leads with, decided in the administrator panel and
   * read from one place, so the hero and the cards beneath it cannot disagree
   * about which events the page is about.
   */
  const highlights = useMemo(() => homeHighlights(events, settings), [events, settings])
  const featured = highlights.slice(0, FEATURED_CARDS).map((row) => row.event)
  const latest = events.slice(0, 6)

  const heroSlides = useMemo<HeroSlide[]>(
    () =>
      highlights.map(({ event, image }) => ({
        id: event.slug,
        image,
        kicker: `${event.category} · ${formatMonth(event.event_date)}`,
        title: event.title,
        actions: [{ label: 'Read the story', to: `/events/${event.slug}`, primary: true }],
      })),
    [highlights],
  )

  return (
    <div>
      {/* Hero — full-bleed photograph carousel. Its caption carries the page's
          heading, so a hero with no slides would leave the page without one. */}
      <HeroCarousel slides={heroSlides} />
      {heroSlides.length === 0 && <h1 className="sr-only">{settings.club_name}</h1>}

      {/* Who are we — the short lead; the full introduction lives on /about. */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeading title={settings.about_title} />
          <div>
            <p className="text-lg leading-relaxed text-muted-foreground">{settings.about_lead}</p>
            <Link
              to="/about"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              More about the club <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Featured */}
      {featured.length > 0 && (
        <section className="border-y border-border bg-secondary/30">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <SectionHeading
              title="Programmes worth reading about"
              action={{ label: 'All events', to: '/events' }}
            />
            <div className="mt-10 grid gap-6">
              {featured.length > 0 && <EventCard event={featured[0]} featured />}
              {featured.length > 1 && (
                <div className="grid gap-6 sm:grid-cols-2">
                  {featured.slice(1).map((e) => (
                    <EventCard key={e.slug} event={e} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Latest */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <SectionHeading
          title="Recently held"
          action={{ label: 'Browse the archive', to: '/events' }}
        />
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {latest.map((e) => (
            <EventCard key={e.slug} event={e} />
          ))}
        </div>
      </section>

      {/* Join */}
      <section className="mx-auto max-w-6xl px-5 pb-4 sm:px-8">
        <div className="overflow-hidden rounded-3xl bg-primary px-8 py-14 text-primary-foreground sm:px-14">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Join the club</h2>
            <p className="mt-4 text-lg leading-relaxed text-primary-foreground/80">
              {settings.contact_note}
            </p>
            <a
              href={`mailto:${settings.contact_email}`}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-background px-6 py-3 text-sm font-semibold text-primary transition-colors hover:bg-background/90"
            >
              {settings.contact_email}
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
