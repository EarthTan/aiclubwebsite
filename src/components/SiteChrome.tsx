import { Link, NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { homeHighlights } from '@/lib/home'
import { useSite } from '@/lib/store'
import { cn } from '@/lib/utils'
// Imported rather than linked out of `public/`, so the mark travels through the
// build like every other asset — fingerprinted, and correct whatever the site is
// served from.
import clubMark from '@/assets/logo.svg'
import clubMarkWhite from '@/assets/logo-white.svg'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/events', label: 'Events' },
  { to: '/about', label: 'About' },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [floating, setFloating] = useState(false)
  const { pathname } = useLocation()
  const { settings, events } = useSite()

  useEffect(() => setOpen(false), [pathname])

  // The bar is clear over a photograph rather than over the page. Whether the
  // home page has one is a decision made in the panel, so it is asked for
  // rather than assumed: with no photograph underneath, clear white lettering
  // would be white lettering on white.
  const overPhotograph = pathname === '/' && homeHighlights(events, settings).length > 0

  // Kept transparent until the reader scrolls away from the top of the page. An
  // open menu always gets a solid surface.
  useEffect(() => {
    if (!overPhotograph) {
      setFloating(false)
      return
    }
    const sync = () => setFloating(window.scrollY < 80)
    sync()
    window.addEventListener('scroll', sync, { passive: true })
    return () => window.removeEventListener('scroll', sync)
  }, [overPhotograph])

  const overImage = floating && !open

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b transition-colors duration-300',
        overImage
          ? 'border-transparent bg-transparent'
          : 'border-border/70 bg-background/85 backdrop-blur-md',
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-3">
          <img
            src={overImage ? clubMarkWhite : clubMark}
            alt=""
            className="h-9 w-9 shrink-0"
          />
          <span
            className={cn(
              'text-[0.9375rem] font-semibold tracking-tight transition-colors',
              overImage && 'text-white',
            )}
          >
            DKU AI Club
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? overImage
                      ? 'bg-white/15 text-white'
                      : 'bg-secondary text-primary'
                    : overImage
                      ? 'text-white/80 hover:bg-white/10 hover:text-white'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          <Link
            to="/admin"
            className={cn(
              'ml-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              overImage
                ? 'border-white/40 text-white/85 hover:border-white hover:text-white'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary',
            )}
          >
            Admin
          </Link>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors md:hidden',
            overImage ? 'border-white/40 text-white' : 'border-border text-foreground',
          )}
          aria-label="Toggle navigation"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/70 bg-background md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col px-5 py-3 sm:px-8">
            {NAV.concat([{ to: '/admin', label: 'Admin', end: false }]).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-3 text-sm font-medium',
                    isActive ? 'bg-secondary text-primary' : 'text-muted-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}

export function SiteFooter({ settings }: { settings: { club_name: string; contact_email: string; links: { label: string; url: string }[] } }) {
  return (
    <footer className="mt-24 border-t border-border bg-secondary/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <img src={clubMark} alt="" className="h-8 w-8 shrink-0" />
            <span className="font-semibold tracking-tight">{settings.club_name}</span>
          </div>
          <p className="mt-4 max-w-sm text-lg leading-relaxed text-muted-foreground">
            A student organization at Duke Kunshan University. Workshops, talks, competitions and
            field trips on artificial intelligence — open to every major.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Explore
          </h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link className="hover:text-primary" to="/events">Events</Link></li>
            <li><Link className="hover:text-primary" to="/about">About the club</Link></li>
            <li><Link className="hover:text-primary" to="/admin">Administrator sign-in</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Get in touch
          </h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <a className="hover:text-primary" href={`mailto:${settings.contact_email}`}>
                {settings.contact_email}
              </a>
            </li>
            {settings.links.map((l) => (
              <li key={l.url}>
                <a className="hover:text-primary" href={l.url} target="_blank" rel="noreferrer">
                  {l.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} {settings.club_name}. Student-run.</span>
          <span>Built and maintained by club members.</span>
        </div>
      </div>
    </footer>
  )
}
