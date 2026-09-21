import { NavLink, Outlet, Link } from 'react-router-dom'
import { Loader2, LogOut } from 'lucide-react'
import { useAdmin } from '@/hooks/useAdmin'
import { forgetSiteKey } from '@/lib/data'
import { AuthPanel } from './AuthPanel'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/admin', label: 'Events', end: true },
  { to: '/admin/settings', label: 'Settings', end: false },
]

/** Gate for every administrator route: the key, then the panel. */
export function AdminLayout() {
  const { state, loading, refresh } = useAdmin()
  const onDone = () => void refresh()

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-32 text-muted-foreground sm:px-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking this browser’s key…
      </div>
    )
  }

  if (!state?.hasKey) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 sm:px-8">
        <AuthPanel onDone={onDone} />
      </div>
    )
  }

  // A key that is held but no longer accepted: the club replaced it somewhere
  // else. Shown rather than silently dropped, so the outcome is a sentence —
  // the key is out of date — instead of an unexplained return to the prompt.
  if (!state.isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 sm:px-8">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10">
          <h1 className="text-lg font-semibold tracking-tight">This key no longer opens the panel</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The key this browser is holding is not the one the site accepts now. It was most likely
            replaced from another browser, which retires every copy of the old key.
          </p>
          <button
            type="button"
            onClick={() => {
              forgetSiteKey()
              onDone()
            }}
            className="mt-7 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
          >
            Use a different key
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Administrator
          </span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Site management</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            forgetSiteKey()
            onDone()
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Forget this key
        </button>
      </div>

      <nav className="mt-8 flex flex-wrap gap-2 border-b border-border pb-4">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
        <Link
          to="/events"
          className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-primary"
        >
          View the public site ↗
        </Link>
      </nav>

      <div className="mt-8">
        <Outlet />
      </div>
    </div>
  )
}
