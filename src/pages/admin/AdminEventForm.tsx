import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ImagePlus, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/MarkdownEditor'
import { fetchAllEvents, saveEvent, storeImage, type EventDraft } from '@/lib/data'
import { altFromFileName } from '@/lib/markdownEditor'
import { deriveSummary, ROLE_LABEL, slugify } from '@/lib/format'
import { useSite } from '@/lib/store'
import type { EventRecord, SiteSettings } from '@/lib/types'

const label = 'mb-2 block text-sm font-medium'
const input =
  'w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'
const card = 'rounded-2xl border border-border p-5'
const cardTitle = 'text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground'
const smallButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary'

function emptyDraft(): EventDraft {
  return {
    slug: '',
    title: '',
    summary: '',
    body: '',
    category: 'Workshop',
    event_date: new Date().toISOString().slice(0, 10),
    location: null,
    cover_image: null,
    gallery: [],
    tags: [],
    role: 'host',
    status: 'draft',
    // Carried through the form but never shown. The column still exists in the
    // library, and a save writes every field, so dropping it here would clear a
    // value that predates the home page having its own selection.
    featured: false,
    source_url: null,
    source_credit: null,
  }
}

function toDraft(e: EventRecord): EventDraft {
  return {
    slug: e.slug,
    title: e.title,
    summary: e.summary,
    body: e.body,
    category: e.category,
    event_date: e.event_date,
    location: e.location ?? null,
    cover_image: e.cover_image ?? null,
    gallery: e.gallery,
    tags: e.tags,
    role: e.role,
    status: e.status,
    featured: e.featured,
    source_url: e.source_url ?? null,
    source_credit: e.source_credit ?? null,
  }
}

export function AdminEventForm({ settings }: { settings: SiteSettings }) {
  const { slug } = useParams<{ slug: string }>()
  const isNew = !slug
  const navigate = useNavigate()
  const { reload } = useSite()

  const [draft, setDraft] = useState<EventDraft>(emptyDraft)
  const [slugTouched, setSlugTouched] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'cover' | 'gallery' | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  /** The write-up, so a photograph in the gallery can be placed into it. */
  const writeUp = useRef<MarkdownEditorHandle>(null)

  const categories = useMemo(() => {
    const set = new Set(settings.categories)
    set.add('Event')
    return [...set]
  }, [settings.categories])

  useEffect(() => {
    if (isNew) {
      setDraft(emptyDraft())
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void fetchAllEvents()
      .then((all) => {
        if (!alive) return
        const hit = all.find((e) => e.slug === slug)
        if (hit) {
          setDraft(toDraft(hit))
          setSlugTouched(true)
        } else {
          setError('That event could not be found.')
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Loading failed.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [slug, isNew])

  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  /** The stem photographs of this event are named under, so the bucket stays readable. */
  function owner(): string {
    return draft.slug || slugify(draft.title) || 'event'
  }

  async function pickImage(file: File | undefined, target: 'cover' | 'gallery') {
    if (!file) return
    setUploading(target)
    setError(null)
    try {
      const url = await storeImage(file, `${owner()}-${target}`)
      if (target === 'cover') update('cover_image', url)
      else update('gallery', [...draft.gallery, url])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be processed.')
    } finally {
      setUploading(null)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const finalSlug = (draft.slug || slugify(draft.title)).trim()
    if (!draft.title.trim()) {
      setError('A title is required.')
      return
    }
    if (!draft.event_date) {
      setError('An event date is required.')
      return
    }
    setSaving(true)
    try {
      await saveEvent({
        ...draft,
        slug: finalSlug,
        summary: draft.summary.trim() || deriveSummary(draft.body),
      })
      await reload()
      setNotice('Saved. The public site has been updated.')
      if (isNew) navigate(`/admin/events/${finalSlug}`, { replace: true })
      setSlugTouched(true)
      setDraft((d) => ({ ...d, slug: finalSlug }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the event…
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="pb-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/admin"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" /> Back to the event library
          </Link>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            {isNew ? 'Create a new event' : 'Edit event'}
          </h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save event
          </button>
        </div>
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

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-6">
          <div>
            <label className={label} htmlFor="title">Title</label>
            <input
              id="title"
              className={input}
              value={draft.title}
              onChange={(e) => {
                update('title', e.target.value)
                if (!slugTouched) update('slug', slugify(e.target.value))
              }}
              placeholder="Beyond ChatGPT: a brief history of artificial intelligence"
            />
          </div>

          <div>
            <label className={label} htmlFor="slug">URL slug</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">/events/</span>
              <input
                id="slug"
                className={input}
                value={draft.slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  update('slug', slugify(e.target.value))
                }}
              />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="summary">Summary</label>
            <textarea
              id="summary"
              rows={3}
              className={input}
              value={draft.summary}
              onChange={(e) => update('summary', e.target.value)}
              placeholder="One or two sentences shown on the event cards. Left blank, it is taken from the first paragraph."
            />
          </div>

          <div>
            <label className={label}>Write-up</label>
            <MarkdownEditor
              ref={writeUp}
              documentId={slug ?? 'new'}
              value={draft.body}
              onChange={(body) => update('body', body)}
              onUpload={(file) => storeImage(file, `${owner()}-body`)}
              onError={setError}
              minHeightClass="min-h-[34rem]"
              placeholder="Write the event up here. Paste or drag photographs straight in."
            />
            <p className="mt-2 text-xs text-muted-foreground">
              The write-up as it will appear on the page. Photographs can be pasted or dragged into
              the text; each one is shrunk and stored as it arrives. Headings are set with the
              heading buttons, and the Markdown switch shows the markup underneath.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className={card}>
            <h3 className={cardTitle}>Publishing</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className={label} htmlFor="status">Status</label>
                <select
                  id="status"
                  className={input}
                  value={draft.status}
                  onChange={(e) => update('status', e.target.value as EventDraft['status'])}
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived (hidden)</option>
                </select>
                <p className="mt-2 text-xs text-muted-foreground">
                  Which events the home page leads with is set on the Home page tab, not here.
                </p>
              </div>
            </div>
          </div>

          <div className={card}>
            <h3 className={cardTitle}>When and where</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className={label} htmlFor="date">Date</label>
                <input
                  id="date"
                  type="date"
                  className={input}
                  value={draft.event_date}
                  onChange={(e) => update('event_date', e.target.value)}
                />
              </div>
              <div>
                <label className={label} htmlFor="location">Location</label>
                <input
                  id="location"
                  className={input}
                  value={draft.location ?? ''}
                  onChange={(e) => update('location', e.target.value || null)}
                  placeholder="CCTE 1011"
                />
              </div>
              <div>
                <label className={label} htmlFor="category">Category</label>
                <input
                  id="category"
                  list="event-categories"
                  className={input}
                  value={draft.category}
                  onChange={(e) => update('category', e.target.value)}
                />
                <datalist id="event-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={label} htmlFor="role">Our role</label>
                <select
                  id="role"
                  className={input}
                  value={draft.role}
                  onChange={(e) => update('role', e.target.value as EventDraft['role'])}
                >
                  {(Object.keys(ROLE_LABEL) as EventDraft['role'][]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className={card}>
            <h3 className={cardTitle}>Cover image</h3>
            <div className="mt-4">
              {draft.cover_image ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <img src={draft.cover_image} alt="" className="aspect-[16/10] w-full object-cover" />
                </div>
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                  No cover image yet
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => coverInput.current?.click()}
                  className={smallButton}
                >
                  {uploading === 'cover' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  Upload
                </button>
                {draft.cover_image && (
                  <button
                    type="button"
                    onClick={() => update('cover_image', null)}
                    className={`${smallButton} text-destructive`}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>
              <input
                ref={coverInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void pickImage(e.target.files?.[0], 'cover')
                  e.target.value = ''
                }}
              />
              <input
                className={`${input} mt-3`}
                value={draft.cover_image && !draft.cover_image.startsWith('data:') ? draft.cover_image : ''}
                onChange={(e) => update('cover_image', e.target.value || null)}
                placeholder="…or paste an image URL"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                The card and banner image. Landscape works best.
              </p>
            </div>
          </div>

          <div className={card}>
            <h3 className={cardTitle}>Gallery</h3>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              The photographs shown as “More from this event” at the foot of the page. Each one can
              also be placed in the write-up itself, from here.
            </p>

            {draft.gallery.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {draft.gallery.map((src, i) => (
                  <div key={src + i} className="group relative overflow-hidden rounded-lg border border-border">
                    <img src={src} alt="" className="aspect-[4/3] w-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        title="Place this photograph in the write-up"
                        onClick={() => writeUp.current?.insertImage(src, altFromFileName(src))}
                        className="inline-flex items-center gap-1 rounded-lg bg-background px-2.5 py-1.5 text-xs font-semibold hover:text-primary"
                      >
                        <Plus className="h-3 w-3" /> Insert
                      </button>
                      <button
                        type="button"
                        title="Remove this photograph from the gallery"
                        onClick={() => update('gallery', draft.gallery.filter((_, j) => j !== i))}
                        className="rounded-lg bg-background p-1.5 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => galleryInput.current?.click()}
              className={`mt-3 ${smallButton}`}
            >
              {uploading === 'gallery' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              Add images
            </button>
            <input
              ref={galleryInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                for (const f of files) await pickImage(f, 'gallery')
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Uploaded images are downscaled and stored with the event record.
            </p>
          </div>

          <div className={card}>
            <h3 className={cardTitle}>Credit</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className={label} htmlFor="credit">Originally published by</label>
                <input
                  id="credit"
                  className={input}
                  value={draft.source_credit ?? ''}
                  onChange={(e) => update('source_credit', e.target.value || null)}
                  placeholder="Leave blank for our own write-ups"
                />
              </div>
              <div>
                <label className={label} htmlFor="source">Link to the original</label>
                <input
                  id="source"
                  type="url"
                  className={input}
                  value={draft.source_url ?? ''}
                  onChange={(e) => update('source_url', e.target.value || null)}
                  placeholder="https://"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
