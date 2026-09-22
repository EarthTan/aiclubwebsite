/**
 * The panel's half of a shared editing link: make one, read the URL back, take
 * one away.
 *
 * It sits on the event's own page rather than in a list of its own, because the
 * decision it serves is "somebody else is writing this one up", which is
 * already the subject of the page. A link belongs to an event, and this is
 * where that event is.
 *
 * The URL is built here rather than sent from the server. The server knows what
 * the token is; which address this site is reached at is the browser's
 * business, and it is also the only party that can put the two together.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, Trash2 } from 'lucide-react'
import { listShareLinks, makeShareLink, revokeShareLink, type ShareLink } from '@/lib/data'
import { formatMoment } from '@/lib/format'
import { cn } from '@/lib/utils'

const card = 'rounded-2xl border border-border p-5'
const cardTitle = 'text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground'
const input =
  'w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'
const smallButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary'

/** What the panel offers, in the order it offers it. Seven days is the middle one. */
const DURATIONS = [3, 7, 30]
const DEFAULT_DAYS = 7

/** The address that gets pasted into a chat message. */
function linkFor(token: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname.replace(/\/[^/]*$/, '/')}#/share/${token}`
}

export function ShareLinks({ slug }: { slug: string }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null)
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Which list request is the current one.
   *
   * Two of them are in flight at the same moment in the ordinary course of
   * using this card — the one that opens it, and the one that follows making a
   * link — and a network does not promise they come back in the order they were
   * sent. Without this, the answer to the first can land after the answer to
   * the second and put a list on screen that is missing the link just made,
   * which reads as "it did not work".
   */
  const latest = useRef(0)

  const readLinks = useCallback(async () => {
    const mine = (latest.current += 1)
    try {
      const rows = await listShareLinks(slug)
      if (latest.current === mine) setLinks(rows)
    } catch (err: unknown) {
      if (latest.current !== mine) return
      setLinks((current) => current ?? [])
      setError(err instanceof Error ? err.message : 'The links could not be read.')
    }
  }, [slug])

  useEffect(() => {
    setLinks(null)
    setError(null)
    void readLinks()
  }, [readLinks])

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token))
      setCopied(token)
      window.setTimeout(() => setCopied((current) => (current === token ? null : current)), 2000)
    } catch {
      setError('The browser would not copy for us. Select the address and copy it by hand.')
    }
  }

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const made = await makeShareLink(slug, days, label.trim())
      setLabel('')
      // Read the list back rather than adding the row here. The server has just
      // written it and is the party that knows what is on the list; keeping one
      // answer to that question is cheaper than keeping two in step.
      await readLinks()
      await copy(made.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That link could not be made.')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(token: string) {
    if (
      !window.confirm(
        'Take this link back? Whoever is holding it will no longer be able to open the event.',
      )
    ) {
      return
    }
    setError(null)
    try {
      await revokeShareLink(token)
      await readLinks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That link could not be taken back.')
    }
  }

  return (
    <div className={card}>
      <h3 className={cardTitle}>Share this event</h3>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        A link that opens this event and nothing else, for as long as it is set to last. Whoever
        holds it can write the event up and add photographs. They cannot publish it, take it off
        the site, or open any other event.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <span className="mb-2 block text-xs font-medium text-muted-foreground">Good for</span>
          <div className="flex gap-2" role="radiogroup" aria-label="How long the link lasts">
            {DURATIONS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={days === value}
                onClick={() => setDays(value)}
                className={cn(
                  'rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                  days === value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {value} days
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="share-for">
            Who it is for
          </label>
          <input
            id="share-for"
            className={input}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="For your own memory — not shown to them"
          />
        </div>

        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Create a link
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          {error}
        </p>
      )}

      {links === null && (
        <p className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the links…
        </p>
      )}

      {links !== null && links.length > 0 && (
        <ul className="mt-5 space-y-4 border-t border-border pt-4">
          {links.map((row) => (
            <li key={row.token}>
              <p className="text-xs font-medium">
                {row.label || 'A writing link'}
                <span className="font-normal text-muted-foreground">
                  {' · '}
                  {row.last_used_at ? `last used ${formatMoment(row.last_used_at)}` : 'not used yet'}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Expires {formatMoment(row.expires_at)}
              </p>
              <input
                readOnly
                value={linkFor(row.token)}
                onFocus={(e) => e.currentTarget.select()}
                className={`${input} mt-2 text-xs`}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy(row.token)} className={smallButton}>
                  {copied === row.token ? (
                    <Check className="h-3.5 w-3.5 text-accent" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === row.token ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => void revoke(row.token)}
                  className={`${smallButton} text-destructive`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Take back
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What the panel shows before an event has been saved, when there is nothing to point a link at. */
export function ShareLinksPending() {
  return (
    <div className={card}>
      <h3 className={cardTitle}>Share this event</h3>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Save this event first, then a link can be made that opens it for somebody else to write up.
      </p>
    </div>
  )
}
