import { HashRouter, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import { SiteProvider, useSite } from '@/lib/store'
import { About } from '@/pages/About'
import { EventDetail } from '@/pages/EventDetail'
import { Events } from '@/pages/Events'
import { Home } from '@/pages/Home'
import { NotFound } from '@/pages/NotFound'
import { AdminEventForm } from '@/pages/admin/AdminEventForm'
import { AdminEvents } from '@/pages/admin/AdminEvents'
import { AdminLayout } from '@/pages/admin/AdminLayout'
import { AdminSettings } from '@/pages/admin/AdminSettings'

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
        <Routes>
          <Route path="/" element={<Home events={events} settings={settings} />} />
          <Route path="/events" element={<Events events={events} />} />
          <Route path="/events/:slug" element={<EventDetail events={events} />} />
          <Route path="/about" element={<About settings={settings} />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminEvents />} />
            <Route path="events/new" element={<AdminEventForm settings={settings} />} />
            <Route path="events/:slug" element={<AdminEventForm settings={settings} />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
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
