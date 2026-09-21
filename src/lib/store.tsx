import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, fetchPublicEvents, fetchSettings, loadArchive } from './data'
import type { EventRecord, SiteSettings } from './types'

interface SiteStore {
  settings: SiteSettings
  events: EventRecord[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

const SiteContext = createContext<SiteStore>({
  settings: DEFAULT_SETTINGS,
  events: [],
  loading: true,
  error: null,
  reload: async () => {},
})

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS)
  const [events, setEvents] = useState<EventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [nextSettings, nextEvents] = await Promise.all([fetchSettings(), fetchPublicEvents()])
      setSettings(nextSettings)
      setEvents(nextEvents)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event library could not be loaded.')
      // The public pages should still be readable when the database is out of
      // reach, so fall back to the archive that ships inside the site bundle.
      // Its records are display-only: nothing can be edited from them.
      const archive = await loadArchive()
      setEvents(archive.filter((e) => e.status === 'published').sort((a, b) => (a.event_date < b.event_date ? 1 : -1)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <SiteContext.Provider value={{ settings, events, loading, error, reload }}>
      {children}
    </SiteContext.Provider>
  )
}

export function useSite() {
  return useContext(SiteContext)
}
