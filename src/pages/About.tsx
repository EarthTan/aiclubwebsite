import { Link } from 'react-router-dom'
import { Mail, Sparkles, Users, Wrench } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import type { SiteSettings } from '@/lib/types'

const PILLARS = [
  {
    icon: Wrench,
    title: 'Workshops',
    body: 'Hands-on sessions where members build something real — a personal website, a slide deck with a language model, a first agent.',
  },
  {
    icon: Users,
    title: 'Talks and industry nights',
    body: 'Researchers and practitioners describe what the work actually looks like, from foundation-model infrastructure to applied machine learning in product teams.',
  },
  {
    icon: Sparkles,
    title: 'Competitions and field trips',
    body: 'Hackathons, cross-disciplinary challenges and visits to the companies building the technology, often together with partner student organizations.',
  },
]

export function About({ settings }: { settings: SiteSettings }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <header className="max-w-3xl">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          About
        </span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          {settings.about_title}
        </h1>
      </header>

      <div className="mt-12 grid gap-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <Markdown>{settings.about_body}</Markdown>

          <h2 className="mt-16 text-2xl font-semibold tracking-tight">What we run</h2>
          <div className="mt-8 divide-y divide-border border-y border-border">
            {PILLARS.map((p) => (
              <div key={p.title} className="flex gap-5 py-6">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                  <p.icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold tracking-tight">{p.title}</h3>
                  <p className="mt-2 text-lg leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="space-y-10">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Club history
            </h2>
            <ol className="mt-6 space-y-8 border-l border-border pl-7">
              {settings.history.map((h) => (
                <li key={h.period} className="relative">
                  <span className="absolute -left-[33px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-accent" />
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                    {h.period}
                  </div>
                  <h3 className="mt-1.5 font-semibold tracking-tight">{h.title}</h3>
                  <p className="mt-1.5 text-lg leading-relaxed text-muted-foreground">{h.body}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-2xl bg-primary p-7 text-primary-foreground">
            <h2 className="text-lg font-semibold tracking-tight">Get in touch</h2>
            <p className="mt-3 text-lg leading-relaxed text-primary-foreground/80">
              {settings.contact_note}
            </p>
            <a
              href={`mailto:${settings.contact_email}`}
              className="mt-5 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4"
            >
              <Mail className="h-4 w-4" /> {settings.contact_email}
            </a>
          </div>

          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Elsewhere
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              {settings.links.map((l) => (
                <li key={l.url}>
                  <a
                    className="text-primary hover:underline"
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {l.label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <Link
            to="/events"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            Browse everything we have run →
          </Link>
        </aside>
      </div>
    </div>
  )
}
