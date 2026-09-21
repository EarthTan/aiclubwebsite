import { Link } from 'react-router-dom'
import { ArrowUpRight, Pin } from 'lucide-react'
import type { EventRecord } from '@/lib/types'
import { formatDate, plainSummary } from '@/lib/format'
import { cn } from '@/lib/utils'

export function CategoryChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-accent/10 px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-accent',
        className,
      )}
    >
      {label}
    </span>
  )
}

export function EventCard({
  event,
  featured = false,
}: {
  event: EventRecord
  featured?: boolean
}) {
  return (
    <Link
      to={`/events/${event.slug}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all',
        'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5',
        featured && 'md:flex-row',
      )}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden bg-muted',
          featured ? 'aspect-[16/10] md:aspect-auto md:w-1/2' : 'aspect-[16/10]',
        )}
      >
        {event.cover_image ? (
          <img
            src={event.cover_image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-accent/10">
            <span className="text-sm font-medium text-primary/60">{event.category}</span>
          </div>
        )}
      </div>

      <div className={cn('flex flex-1 flex-col p-6', featured && 'md:justify-center md:p-8')}>
        <div className="flex flex-wrap items-center gap-3">
          <CategoryChip label={event.category} />
          <time className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {formatDate(event.event_date)}
          </time>
        </div>

        <h3
          className={cn(
            'mt-4 font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary',
            featured ? 'text-2xl leading-snug' : 'text-lg leading-snug',
          )}
        >
          {event.title}
        </h3>

        {plainSummary(event.summary) && (
          <p className={cn('mt-3 text-lg leading-relaxed text-muted-foreground', featured ? 'line-clamp-4' : 'line-clamp-3')}>
            {plainSummary(event.summary)}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {event.location && (
            <span className="inline-flex items-center gap-1.5">
              <Pin className="h-3.5 w-3.5" />
              {event.location}
            </span>
          )}
          <span className="inline-flex items-center gap-1 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            Read the recap <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}
