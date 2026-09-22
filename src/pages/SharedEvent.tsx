/**
 * What somebody sees when they open a shared editing link.
 *
 * It is the same event form the panel uses, opened by a different door, and
 * that is deliberate: the person writing an event up is doing the same work
 * whether or not they hold the site's key, and a second, lesser interface for
 * them would be a second thing to keep working.
 *
 * What this page adds on top is a sentence about what the link is, so that the
 * first thing a stranger to the site reads is not a bare form, and a place for
 * the form to say when the link has run out. The second matters more than it
 * looks: a link that expires mid-sentence should say so, rather than fail at the
 * save button with a form that will not save again.
 */
import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { EventEditor } from '@/components/EventEditor'
import { useSite } from '@/lib/store'

export function SharedEvent() {
  const { token = '' } = useParams<{ token: string }>()
  const { settings } = useSite()
  const [finished, setFinished] = useState(false)

  // Stable, so that the editor's own state does not depend on this page
  // re-rendering: it is told once and remembers.
  const onLinkFinished = useCallback(() => setFinished(true), [])

  if (finished) return <LinkFinished />

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Write up this event</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This link was made for one event, and opens nothing else. Write it up, add photographs,
          and save as often as you like. Whether the event is shown to the public is the club’s
          decision, and not one this page changes.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The link lasts as long as it was given, and can be taken back before then. If it stops
          working while you are writing, ask for a new one.
        </p>
      </div>

      <div className="mt-8">
        <EventEditor settings={settings} token={token} onLinkFinished={onLinkFinished} />
      </div>
    </div>
  )
}

/** Shown when the server says the link is over — expired, taken back, or never real. */
function LinkFinished() {
  return (
    <div className="mx-auto max-w-lg px-5 py-20 sm:px-8">
      <div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10">
        <h1 className="text-lg font-semibold tracking-tight">This link no longer works</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Editing links last a few days, and can be taken back before that. Nothing already saved
          has been lost — ask whoever sent you the link for a new one, and carry on from there.
        </p>
      </div>
    </div>
  )
}
