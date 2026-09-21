import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { EventCard } from '@/components/EventCard'
import { HeroCarousel, type HeroSlide } from '@/components/HeroCarousel'
import { formatMonth } from '@/lib/format'
import type { EventRecord, SiteSettings } from '@/lib/types'

/** The photograph the home page falls back to when no hero image is configured. */
const DEFAULT_HERO_IMAGE = './images/events/banner.jpg'

/** How many events join the club slide in the hero carousel. */
const HERO_EVENT_SLIDES = 3

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
  const featured = events.filter((e) => e.featured).slice(0, 3)
  const latest = events.slice(0, 6)

  /**
   * The hero leads with the club's most recent flagship event and closes on the
   * club slide itself. A wide frame crops portrait posters badly, so events are
   * only eligible for the carousel when their gallery holds a picture — the
   * archive's own cover art is often a poster.
   */
  const heroSlides = useMemo<HeroSlide[]>(() => {
    const clubSlide: HeroSlide = {
      id: 'club',
      image: settings.hero_image || DEFAULT_HERO_IMAGE,
      kicker: settings.hero_kicker,
      title: settings.hero_title,
      subtitle: settings.hero_subtitle,
      actions: [
        { label: 'Browse events', to: '/events', primary: true },
        { label: 'About the club', to: '/about' },
      ],
    }

    const eventSlides: HeroSlide[] = events
      .map((event) => ({ event, photo: event.gallery[0] ?? null }))
      .filter((row): row is { event: EventRecord; photo: string } => Boolean(row.photo))
      .sort((a, b) => Number(b.event.featured) - Number(a.event.featured))
      .slice(0, HERO_EVENT_SLIDES)
      .map(({ event, photo }) => ({
        id: event.slug,
        image: photo,
        kicker: `${event.category} · ${formatMonth(event.event_date)}`,
        title: event.title,
        actions: [{ label: 'Read the story', to: `/events/${event.slug}`, primary: true }],
      }))

    return [...eventSlides, clubSlide]
  }, [events, settings])

  return (
    <div>
      {/* Hero — full-bleed photograph carousel */}
      <HeroCarousel slides={heroSlides} />

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
