/* eslint-disable react-refresh/only-export-components --
   This is an entry point rather than a module: it mounts itself and exports
   nothing, which is the one shape the refresh rule does not allow for. */
/**
 * A page for trying the writing editor out, on its own.
 *
 * The panel needs the Worker, the database and the site key before it will open
 * at all, which makes it a poor place to judge whether a button is in the right
 * place. This page mounts the same editor with nothing behind it: photographs
 * are "uploaded" to a local address, and the stored Markdown and the published
 * rendering are shown beside the editor so the three can be compared.
 *
 * It is a development page. `preview.html` is not an entry in the production
 * build, so none of this reaches the deployed site.
 *
 *   PORT=5200 npm run dev   →   http://localhost:5200/preview.html
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Markdown } from '@/components/Markdown'
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/MarkdownEditor'
import '@/index.css'

const SAMPLE = `## The first session

The club's opening workshop ran for two hours in **CCTE 1011**, with *three*
demonstrations and a live build. It was <u>deliberately hands-on</u>: nothing was
presented that attendees could not immediately try for themselves.

![A crowded room at the opening workshop](/images/events/waic2026-delegation.jpg)

### What we covered

- How a language model is trained, at the level of a diagram
- Prompting as a technique rather than a trick
- [Ant Group's Lingbo model](https://www.antgroup.com/tech/article/236) as a case study

> The most useful part was watching something go wrong and being shown how to
> find out why.

Members left with a working notebook and a list of what to read next.`

interface ArchiveEvent {
  slug: string
  title: string
  body: string
}

function Preview() {
  const [source, setSource] = useState<ArchiveEvent[]>([])
  const [loaded, setLoaded] = useState('sample')
  const [original, setOriginal] = useState(SAMPLE)
  const [body, setBody] = useState(SAMPLE)
  const [log, setLog] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const editor = useRef<MarkdownEditorHandle>(null)

  useEffect(() => {
    void fetch('./content/events.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: ArchiveEvent[]) => setSource(rows))
      .catch(() => setLog((l) => ['The event archive could not be loaded.', ...l]))
  }, [])

  /**
   * Stands in for the upload endpoint: it waits, then answers with an address
   * for the same picture, so the placeholder being swapped for the stored one
   * can be watched without a server.
   */
  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setLog((l) => [`Uploading ${file.name}…`, ...l])
    await new Promise((resolve) => setTimeout(resolve, 800))
    setUploading(false)
    setLog((l) => [`Stored ${file.name}.`, ...l])
    return URL.createObjectURL(file)
    // The picture keeps this address for the life of the page.
  }, [])

  function load(key: string) {
    setLoaded(key)
    if (key === 'sample') {
      setOriginal(SAMPLE)
      setBody(SAMPLE)
      return
    }
    const hit = source.find((e) => e.slug === key)
    if (!hit) return
    setOriginal(hit.body)
    setBody(hit.body)
  }

  const lines = (text: string) => text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  const untouched = lines(body) === lines(original)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <header className="border-b border-border pb-6">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Development page
          </span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">The writing editor</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            The same editor the panel uses, with nothing behind it. Photographs pasted or dragged
            into the text are “uploaded” to a local address, so the whole flow can be watched
            without a server. The stored Markdown and the published rendering sit beside the editor
            so the three can be compared.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            <strong className="font-semibold text-foreground">To try it:</strong> select some words
            and press the bold or underline button; press Enter twice and start with{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">## </code> for a heading; copy a
            picture to the clipboard and paste it straight into the text.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium" htmlFor="load">
              Document
            </label>
            <select
              id="load"
              value={loaded}
              onChange={(e) => load(e.target.value)}
              className="rounded-xl border border-input bg-background px-4 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="sample">The sample write-up</option>
              {source.map((e) => (
                <option key={e.slug} value={e.slug}>
                  {e.title} ({e.body.length} characters)
                </option>
              ))}
            </select>
            <span
              className={
                untouched
                  ? 'rounded-full bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent'
                  : 'rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground'
              }
            >
              {untouched
                ? 'Identical to the stored copy'
                : 'Edited — the stored copy would change on save'}
            </span>
            {uploading && (
              <span className="text-xs text-muted-foreground">A photograph is being stored…</span>
            )}
          </div>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              In the editor
            </h2>
            <MarkdownEditor
              ref={editor}
              documentId={loaded}
              value={body}
              onChange={setBody}
              onUpload={upload}
              onError={(message) => setLog((l) => [message, ...l])}
              minHeightClass="min-h-[36rem]"
              // This page has no site header above the editor, so the bar
              // parks against the top of the window rather than below one.
              stickyOffsetClass="top-0"
              placeholder="A new write-up starts here."
            />
            <details className="mt-4 rounded-xl border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                What gets stored ({body.length} characters)
              </summary>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-muted-foreground">
                {body}
              </pre>
            </details>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              On the public page
            </h2>
            <div className="rounded-xl border border-border p-6">
              <Markdown>{body}</Markdown>
            </div>
            {log.length > 0 && (
              <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                {log.slice(0, 6).map((line, i) => (
                  <li key={line + i}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

const host = document.getElementById('root')
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  )
}
