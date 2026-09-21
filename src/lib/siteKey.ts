/**
 * The key that opens the panel, as this browser holds it.
 *
 * There is no session and nothing to renew: the server keeps only a hash of the
 * key, so a browser that holds it can use it for as long as it likes. Two things
 * therefore take the place of signing out — clearing this browser's site data,
 * and the "forget this key" button in the panel.
 *
 * The subscribe part exists so the panel can react the moment the key changes,
 * and so that both backends behave alike: in the hosted deployment the key is
 * read by a call to the database, and locally by a call to the development API,
 * and neither of them can announce anything on the other's behalf.
 */

const STORAGE_KEY = 'dku-ai-club.site-key'

const listeners = new Set<() => void>()

/** The key this browser holds, or null when it holds none. */
export function readSiteKey(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Remembers a key, or forgets the current one when passed null. */
export function rememberSiteKey(key: string | null): void {
  try {
    if (key) window.localStorage.setItem(STORAGE_KEY, key)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private browsing can refuse storage; the key then lasts one page load.
  }
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // One broken listener must not stop the others.
    }
  }
}

export function onSiteKeyChange(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}
