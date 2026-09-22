/**
 * The form that writes one event, used by both doors into the site.
 *
 * Without a `token` it is the panel's event form: it reads the library, opens
 * whichever event the address names, and can publish, draft or archive it.
 *
 * With a `token` it is what somebody holding a shared editing link sees. The
 * editor, the fields and the photographs are the same, because they are the
 * same job; what differs is the scope of the thing doing it. Three things
 * follow from that and are enforced by the server rather than here — the event
 * is fixed, its publishing state is fixed, and no other event exists. The form
 * hides the controls it cannot use so that nobody is offered a button that
 * would be refused, but hiding them is a courtesy, not the guard.
 *
 * One thing appears on the panel's side only: the version the last save
 * replaced, and the offer to put it back. A link does not show it, for the same
 * reason it cannot reach one — what an event said before somebody rewrote it is
 * not theirs to read.
 *
 * Written as one component and not two because the alternative is two copies of
 * a writing interface drifting apart, and the only thing anybody would notice
 * about that is that one of them stops working.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ImagePlus, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { LazyMarkdownEditor, type MarkdownEditorHandle } from './LazyMarkdownEditor'
import { EventRevision } from './EventRevision'
import { ShareLinks, ShareLinksPending } from './ShareLinks'
import {
  fetchAllEvents,
  isLinkFinished,
  openSharedEvent,
  readPreviousVersion,
  restorePreviousVersion,
  saveEvent,
  saveSharedEvent,
  storeImage,
  storeSharedImage,
  type EventDraft,
  type PreviousVersion,
} from '@/lib/data'
import { altFromFileName } from '@/lib/markdownEditor'
import { deriveSummary, ROLE_LABEL, slugify, STATUS_LABEL } from '@/lib/format'
import { useSite } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { EventRecord, SiteSettings } from '@/lib/types'

const label = 'mb-2 block text-sm font-medium'
const input =
  'w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'
const card = 'rounded-2xl border border-border p-5'
const cardTitle = 'text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground'
const smallButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:text-primary'

/**
 * The three states in the order the dropdown used to offer them: the most
 * visible first, the one that takes the event off the site last.
 */
const STATUSES: EventDraft['status'][] = ['published', 'draft', 'archived']

/**
 * What the state of an event means to somebody who was sent a link to write it
 * up, and who cannot change it. Put in their terms rather than in the panel's,
 * because the question they have is only whether their work is on the site yet.
 */
const STATE_NOTE: Record<EventDraft['status'], string> = {
  published: 'The event is on the public site, so a save here is public as soon as it is saved.',
  draft: 'The event is still a draft, so nothing written here is on the public site yet.',
  archived: 'The event is kept in the library and off the public site.',
}

/**
 * What a set of form values looks like as one string.
 *
 * Used only to answer "is this the same as what was saved?", which the plain
 * text of the values answers exactly and cheaply. Every update replaces a key
 * that already exists, so the order of the fields never changes and two equal
 * drafts always serialise to the same string.
 */
function fingerprint(values: EventDraft): string {
  return JSON.stringify(values)
}

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

/**
 * `token` is a shared editing link, and its presence is what makes this page
 * the writer's rather than the panel's.
 *
 * `onLinkFinished` is called when the server says the link no longer works —
 * expired, taken back, or never real. That is not a failed save to be reported
 * in a line above the form; it means the page is over, and only the page that
 * put this form on screen can replace itself with something that says so.
 */
export function EventEditor({
  settings,
  token,
  onLinkFinished,
}: {
  settings: SiteSettings
  token?: string
  onLinkFinished?: () => void
}) {
  const { slug } = useParams<{ slug: string }>()
  const isNew = !slug && !token
  const navigate = useNavigate()
  const { reload } = useSite()

  const [draft, setDraft] = useState<EventDraft>(emptyDraft)
  /**
   * The values as the page loaded them, or as the last save left them.
   *
   * Everything the form holds is measured against it, which is how the writer
   * is told that a save is outstanding. Kept as text rather than as a second
   * draft because the only question ever asked of it is whether it still
   * matches.
   */
  const [saved, setSaved] = useState(() => fingerprint(emptyDraft()))
  const [slugTouched, setSlugTouched] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState<'cover' | 'gallery' | null>(null)
  /**
   * The version of this event that the last save replaced, if there is one.
   *
   * Read separately from the event itself because it answers a different
   * question, and one only the panel asks: a link is not shown what the event
   * said before its holder touched it, and the server would not answer if it
   * asked.
   */
  const [previous, setPrevious] = useState<PreviousVersion | null>(null)
  const [restoring, setRestoring] = useState(false)
  const coverInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  /** The write-up, so a photograph in the gallery can be placed into it. */
  const writeUp = useRef<MarkdownEditorHandle>(null)
  /**
   * The page's way of reporting that the link this form was opened with is
   * finished. Held in a ref so that the effect that loads the event depends on
   * the link and not on the identity of a callback rebuilt on every render.
   */
  const linkFinished = useRef(onLinkFinished)
  useEffect(() => {
    linkFinished.current = onLinkFinished
  }, [onLinkFinished])

  const categories = useMemo(() => {
    const set = new Set(settings.categories)
    set.add('Event')
    return [...set]
  }, [settings.categories])

  /** Whether what the form holds has yet to reach the database. */
  const unsaved = fingerprint(draft) !== saved

  useEffect(() => {
    if (isNew) {
      const fresh = emptyDraft()
      setDraft(fresh)
      setSaved(fingerprint(fresh))
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    /*
      Two ways in, one shape out. The panel reads the whole library and picks
      its event out of it; a link asks for its own event by name, and the server
      answers about that one row. Neither can see what the other sees, and it
      matters that the second is not written as the first narrowed down.
    */
    const arriving: Promise<EventRecord | null> = token
      ? openSharedEvent(token)
      : fetchAllEvents().then((all) => all.find((e) => e.slug === slug) ?? null)
    void arriving
      .then((hit) => {
        if (!alive) return
        if (hit) {
          const loaded = toDraft(hit)
          setDraft(loaded)
          setSaved(fingerprint(loaded))
          setSlugTouched(true)
        } else {
          setError('That event could not be found.')
        }
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (token && isLinkFinished(err)) {
          linkFinished.current?.()
          return
        }
        setError(err instanceof Error ? err.message : 'Loading failed.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [slug, isNew, token])

  const readPrevious = useCallback(async () => {
    if (token || !slug) {
      setPrevious(null)
      return
    }
    try {
      setPrevious(await readPreviousVersion(slug))
    } catch {
      /*
        A kept version that cannot be read is not worth a sentence of its own.
        It is a copy of something already on screen, nothing about the form in
        front of the reader depends on it, and a red line here would report a
        failure of a feature nobody asked to use.
      */
      setPrevious(null)
    }
  }, [slug, token])

  useEffect(() => {
    setPrevious(null)
    void readPrevious()
  }, [readPrevious])

  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    // "Saved" stops being true the moment anything is typed over it, and a
    // green notice sitting above a red one is no help to anybody.
    setNotice(null)
  }

  /** The stem photographs of this event are named under, so the bucket stays readable. */
  function owner(): string {
    return draft.slug || slugify(draft.title) || 'event'
  }

  /**
   * Stores a photograph through whichever door this form was opened by.
   *
   * Both end in the same bucket and both come back as a URL; only the
   * credential differs, and it differs because it has to — a link's upload is
   * refused by the panel's door and the other way round.
   */
  function store(file: File, where: string): Promise<string> {
    return token ? storeSharedImage(token, file, where) : storeImage(file, where)
  }

  async function pickImage(file: File | undefined, target: 'cover' | 'gallery') {
    if (!file) return
    setUploading(target)
    setError(null)
    try {
      const url = await store(file, `${owner()}-${target}`)
      if (target === 'cover') update('cover_image', url)
      else update('gallery', [...draft.gallery, url])
    } catch (err) {
      if (token && isLinkFinished(err)) {
        linkFinished.current?.()
        return
      }
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
      /*
        The form's own values with the two things the save settles — the slug,
        and the summary falling back to the first paragraph — made explicit. It
        is what the panel then holds, so it is also what "unsaved" is measured
        against; the summary field itself is left as the writer left it, since
        the fallback is the database's business and not theirs to see change
        under their hands.
      */
      const settled: EventDraft = { ...draft, slug: finalSlug }
      const payload = { ...settled, summary: settled.summary.trim() || deriveSummary(settled.body) }
      if (token) {
        // What comes back is the row as it now stands, which is the only copy
        // that is certainly right: the two things this form cannot decide —
        // which event this is, and whether it is published — are the server's.
        const stored = await saveSharedEvent(token, payload)
        const after = toDraft(stored)
        setDraft(after)
        setSaved(fingerprint(after))
        setNotice(`Saved. ${STATE_NOTE[after.status]}`)
        return
      }
      await saveEvent(payload)
      await reload()
      /*
        Read back after every panel save, because a save moves the kept version
        on: what is on screen now has just become the thing worth having, and
        what was there before it is what the card should be offering.
      */
      await readPrevious()
      setNotice('Saved. The public site has been updated.')
      if (isNew) navigate(`/admin/events/${finalSlug}`, { replace: true })
      setSlugTouched(true)
      setDraft(settled)
      setSaved(fingerprint(settled))
    } catch (err) {
      if (token && isLinkFinished(err)) {
        linkFinished.current?.()
        return
      }
      setError(err instanceof Error ? err.message : 'That change could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Puts the kept version back in place of what the event says now.
   *
   * Asked about first, because it overwrites the form as well as the record:
   * anything written here and not saved is gone the moment it happens. The
   * sentence says which of those two situations the reader is in, since the
   * answer to "is this safe to press" is not the same for both.
   *
   * The server swaps the two versions rather than discarding one, so what is on
   * screen now becomes the kept version as this one arrives. That is what makes
   * this button safe enough to offer at all, and why the confirmation can say
   * so instead of asking the reader to be sure.
   */
  async function restore() {
    if (!slug) return
    const question = unsaved
      ? 'Put the kept version back? What is in the form now has not been saved, and it will be replaced.'
      : 'Put the kept version back? What the event says now is kept in its place, so this can be undone the same way.'
    if (!window.confirm(question)) return

    setRestoring(true)
    setError(null)
    setNotice(null)
    try {
      const back = toDraft(await restorePreviousVersion(slug))
      setDraft(back)
      setSaved(fingerprint(back))
      await reload()
      await readPrevious()
      setNotice('The earlier version is back. The public site has been updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That version could not be put back.')
    } finally {
      setRestoring(false)
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
        {/*
          The panel's way back, and its heading. Neither belongs on the page a
          link opens: there is no library to go back to, and the only event is
          the one already on screen.
        */}
        {!token && (
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
        )}
        <div className={cn('flex flex-wrap items-center gap-3', token && 'ml-auto')}>
          {/*
            Standing beside the button that clears it. A write-up is edited
            over many screens, and walking away with a save outstanding used to
            look exactly like walking away having saved.
          */}
          {unsaved && (
            <span
              role="status"
              className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs font-medium text-destructive"
            >
              Unsaved changes
            </span>
          )}
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

      {/*
        Panel only. The version this event held before its last save is the
        administrator's to see and to put back; somebody writing through a link
        is not shown what the event said before they touched it, and the server
        would not answer them if they asked.
      */}
      {!token && previous && (
        <EventRevision
          revision={previous}
          busy={restoring}
          onRestore={() => void restore()}
        />
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
                className={cn(input, token && 'bg-muted text-muted-foreground')}
                value={draft.slug}
                readOnly={Boolean(token)}
                onChange={(e) => {
                  setSlugTouched(true)
                  update('slug', slugify(e.target.value))
                }}
              />
            </div>
            {token && (
              <p className="mt-2 text-xs text-muted-foreground">
                The event’s address on the site. It is what this link was made for, so it is the one
                thing here that cannot be changed.
              </p>
            )}
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
            <LazyMarkdownEditor
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
            {token ? (
              /*
                No control here, because there is nothing to control: a link
                cannot publish, and offering the buttons anyway would only
                produce a refusal. What the writer is owed instead is the answer
                to the question they actually have — is my work on the site?
              */
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {STATE_NOTE[draft.status]} Whether this event appears on the public site is the
                club’s decision, and not one this page can change either way.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <span className={label}>Status</span>
                  {/*
                    All three at once, with the one in force lit. A dropdown hid
                    the other two behind a click, which made a decision that
                    matters — whether the event is on the site, off it, or not yet
                    written — look like a piece of data entry.
                  */}
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Status">
                    {STATUSES.map((value) => {
                      const active = draft.status === value
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => update('status', value)}
                          className={cn(
                            'rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                          )}
                        >
                          {STATUS_LABEL[value]}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {draft.status === 'published'
                      ? 'On the events list and reachable by its address.'
                      : draft.status === 'draft'
                        ? 'Held back until it is published, whatever its date.'
                        : 'Kept in the library, off the events list.'}{' '}
                    Which events the home page leads with is set on the Home page tab, not here.
                  </p>
                </div>
              </div>
            )}
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

          {/*
            Only for the panel, and only for an event that exists. A link is
            addressed to a record, so there is nothing to make one for until
            this event has been saved once — which is why the panel says that
            rather than offering a button that would be refused.
          */}
          {!token && (isNew ? <ShareLinksPending /> : <ShareLinks slug={draft.slug} />)}
        </div>
      </div>
    </form>
  )
}
