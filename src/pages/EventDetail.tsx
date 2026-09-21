import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays, Pin } from 'lucide-react'
import { CategoryChip } from '@/components/EventCard'
import { Markdown } from '@/components/Markdown'
import { formatDate, plainSummary } from '@/lib/format'
import type { EventRecord } from '@/lib/types'

/** Every block on the page shares this column, so text and images line up. */
const COLUMN = 'mx-auto max-w-3xl px-5 sm:px-8'

export function EventDetail({ events }: { events: EventRecord[] }) {
  const { slug = '' } = useParams()
  const index = events.findIndex((e) => e.slug === slug)

  if (index === -1) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-28 text-center sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight">That event could not be found</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          It may have been unpublished or renamed by a club administrator.
        </p>
        <Link
          to="/events"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to all events
        </Link>
      </div>
    )
  }

  const event = events[index]
  // The list is sorted newest-first, so the previous entry is the next event chronologically.
  const older = events[index + 1]
  const newer = events[index - 1]

  return (
    <article className="pb-8">
      <header className="border-b border-border bg-secondary/30">
        <div className={`${COLUMN} pb-12 pt-12`}>
          <Link
            to="/events"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" /> All events
          </Link>

          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
            <CategoryChip label={event.category} />
            <time className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDate(event.event_date)}
            </time>
            {event.location && (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Pin className="h-3.5 w-3.5" />
                {event.location}
              </span>
            )}
          </div>

          <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {event.title}
          </h1>

          {event.summary && (
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              {plainSummary(event.summary)}
            </p>
          )}
        </div>
      </header>

      {event.cover_image && (
        <div className={`${COLUMN} pt-10`}>
          <img
            src={event.cover_image}
            alt=""
            className="w-full rounded-2xl border border-border object-cover"
          />
        </div>
      )}

      <div className={`${COLUMN} pt-12`}>
        <Markdown>{event.body}</Markdown>

        {event.gallery.length > 0 && (
          <section className="mt-16">
            <h2 className="text-lg font-semibold tracking-tight">More from this event</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {event.gallery.map((src, i) => (
                <a key={src + i} href={src} target="_blank" rel="noreferrer" className="group block">
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-xl border border-border object-cover transition-transform group-hover:scale-[1.01]"
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        {(event.source_credit || event.source_url) && (
          <aside className="mt-16 rounded-2xl border border-border p-6">
            <h2 className="text-lg font-semibold tracking-tight">Source</h2>
            <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
              This write-up was originally published by{' '}
              <strong className="font-semibold text-foreground">
                {event.source_credit ?? 'an external organisation'}
              </strong>
              . It is reproduced here as part of the club's event archive, alongside a link to the
              original.
            </p>
            {event.source_url && (
              <a
                href={event.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                Read the original <ArrowRight className="h-4 w-4" />
              </a>
            )}
          </aside>
        )}
      </div>

      <nav className={`${COLUMN} mt-20 grid gap-4 border-t border-border pt-10 sm:grid-cols-2`}>
        {newer ? (
          <Link
            to={`/events/${newer.slug}`}
            className="group rounded-2xl border border-border p-5 transition-colors hover:border-primary/30"
          >
            <span className="text-sm text-muted-foreground">Newer</span>
            <p className="mt-2 text-lg font-medium leading-snug group-hover:text-primary">{newer.title}</p>
          </Link>
        ) : (
          <span />
        )}
        {older && (
          <Link
            to={`/events/${older.slug}`}
            className="group rounded-2xl border border-border p-5 text-right transition-colors hover:border-primary/30 sm:col-start-2"
          >
            <span className="text-sm text-muted-foreground">Earlier</span>
            <p className="mt-2 text-lg font-medium leading-snug group-hover:text-primary">{older.title}</p>
          </Link>
        )}
      </nav>
    </article>
  )
}
