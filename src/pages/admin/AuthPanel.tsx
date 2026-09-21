import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { openWithSiteKey } from '@/lib/data'

const inputClass =
  'w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

/**
 * The only way into the administrator panel: the site key.
 *
 * This page is public, so no check performed here would mean anything — anyone
 * who opened the page source could read the answer. The key is therefore sent to
 * the database, which compares it against a stored hash (`site_key_ok`) and is
 * the only party that knows whether it is right.
 */
export function AuthPanel({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await openWithSiteKey(key)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-primary">
          <KeyRound className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Administrator access</h1>
          <p className="text-sm text-muted-foreground">Enter the site key to edit the site.</p>
        </div>
      </div>

      {error && (
        <p className="mt-7 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-7 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium">Site key</span>
          <input
            type="password"
            required
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Unlock the panel
        </button>
      </form>

      <p className="mt-7 text-sm leading-relaxed text-muted-foreground">
        The key is checked by the server and kept in this browser, so the panel stays open until it
        is forgotten or the browser’s site data is cleared. Replacing the key — from this panel or
        from the database directly — is what closes the door on a key that has been shared too
        widely.
      </p>
    </div>
  )
}
