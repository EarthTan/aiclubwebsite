/**
 * The panel's way back: the version of this event that the last save replaced,
 * and the offer to put it back.
 *
 * It is here because an event is now written from two places. A link goes out
 * to somebody who is not an administrator, they rewrite the event, and nothing
 * tells the administrator that the paragraph they wrote is gone. One version
 * back answers exactly that, and it is shown on the event's own page because
 * the question it answers — "what did this used to say?" — is a question about
 * the event on screen.
 *
 * Presentational on purpose. Whether there is anything to show, and what
 * happens when a version is put back, belong to the form: it holds the draft,
 * so it is the only thing that can hand over a restored version and know
 * whether unsaved work is about to be swept aside.
 *
 * Hidden entirely when there is nothing to show. An empty "no earlier version"
 * card on every event that has only been saved once would be furniture, and the
 * absence of the card is itself the answer.
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp, History, Loader2, RotateCcw } from 'lucide-react'
import type { PreviousVersion } from '@/lib/data'
import { formatMoment } from '@/lib/format'

/**
 * How each kind of save reads to the administrator reading it.
 *
 * The point of naming the door is that a link and the administrator's own hand
 * mean different things here: one is a change nobody watched happen, and the
 * other is a change they remember making.
 */
const VIA_NOTE: Record<string, string> = {
  link: 'Somebody writing through a link replaced it',
  restore: 'It was replaced when an earlier version was put back',
  panel: 'A save from this panel replaced it',
}

const smallButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary'

export function EventRevision({
  revision,
  busy,
  onRestore,
}: {
  revision: PreviousVersion
  busy: boolean
  onRestore: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-6 rounded-2xl border border-accent/25 bg-accent/5 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <History className="h-4 w-4 text-accent" />
            An earlier version of this event is kept
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {VIA_NOTE[revision.via] ?? VIA_NOTE.panel}, on {formatMoment(revision.saved_at)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setOpen((was) => !was)} className={smallButton}>
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? 'Hide what it said' : 'Show what it said'}
          </button>
          <button
            type="button"
            onClick={onRestore}
            disabled={busy}
            className={`${smallButton} disabled:opacity-60`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Put this version back
          </button>
        </div>
      </div>

      {open && (
        /*
          Held as plain text rather than rendered, so this reads as the note it
          is — what the event used to say — and not as a second copy of the page
          competing with the form above it.
        */
        <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-border bg-background p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Kept version
          </p>
          <p className="mt-2 text-sm font-medium">{revision.title}</p>
          {revision.summary && (
            <p className="mt-1 text-xs text-muted-foreground">{revision.summary}</p>
          )}
          <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
            {revision.body}
          </pre>
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            {revision.gallery.length} photograph{revision.gallery.length === 1 ? '' : 's'} in the
            gallery, {revision.cover_image ? 'a cover image' : 'no cover image'}.
          </p>
        </div>
      )}
    </div>
  )
}
