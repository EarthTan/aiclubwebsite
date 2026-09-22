import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, KeyRound, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { LazyMarkdownEditor } from '@/components/LazyMarkdownEditor'
import { saveSettings, replaceSiteKey, storeImage } from '@/lib/data'
import { useSite } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { SiteSettings } from '@/lib/types'

const label = 'mb-2 block text-sm font-medium'
const input =
  'w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

/**
 * A card whose contents are put away until they are asked for.
 *
 * The about copy and the club history are each a heading, a paragraph and a
 * full writing surface, and between them they ran to several screens — the
 * settings somebody comes to this page for were somewhere below them. The whole
 * heading row is the way in, rather than a small arrow beside it.
 *
 * What is inside is not rendered while the card is shut, which keeps four
 * writing surfaces off the page until they are wanted. That is safe because the
 * form saves the draft it holds in state rather than reading values back off
 * the page, and an edit is written into that draft as it is typed — so shutting
 * a card loses nothing, including its own unfinished work, which is back in
 * place the moment it is opened again.
 */
function FoldedSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-6 rounded-2xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center justify-between gap-4 rounded-2xl p-5 text-left"
      >
        <span className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors group-hover:text-foreground">
          {title}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

export function AdminSettings() {
  const { settings, reload } = useSite()
  const [draft, setDraft] = useState<SiteSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [currentKey, setCurrentKey] = useState('')
  const [nextKey, setNextKey] = useState('')
  const [replacingKey, setReplacingKey] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyNotice, setKeyNotice] = useState<string | null>(null)

  // The provider loads settings asynchronously; adopt them once they arrive.
  useEffect(() => {
    setDraft(settings)
  }, [settings])

  function update<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await saveSettings(draft)
      await reload()
      setNotice('Saved. The public site has been updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const keyReady = currentKey.length > 0 && nextKey.trim().length >= 24

  async function replaceKey() {
    setReplacingKey(true)
    setKeyError(null)
    setKeyNotice(null)
    try {
      await replaceSiteKey(currentKey, nextKey)
      setCurrentKey('')
      setNextKey('')
      setKeyNotice(
        'The key has been replaced. This browser is already using the new one; every other copy of the old key has stopped working.',
      )
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'The key could not be replaced.')
    } finally {
      setReplacingKey(false)
    }
  }

  /** A fresh key, produced here so that nobody has to invent 24+ characters. */
  function suggestKey() {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    const body = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    setNextKey(`dkuaiclub-${body}`)
  }

  return (
    <form onSubmit={submit} className="pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Site settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The wording shown across the public pages, and the key that protects this panel.
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save site copy
        </button>
      </div>

      {error && (
        <p className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-6 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Identity
          </h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className={label} htmlFor="club">Club name</label>
              <input id="club" className={input} value={draft.club_name}
                onChange={(e) => update('club_name', e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="tagline">Tagline</label>
              <input id="tagline" className={input} value={draft.tagline}
                onChange={(e) => update('tagline', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Contact
          </h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className={label} htmlFor="email">Email address</label>
              <input id="email" type="email" className={input} value={draft.contact_email}
                onChange={(e) => update('contact_email', e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="note">Joining note</label>
              <textarea id="note" rows={3} className={input} value={draft.contact_note}
                onChange={(e) => update('contact_note', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <FoldedSection title="About the club">
        <div className="space-y-4">
          <div>
            <label className={label} htmlFor="atitle">Heading</label>
            <input id="atitle" className={input} value={draft.about_title}
              onChange={(e) => update('about_title', e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="alead">Short intro (home page)</label>
            <textarea id="alead" rows={3} className={input} value={draft.about_lead}
              onChange={(e) => update('about_lead', e.target.value)} />
            <p className="mt-2 text-xs text-muted-foreground">
              Two sentences, shown beside the heading on the home page.
            </p>
          </div>
          <div>
            <span className={label}>Body (Markdown)</span>
            <LazyMarkdownEditor
              documentId="about-body"
              value={draft.about_body}
              onChange={(about_body) => update('about_body', about_body)}
              onUpload={(file) => storeImage(file, 'site-about')}
              onError={setError}
              minHeightClass="min-h-[18rem]"
              placeholder="The full introduction, shown on the about page."
            />
            <p className="mt-2 text-xs text-muted-foreground">
              The full introduction, shown on the about page.
            </p>
          </div>
        </div>
      </FoldedSection>

      <FoldedSection title="Club history">
        <div className="space-y-4">
          <div>
            <label className={label} htmlFor="histtitle">Page heading</label>
            <input id="histtitle" className={input} value={draft.history_title}
              onChange={(e) => update('history_title', e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="histlead">Page introduction</label>
            <textarea id="histlead" rows={3} className={input} value={draft.history_lead}
              onChange={(e) => update('history_lead', e.target.value)} />
            <p className="mt-2 text-xs text-muted-foreground">
              One paragraph, standing between the heading and the timeline.
            </p>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-[14rem] flex-1 text-xs text-muted-foreground">
            Phases run oldest first. Each body is Markdown, so a phase can carry several paragraphs —
            separate them with a blank line.
          </p>
          {/* Adding a phase belongs inside the section rather than on its lid:
              a new entry is only visible once the list below is open. */}
          <button
            type="button"
            onClick={() =>
              update('history', [...draft.history, { period: '', title: '', body: '' }])
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Add entry
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {draft.history.map((h, i) => (
            <div key={i} className="grid gap-3 rounded-xl bg-secondary/40 p-4 md:grid-cols-[10rem_1fr_auto]">
              <input
                className={input}
                value={h.period}
                placeholder="January – May 2025"
                onChange={(e) =>
                  update('history', draft.history.map((x, j) => (j === i ? { ...x, period: e.target.value } : x)))
                }
              />
              <div className="space-y-3">
                <input
                  className={input}
                  value={h.title}
                  placeholder="Headline for this period"
                  onChange={(e) =>
                    update('history', draft.history.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                />
                <LazyMarkdownEditor
                  documentId={`history-${i}`}
                  value={h.body}
                  onChange={(body) =>
                    update('history', draft.history.map((x, j) => (j === i ? { ...x, body } : x)))
                  }
                  onUpload={(file) => storeImage(file, 'site-history')}
                  onError={setError}
                  minHeightClass="min-h-[18rem]"
                  placeholder="What happened in this period."
                />
              </div>
              <button
                type="button"
                onClick={() => update('history', draft.history.filter((_, j) => j !== i))}
                className="self-start rounded-lg border border-border p-2 text-destructive hover:border-destructive/50"
                title="Remove this entry"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {draft.history.length === 0 && (
            <p className="text-sm text-muted-foreground">No history entries yet.</p>
          )}
        </div>
      </FoldedSection>

      <div className="mt-6 rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            External links
          </h3>
          <button
            type="button"
            onClick={() => update('links', [...draft.links, { label: '', url: '' }])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Add link
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {draft.links.map((l, i) => (
            <div key={i} className="flex gap-3">
              <input
                className={input}
                value={l.label}
                placeholder="Label"
                onChange={(e) =>
                  update('links', draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
              />
              <input
                className={input}
                value={l.url}
                placeholder="https://"
                onChange={(e) =>
                  update('links', draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                }
              />
              <button
                type="button"
                onClick={() => update('links', draft.links.filter((_, j) => j !== i))}
                className="shrink-0 rounded-lg border border-border p-2.5 text-destructive hover:border-destructive/50"
                title="Remove this link"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Event categories
        </h3>
        <div className="mt-4">
          <input
            className={input}
            value={draft.categories.join(', ')}
            onChange={(e) =>
              update(
                'categories',
                e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              )
            }
            placeholder="Workshop, Talk, Info Session, Hackathon, Field Trip"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Comma-separated. These appear as suggestions when creating or editing an event.
          </p>
        </div>
      </div>

      {/* The whole page is one form, so this card cannot bring its own: its
          button is typed as a plain button, and Enter inside its fields is
          intercepted, so that neither can end up saving the site copy. */}
      <div className="mt-6 rounded-2xl border border-border p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Site key
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The key is the whole of the access system: whoever holds it can edit the site, and there
          is no account or mailbox behind it. The database stores only a hash of the key, so it
          cannot be read back out — keep the current text somewhere safe, because losing it means
          replacing it from the database.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Replacing it retires every copy at once. The browser that performs the replacement is
          switched over immediately and keeps working; anyone else holding the old key is stopped
          at their next click.
        </p>

        {keyError && (
          <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {keyError}
          </p>
        )}
        {keyNotice && !keyError && (
          <p className="mt-4 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent">
            {keyNotice}
          </p>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div>
            <label className={label} htmlFor="key-current">
              Current key
            </label>
            <input
              id="key-current"
              type="password"
              className={input}
              autoComplete="off"
              value={currentKey}
              onChange={(e) => setCurrentKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (keyReady) void replaceKey()
              }}
            />
          </div>
          <div>
            <label className={label} htmlFor="key-next">
              New key
            </label>
            <input
              id="key-next"
              className={`${input} font-mono text-[13px]`}
              autoComplete="off"
              spellCheck={false}
              value={nextKey}
              onChange={(e) => setNextKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (keyReady) void replaceKey()
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => void replaceKey()}
            disabled={replacingKey || !keyReady}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {replacingKey ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            Replace key
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            At least 24 characters. Letters, digits and punctuation all work.
          </p>
          <button
            type="button"
            onClick={suggestKey}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary"
          >
            <KeyRound className="h-3.5 w-3.5" /> Suggest one
          </button>
        </div>
      </div>
    </form>
  )
}
