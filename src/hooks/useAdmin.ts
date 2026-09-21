import { useCallback, useEffect, useRef, useState } from 'react'
import { onSiteKeyChange } from '@/lib/siteKey'
import { readAdminState, type AdminState } from '@/lib/data'

/**
 * Tracks whether this browser can open the panel.
 *
 * There is no session to watch: the answer depends on the key the browser holds,
 * so the hook re-reads whenever that key changes — when a key is accepted, when
 * it is replaced, and when it is forgotten. The database is asked each time,
 * because a key can be replaced from another machine.
 */
export function useAdmin() {
  const [state, setState] = useState<AdminState | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const next = await readAdminState()
      if (mounted.current) setState(next)
    } catch {
      if (mounted.current) {
        setState({ hasKey: false, isAdmin: false })
      }
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const unsubscribe = onSiteKeyChange(() => {
      void refresh()
    })
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [refresh])

  return { state, loading, refresh }
}
