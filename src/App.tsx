import { Suspense, lazy } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import { SiteProvider, useSite } from '@/lib/store'
import { About } from '@/pages/About'
import { EventDetail } from '@/pages/EventDetail'
import { Events } from '@/pages/Events'
import { History } from '@/pages/History'
import { Home } from '@/pages/Home'
import { NotFound } from '@/pages/NotFound'

/*
  The panel is loaded only when someone opens it.

  Its writing editor is by far the heaviest thing in the project, and it is of no
  use to a visitor reading about an event. Splitting it off keeps it out of the
  download every reader pays for, and costs a moment of waiting for the two
  people who actually administer the site.

  The event form is now reached two ways — from the panel, and from a shared
  editing link — so it is split off on its own rather than as part of the panel.
  Whoever was sent a link has no business downloading the home page tab or the
  settings tab to write a paragraph.
*/
const AdminLayout = lazy(() =>
  import('@/pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
)
const AdminEvents = lazy(() =>
  import('@/pages/admin/AdminEvents').then((m) => ({ default: m.AdminEvents })),
)
const AdminHome = lazy(() =>
  import('@/pages/admin/AdminHome').then((m) => ({ default: m.AdminHome })),
)
const AdminSettings = lazy(() =>
  import('@/pages/admin/AdminSettings').then((m) => ({ default: m.AdminSettings })),
)
const EventEditor = lazy(() =>
  import('@/components/EventEditor').then((m) => ({ default: m.EventEditor })),
)
const SharedEvent = lazy(() =>
  import('@/pages/SharedEvent').then((m) => ({ default: m.SharedEvent })),
)

function Shell() {
  const { settings, events, loading, error } = useSite()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the club site…
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        {error && (
          // Raised above the home page hero, which extends behind the header.
          <div className="relative z-20 mx-auto max-w-6xl px-5 pt-6 sm:px-8">
            <p className="rounded-xl border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive">
              {error} Showing the built-in event archive instead.
            </p>
          </div>
        )}
        <Suspense
          fallback={
            <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-24 text-muted-foreground sm:px-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Home events={events} settings={settings} />} />
            <Route path="/events" element={<Events events={events} />} />
            <Route path="/events/:slug" element={<EventDetail events={events} />} />
            <Route path="/about" element={<About settings={settings} />} />
            <Route path="/history" element={<History settings={settings} />} />
            {/*
              A shared editing link. Not under `/admin`, and not behind the
              key: it is its own door, and everything it reaches is decided by
              the token in the address rather than by this browser.
            */}
            <Route path="/share/:token" element={<SharedEvent />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminEvents />} />
              <Route path="events/new" element={<EventEditor settings={settings} />} />
              <Route path="events/:slug" element={<EventEditor settings={settings} />} />
              <Route path="home" element={<AdminHome />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <SiteFooter settings={settings} />
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <SiteProvider>
        <Shell />
      </SiteProvider>
    </HashRouter>
  )
}
