import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import type { SiteSettings } from '@/lib/types'

/**
 * The club's own account of itself, phase by phase.
 *
 * One column, the same width the event write-ups use, because this is a piece of
 * long-form reading rather than a timeline widget. The spine on the left is the
 * only decorative element: it marks the entries as a sequence and nothing more.
 */
export function History({ settings }: { settings: SiteSettings }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {settings.history_title}
        </h1>
        {settings.history_lead && (
          <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{settings.history_lead}</p>
        )}
      </header>

      <ol className="mt-16 space-y-16 border-l border-border pl-8">
        {settings.history.map((h) => (
          <li key={h.period} className="relative">
            {/* Centred on the spine: the dot is half its own width to the left of
                where the text starts, which is exactly where the rule runs. */}
            <span className="absolute -left-8 top-2 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-background bg-accent" />
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              {h.period}
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{h.title}</h2>
            <div className="mt-5">
              <Markdown>{h.body}</Markdown>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-20 border-t border-border pt-8">
        <Link
          to="/events"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          Everything the club has run <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}
