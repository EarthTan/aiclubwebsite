import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  ImageOff,
  Loader2,
  Plus,
  Save,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { saveSettings } from '@/lib/data'
import { formatDate } from '@/lib/format'
import { useSite } from '@/lib/store'
import type { EventRecord } from '@/lib/types'

const input =
  'w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

/** A small landscape thumbnail of an event's cover, or a stand-in for a gap. */
function Cover({ event }: { event: EventRecord }) {
  return (
    <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
      {event.cover_image ? (
        <img src={event.cover_image} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-4 w-4" />
        </span>
      )}
    </div>
  )
}

export function AdminHome() {
  const { settings, events, reload } = useSite()
  const [slugs, setSlugs] = useState<string[]>(settings.home_slugs)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // The provider loads settings asynchronously; adopt them once they arrive.
  useEffect(() => {
    setSlugs(settings.home_slugs)
  }, [settings])

  const bySlug = useMemo(() => new Map(events.map((e) => [e.slug, e])), [events])
  const dirty = useMemo(
    () => slugs.length !== settings.home_slugs.length || slugs.some((s, i) => s !== settings.home_slugs[i]),
    [slugs, settings.home_slugs],
  )

  const available = useMemo(() => {
    const taken = new Set(slugs)
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      if (taken.has(e.slug)) return false
      if (!q) return true
      return e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)
    })
  }, [events, slugs, query])

  function move(index: number, step: number) {
    const next = index + step
    if (next < 0 || next >= slugs.length) return
    setSlugs((list) => {
      const copy = [...list]
      const [moved] = copy.splice(index, 1)
      copy.splice(next, 0, moved)
      return copy
    })
    setNotice(null)
  }

  function remove(slug: string) {
    setSlugs((list) => list.filter((s) => s !== slug))
    setNotice(null)
  }

  function add(slug: string) {
    setSlugs((list) => (list.includes(slug) ? list : [...list, slug]))
    setNotice(null)
  }

  async function submit() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await saveSettings({ ...settings, home_slugs: slugs })
      await reload()
      setNotice('Saved. The home page has been updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Home page</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Which events the home page opens with, and in what order. Each slide uses the event's
            own cover image — the one on its event page. A slide is a wide frame, so a landscape
            cover crops far better than a portrait poster.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {dirty ? 'Save home page' : 'Saved'}
        </button>
      </div>

      {error && (
        <p className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-6 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      )}

      {/* What the site is showing now, in order. */}
      <div className="mt-8 rounded-2xl border border-border p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          On the home page
        </h3>

        {slugs.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Nothing is on the home page yet, so the photograph carousel is not shown at all. Pick an
            event from the list below to start it.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-border">
            {slugs.map((slug, i) => {
              const event = bySlug.get(slug)
              const missing = !event
              const noCover = Boolean(event) && !event?.cover_image
              return (
                <li key={slug} className="flex flex-wrap items-center gap-5 py-4">
                  <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>

                  {event ? (
                    <Cover event={event} />
                  ) : (
                    <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                      <ImageOff className="h-4 w-4" />
                    </div>
                  )}

                  <div className="min-w-[14rem] flex-1">
                    {event ? (
                      <>
                        <Link
                          to={`/admin/events/${event.slug}`}
                          className="font-medium leading-snug hover:text-primary"
                        >
                          {event.title}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {event.category} · {formatDate(event.event_date)}
                        </p>
                      </>
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">{slug}</span>
                    )}

                    {missing && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        This event is not in the published library any more — it is being skipped.
                        Remove it, or publish it again to bring it back.
                      </p>
                    )}
                    {noCover && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        No cover image yet, so this slide will not appear. Add one on the event page.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      title="Move earlier"
                      className="rounded-lg border border-border p-2 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === slugs.length - 1}
                      title="Move later"
                      className="rounded-lg border border-border p-2 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(slug)}
                      title="Take off the home page"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-destructive transition-colors hover:border-destructive/50"
                    >
                      <X className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {/* The published library, minus whatever is already on the home page. */}
      <div className="mt-6 rounded-2xl border border-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Add an event
          </h3>
          <label className="relative block sm:w-64">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles"
              className={`${input} py-2 pl-10`}
            />
          </label>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Published events only. Ordered newest first — the order they are added in is the order
          they appear in above.
        </p>

        {available.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {events.length === 0
              ? 'The published library is empty.'
              : query
                ? 'No published event matches that search.'
                : 'Every published event is already on the home page.'}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {available.map((event) => (
              <li key={event.slug} className="flex flex-wrap items-center gap-5 py-4">
                <Cover event={event} />
                <div className="min-w-[14rem] flex-1">
                  <Link
                    to={`/admin/events/${event.slug}`}
                    className="font-medium leading-snug hover:text-primary"
                  >
                    {event.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.category} · {formatDate(event.event_date)}
                  </p>
                  {!event.cover_image && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      No cover image, so it would not show until one is added.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => add(event.slug)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
