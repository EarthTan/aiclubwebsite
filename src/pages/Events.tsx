import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { EventCard } from '@/components/EventCard'
import type { EventRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

export function Events({ events }: { events: EventRecord[] }) {
  const [category, setCategory] = useState<string>('All')
  const [query, setQuery] = useState('')

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
    return ['All', ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)]
  }, [events])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      if (category !== 'All' && e.category !== category) return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [events, category, query])

  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <header className="max-w-3xl">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          The archive
        </span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Events</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          Past and upcoming events — workshops, talks, info sessions, hackathons and field trips.
        </p>
      </header>

      <div className="mt-10 flex flex-col gap-5 border-y border-border py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                category === c
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <label className="relative block lg:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events"
            className="w-full rounded-full border border-input bg-background py-2.5 pl-10 pr-4 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="py-24 text-center text-lg text-muted-foreground">
          No events match this filter yet.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
          </p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((e) => (
              <EventCard key={e.slug} event={e} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
