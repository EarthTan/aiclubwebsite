import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, Download, Loader2, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import {
  archiveEvent,
  deleteEvent,
  fetchAllEvents,
  importArchive,
  loadArchive,
  restoreEvent,
} from '@/lib/data'
import { formatDate, STATUS_LABEL } from '@/lib/format'
import { useSite } from '@/lib/store'
import type { EventRecord, EventStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_STYLE: Record<EventStatus, string> = {
  published: 'bg-accent/10 text-accent',
  draft: 'bg-amber-500/10 text-amber-700',
  archived: 'bg-muted text-muted-foreground',
}

export function AdminEvents() {
  const navigate = useNavigate()
  const { reload } = useSite()
  const [events, setEvents] = useState<EventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | EventStatus>('all')
  const [unimported, setUnimported] = useState(0)
  const [importing, setImporting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [library, archive] = await Promise.all([fetchAllEvents(), loadArchive()])
      setEvents(library)
      // The club's history ships inside the site bundle. Until it has been
      // promoted into the library, offer to do that — see `importArchive`.
      const present = new Set(library.map((e) => e.slug))
      setUnimported(archive.filter((e) => !present.has(e.slug)).length)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event library could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function runImport() {
    if (
      !window.confirm(
        `Add ${unimported} event${unimported === 1 ? '' : 's'} from the club's archive to the library? ` +
          'Nothing already in the library is changed.',
      )
    )
      return
    setImporting(true)
    setError(null)
    try {
      await importArchive()
      await load()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The archive could not be imported.')
    } finally {
      setImporting(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      if (status !== 'all' && e.status !== status) return false
      if (!q) return true
      return e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)
    })
  }, [events, query, status])

  async function run(slug: string, action: () => Promise<unknown>) {
    setBusySlug(slug)
    setError(null)
    try {
      await action()
      await load()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.')
    } finally {
      setBusySlug(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Event library</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {events.length} records · edit an existing write-up, or add a new one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/admin/events/new')}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New event
        </button>
      </div>

      {error && (
        <p className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {unimported > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-secondary/40 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {unimported} event{unimported === 1 ? '' : 's'} from the club's archive {unimported === 1 ? 'is' : 'are'} not in
            the library yet. Everything already here stays as it is.
          </p>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={importing}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Import them
          </button>
        </div>
      )}

      <div className="mt-7 flex flex-col gap-4 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {(['all', 'published', 'draft', 'archived'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                status === s
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {s === 'all' ? 'All' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles"
            className="w-full rounded-xl border border-input bg-background py-2.5 pl-10 pr-4 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>

      {loading ? (
        <p className="flex items-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the event library…
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {filtered.map((e) => (
            <li key={e.slug} className="flex flex-wrap items-center gap-5 py-5">
              <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                {e.cover_image && (
                  <img src={e.cover_image} alt="" className="h-full w-full object-cover" />
                )}
              </div>

              <div className="min-w-[16rem] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]',
                      STATUS_STYLE[e.status],
                    )}
                  >
                    {STATUS_LABEL[e.status]}
                  </span>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                    {e.category}
                  </span>
                </div>
                <Link
                  to={`/admin/events/${e.slug}`}
                  className="mt-2 block font-medium leading-snug hover:text-primary"
                >
                  {e.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(e.event_date)}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/admin/events/${e.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Link>

                {e.status === 'published' ? (
                  <button
                    type="button"
                    disabled={busySlug === e.slug}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Unpublish “${e.title}”? It will disappear from the public site.`,
                        )
                      )
                        return
                      void run(e.slug, () => archiveEvent(e.slug))
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
                  >
                    <Archive className="h-3.5 w-3.5" /> Unpublish
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busySlug === e.slug}
                    onClick={() => void run(e.slug, () => restoreEvent(e.slug))}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Publish
                  </button>
                )}

                <button
                  type="button"
                  disabled={busySlug === e.slug}
                  onClick={() => {
                    if (!window.confirm(`Delete “${e.title}”? This cannot be undone.`)) return
                    void run(e.slug, () => deleteEvent(e.slug))
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-destructive transition-colors hover:border-destructive/50 disabled:opacity-50"
                >
                  {busySlug === e.slug ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
