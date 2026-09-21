import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, ImagePlus, Loader2, Save, Trash2 } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import { fetchAllEvents, saveEvent, type EventDraft } from '@/lib/data'
import { deriveSummary, ROLE_LABEL, slugify } from '@/lib/format'
import { fileToOptimisedDataUrl } from '@/lib/image'
import { useSite } from '@/lib/store'
import type { EventRecord, SiteSettings } from '@/lib/types'

const label = 'mb-2 block text-sm font-medium'
const input =
  'w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

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
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'cover' | 'gallery' | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)

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

  async function pickImage(file: File | undefined, target: 'cover' | 'gallery') {
    if (!file) return
    setUploading(target)
    setError(null)
    try {
      const dataUrl = await fileToOptimisedDataUrl(file)
      if (target === 'cover') update('cover_image', dataUrl)
      else update('gallery', [...draft.gallery, dataUrl])
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
            type="button"
            onClick={() => setPreview((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:text-primary"
          >
            <Eye className="h-4 w-4" /> {preview ? 'Hide preview' : 'Preview write-up'}
          </button>
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
            <label className={label} htmlFor="body">Write-up (Markdown)</label>
            <textarea
              id="body"
              rows={preview ? 12 : 24}
              className={`${input} font-mono text-[13px] leading-relaxed`}
              value={draft.body}
              onChange={(e) => update('body', e.target.value)}
              placeholder={'## Heading\n\nParagraph text. **Bold**, [links](https://example.com) and ![images](/images/events/example.jpg) all work.'}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Markdown is rendered as-is on the public page. Headings use <code>##</code> and{' '}
              <code>###</code>.
            </p>
          </div>

          {preview && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Preview
              </h3>
              {draft.body.trim() ? (
                <Markdown>{draft.body}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Publishing
            </h3>
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
              </div>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.featured}
                  onChange={(e) => update('featured', e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Feature on the home page
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-border p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              When and where
            </h3>
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

          <div className="rounded-2xl border border-border p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Cover image
            </h3>
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary"
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-destructive"
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
            </div>
          </div>

          <div className="rounded-2xl border border-border p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Gallery
            </h3>
            {draft.gallery.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {draft.gallery.map((src, i) => (
                  <button
                    key={src.slice(0, 60) + i}
                    type="button"
                    onClick={() => update('gallery', draft.gallery.filter((_, j) => j !== i))}
                    title="Remove this image"
                    className="group relative overflow-hidden rounded-lg border border-border"
                  >
                    <img src={src} alt="" className="aspect-square w-full object-cover" />
                    <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white group-hover:flex">
                      <Trash2 className="h-4 w-4" />
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => galleryInput.current?.click()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary"
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

          <div className="rounded-2xl border border-border p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Credit
            </h3>
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
