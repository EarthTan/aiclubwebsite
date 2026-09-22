/**
 * The writing surface of the administrator panel.
 *
 * What it is not: a text box holding Markdown. Headings, bold, italics,
 * underline, lists, quotes and photographs all appear as they will appear on the
 * public page while they are being written, and photographs arrive by being
 * pasted or dragged in, the way they do in a word processor. Markdown remains
 * the format stored and the format served — it is simply no longer what the
 * writer has to look at, and it stays reachable behind the "Markdown" switch for
 * anyone who would rather work in it.
 *
 * The element being edited carries the same `.article-body` class the published
 * write-up carries, so what is on screen is set in the site's own typography
 * rather than in an approximation of it.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Eye,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Pencil,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react'
import {
  altFromFileName,
  canMoveImage,
  editorExtensions,
  moveImage,
  sameMarkdown,
} from '@/lib/markdownEditor'
import { cn } from '@/lib/utils'
// The base rules ProseMirror expects to find: without the first of these the
// writing area collapses its whitespace and paragraphs run together.
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'

export interface MarkdownEditorHandle {
  /** Puts a photograph into the write-up at the cursor, wherever that now is. */
  insertImage: (src: string, alt?: string) => void
  focus: () => void
}

export interface MarkdownEditorProps {
  /** The write-up, as Markdown. The single source of truth for its contents. */
  value: string
  onChange: (markdown: string) => void
  /**
   * Stores one photograph and answers with the address it is served from.
   *
   * A pasted picture is shown immediately under a temporary address of its own
   * and swapped for the real one when this settles, so writing is not stopped by
   * the upload.
   */
  onUpload: (file: File) => Promise<string>
  /**
   * Which write-up is open. When this changes the incoming value replaces the
   * document outright, rather than counting as an edit to the one already loaded.
   */
  documentId: string
  placeholder?: string
  /** Tailwind height utilities for the writing area, e.g. `min-h-[32rem]`. */
  minHeightClass?: string
  /**
   * Where the controls park while the write-up scrolls past, e.g. `top-16`.
   *
   * The default clears the site header, which is what the panel sits beneath.
   * A page without that header wants `top-0`, or the bar will hang a header's
   * height below the top of the window with the page showing through above it.
   */
  stickyOffsetClass?: string
  onError?: (message: string) => void
  className?: string
}

/**
 * The Markdown a document currently holds.
 *
 * Reached through a narrow cast because `tiptap-markdown` hangs its API off
 * `storage` without declaring it on the editor type.
 */
function markdownOf(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } }
  return storage.markdown?.getMarkdown?.() ?? ''
}

/** Every picture among a paste or a drop, in the order it arrived. */
function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const chosen = Array.from(data.files ?? [])
  const collected = chosen.length
    ? chosen
    : Array.from(data.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null)
  return collected.filter((file) => file.type.startsWith('image/'))
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

function release(address: string | null): void {
  if (address?.startsWith('blob:')) URL.revokeObjectURL(address)
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

function ToolButton({
  onClick,
  active = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // Without this the editor loses its selection the moment the button takes
      // focus, and the command that follows lands on a collapsed cursor instead
      // of on the words that were highlighted.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
        'hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-secondary text-primary',
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
}

function ToolGroup({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-0.5">{children}</span>
}

const SMALL_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium'

/* -------------------------------------------------------------------------- */
/* The editor                                                                 */
/* -------------------------------------------------------------------------- */

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      onChange,
      onUpload,
      documentId,
      placeholder,
      minHeightClass,
      stickyOffsetClass = 'top-16',
      onError,
      className,
    },
    ref,
  ) {
    const [mode, setMode] = useState<'rich' | 'source'>('rich')
    const [uploads, setUploads] = useState(0)
    const [dropping, setDropping] = useState(false)
    const [linkOpen, setLinkOpen] = useState(false)
    const [linkDraft, setLinkDraft] = useState('')

    const bodyInput = useRef<HTMLInputElement>(null)
    const replaceInput = useRef<HTMLInputElement>(null)
    const shell = useRef<HTMLDivElement>(null)

    /**
     * The editor, reachable from callbacks that were built before it existed.
     *
     * The editor is created on a later render than the one that defines the
     * paste and drop handlers, so those handlers cannot close over it directly —
     * they would hold the `null` of the first pass forever. The ref is the way
     * across that gap.
     */
    const editorRef = useRef<Editor | null>(null)

    /**
     * What the parent last handed in. Held in a ref so the editor's own
     * callbacks — which were built once and never rebuilt — read the current
     * props rather than the ones captured on the first pass.
     */
    const latest = useRef({ onChange, onUpload, onError })

    const seen = useRef({ markdown: value, documentId })
    const editor = useEditor(
      {
        extensions: editorExtensions(placeholder),
        content: value,
        // The panel is client-only, but rendering nothing on the first pass also
        // keeps the editor out of any render attempted without a DOM.
        immediatelyRender: false,
        editorProps: {
          attributes: { class: cn('article-body md-editor-body', minHeightClass) },
          // Holding Alt and pressing an arrow key moves the block the cursor is
          // standing on. It only answers for a picture, so the same keys keep
          // whatever meaning the system gave them everywhere else.
          handleKeyDown: (view, event) => {
            if (!event.altKey) return false
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
            if (!moveImage(view, event.key === 'ArrowUp' ? -1 : 1)) return false
            event.preventDefault()
            return true
          },
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData)
            if (!files.length) return false
            event.preventDefault()
            void accept(files, 'cursor')
            return true
          },
          handleDrop: (_view, event, _slice, moved) => {
            if (moved) return false
            const files = imageFiles((event as DragEvent).dataTransfer)
            if (!files.length) return false
            event.preventDefault()
            setDropping(false)
            void accept(files, 'cursor')
            return true
          },
        },
        onUpdate: ({ editor: current }) => {
          const markdown = markdownOf(current)
          seen.current.markdown = markdown
          latest.current.onChange(markdown)
        },
      },
      // Built once. Everything that can change later — the value, the props, the
      // document — is handled below rather than by rebuilding the editor, which
      // would throw away the undo history on every keystroke.
      [],
    )

    // Both refs are filled here rather than during render: React is entitled to
    // render a component it does not commit, and a ref written on the way past
    // would then point at an editor that is not on the page.
    useEffect(() => {
      latest.current = { onChange, onUpload, onError }
    })

    useEffect(() => {
      editorRef.current = editor ?? null
    }, [editor])

    /**
     * Keep the editor in step with the value it was handed.
     *
     * Four cases, and the differences matter. While the Markdown source is on
     * screen that text is the authority, and it is only parsed in when the
     * formatted view comes back. A different write-up replaces the document
     * outright. Our own edit arriving back as a prop is ignored. And a value that
     * changed from outside — the settings page loading, most of the time — is
     * parsed in. Nothing is written back in the first two cases, so opening a
     * write-up and touching nothing leaves the stored Markdown exactly as it was.
     */
    useEffect(() => {
      if (!editor) return
      const known = seen.current

      // While the Markdown source is on screen, it is the authority. Its text is
      // parsed in when the formatted view comes back, not on every keystroke.
      if (mode === 'source') {
        known.markdown = value
        return
      }

      // A different write-up: replace the document outright, whatever the two
      // happen to have in common.
      if (known.documentId !== documentId) {
        known.documentId = documentId
        known.markdown = value
        editor.commands.setContent(value, { emitUpdate: false })
        return
      }

      // Our own edit, arriving back as a prop.
      if (value === known.markdown) return

      // A value that changed from outside — the settings page finishing its
      // load, most of the time.
      known.markdown = value
      if (sameMarkdown(markdownOf(editor), value)) return
      editor.commands.setContent(value, { emitUpdate: false })
    }, [editor, value, documentId, mode])

    /* ---------------------------------------------------------------------- */
    /* Photographs                                                            */
    /* ---------------------------------------------------------------------- */

    /** Swaps one picture's address, wherever in the document it has since moved. */
    const rewriteImage = useCallback((from: string, to: string | null) => {
      const current = editorRef.current
      if (!current || current.isDestroyed) return
      const { state, view } = current
      let found = -1
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === from) {
          found = pos
          return false
        }
        return true
      })
      if (found < 0) return
      const node = state.doc.nodeAt(found)
      if (!node) return
      view.dispatch(
        to === null
          ? state.tr.delete(found, found + node.nodeSize)
          : state.tr.setNodeMarkup(found, undefined, { ...node.attrs, src: to }),
      )
    }, [])

    const uploadOne = useCallback(
      (file: File, local: string, superseded: string | null) => {
        setUploads((n) => n + 1)
        latest.current
          .onUpload(file)
          .then((url) => {
            release(superseded)
            rewriteImage(local, url)
          })
          .catch((error: unknown) => {
            rewriteImage(local, null)
            latest.current.onError?.(
              error instanceof Error ? error.message : 'That photograph could not be uploaded.',
            )
          })
          .finally(() => {
            // Safe in every branch: by now nothing on screen points here.
            release(local)
            setUploads((n) => Math.max(0, n - 1))
          })
      },
      [rewriteImage],
    )

    /** Puts chosen or pasted photographs into the write-up. */
    const accept = useCallback(
      (files: File[], target: 'cursor' | 'replace') => {
        const current = editorRef.current
        if (!current || current.isDestroyed) return

        for (const file of files) {
          const local = URL.createObjectURL(file)

          if (target === 'replace' && current.isActive('image')) {
            const { state, view } = current
            const selection = state.selection
            if (selection instanceof NodeSelection) {
              const superseded = (selection.node.attrs.src as string) ?? null
              view.dispatch(
                state.tr.setNodeMarkup(selection.from, undefined, {
                  ...selection.node.attrs,
                  src: local,
                }),
              )
              uploadOne(file, local, superseded)
              continue
            }
          }

          current.chain().focus().setImage({ src: local, alt: altFromFileName(file.name) }).run()
          uploadOne(file, local, null)
        }
      },
      [uploadOne],
    )

    /* ---------------------------------------------------------------------- */
    /* Commands the rest of the panel uses                                    */
    /* ---------------------------------------------------------------------- */

    const insertImage = useCallback((src: string, alt = '') => {
      editorRef.current?.chain().focus().setImage({ src, alt }).run()
    }, [])

    useImperativeHandle(
      ref,
      () => ({ insertImage, focus: () => editorRef.current?.commands.focus('end') }),
      [insertImage],
    )

    /* ---------------------------------------------------------------------- */
    /* State the toolbar reads                                                */
    /* ---------------------------------------------------------------------- */

    const state = useEditorState({
      editor,
      selector: ({ editor: current }) => {
        if (!current) return null
        const image = current.isActive('image')
          ? (current.getAttributes('image') as { src?: string; alt?: string })
          : null
        return {
          bold: current.isActive('bold'),
          italic: current.isActive('italic'),
          underline: current.isActive('underline'),
          strike: current.isActive('strike'),
          heading: current.isActive('heading'),
          h2: current.isActive('heading', { level: 2 }),
          h3: current.isActive('heading', { level: 3 }),
          bullet: current.isActive('bulletList'),
          ordered: current.isActive('orderedList'),
          quote: current.isActive('blockquote'),
          link: current.isActive('link'),
          canUndo: current.can().undo(),
          canRedo: current.can().redo(),
          imageSrc: image?.src ?? null,
          imageAlt: image?.alt ?? '',
          // Read off the state itself, so the arrows grey out at the ends of the
          // write-up rather than sitting there doing nothing when pressed.
          imageCanUp: canMoveImage(current.state, -1),
          imageCanDown: canMoveImage(current.state, 1),
        }
      },
    })

    /* ---------------------------------------------------------------------- */
    /* Named actions, so the markup below stays declarative                   */
    /* ---------------------------------------------------------------------- */

    function applyLink() {
      const current = editorRef.current
      if (!current) return
      const href = linkDraft.trim()
      if (!href) {
        current.chain().focus().unsetLink().run()
      } else {
        current.chain().focus().extendMarkRange('link').setLink({ href }).run()
      }
      setLinkOpen(false)
    }

    function toggleSource() {
      if (mode === 'rich') {
        setMode('source')
        return
      }
      editorRef.current?.commands.setContent(seen.current.markdown, { emitUpdate: false })
      setMode('rich')
    }

    function setImageAlt(alt: string) {
      const current = editorRef.current
      if (!current || current.isDestroyed) return
      const { state, view } = current
      const selection = state.selection
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return
      view.dispatch(
        state.tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, alt }),
      )
    }

    function removeSelectedImage() {
      const current = editorRef.current
      if (!current || current.isDestroyed) return
      const { state, view } = current
      const selection = state.selection
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return
      view.dispatch(state.tr.delete(selection.from, selection.to))
    }

    /**
     * The dependable way to reposition a photograph.
     *
     * Dragging is the pleasant way, and the grip exists to advertise it, but a
     * drag depends on the browser and the pointer behaving as expected. A button
     * does not, which also makes the order adjustable from a trackpad without a
     * steady hand.
     */
    function nudgeSelectedImage(direction: -1 | 1) {
      const current = editorRef.current
      if (!current || current.isDestroyed) return
      moveImage(current.view, direction)
    }

    const shortcut = isMac() ? '⌘' : 'Ctrl+'

    /* ---------------------------------------------------------------------- */

    return (
      <div className={className}>
        {/*
          The controls stay on screen while the write-up scrolls past them.

          A write-up runs to many screens, and a bar that leaves the top of the
          window is a bar that has to be scrolled back to; reaching for bold on
          the fourth screen should not cost the first. The row that sets a link
          and the row that describes a photograph are pinned with it, because
          both are filled in while looking at the words they act on — and the
          link field takes focus, which would otherwise scroll the page back to
          where the bar used to be.

          The solid background belongs to the wrapper, not to the bar: the bar
          itself is a translucent tint, and a translucent tint over the words
          sliding underneath it would read as a smudge. Solid underneath, tint
          on top — the same colour it has always been, now opaque.

          `stickyOffsetClass` says where it parks — by default a header's height
          down, since the panel sits below one — and `z-20` puts it above the
          picture grips but below that header.
        */}
        <div className={cn('sticky z-20 bg-background', stickyOffsetClass)}>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-1 rounded-t-xl border border-b-0 border-input bg-secondary/40 px-2 py-1.5">
            <ToolGroup>
              <ToolButton
                title={`Undo (${shortcut}Z)`}
                disabled={!state?.canUndo}
                onClick={() => editorRef.current?.chain().focus().undo().run()}
              >
                <Undo2 className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title={`Redo (${shortcut}${isMac() ? '⇧Z' : 'Y'})`}
                disabled={!state?.canRedo}
                onClick={() => editorRef.current?.chain().focus().redo().run()}
              >
                <Redo2 className="h-4 w-4" />
              </ToolButton>
            </ToolGroup>

            <Divider />

            <ToolGroup>
              <ToolButton
                title="Heading"
                active={state?.h2}
                onClick={() => editorRef.current?.chain().focus().toggleHeading({ level: 2 }).run()}
              >
                <Heading2 className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title="Subheading"
                active={state?.h3}
                onClick={() => editorRef.current?.chain().focus().toggleHeading({ level: 3 }).run()}
              >
                <Heading3 className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title="Ordinary paragraph"
                active={Boolean(state && !state.heading)}
                onClick={() => editorRef.current?.chain().focus().setParagraph().run()}
              >
                <Pilcrow className="h-4 w-4" />
              </ToolButton>
            </ToolGroup>

            <Divider />

            <ToolGroup>
              <ToolButton
                title={`Bold (${shortcut}B)`}
                active={state?.bold}
                onClick={() => editorRef.current?.chain().focus().toggleBold().run()}
              >
                <Bold className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title={`Italic (${shortcut}I)`}
                active={state?.italic}
                onClick={() => editorRef.current?.chain().focus().toggleItalic().run()}
              >
                <Italic className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title={`Underline (${shortcut}U)`}
                active={state?.underline}
                onClick={() => editorRef.current?.chain().focus().toggleUnderline().run()}
              >
                <Underline className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title="Strikethrough"
                active={state?.strike}
                onClick={() => editorRef.current?.chain().focus().toggleStrike().run()}
              >
                <Strikethrough className="h-4 w-4" />
              </ToolButton>
            </ToolGroup>

            <Divider />

            <ToolGroup>
              <ToolButton
                title="Bulleted list"
                active={state?.bullet}
                onClick={() => editorRef.current?.chain().focus().toggleBulletList().run()}
              >
                <List className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title="Numbered list"
                active={state?.ordered}
                onClick={() => editorRef.current?.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title="Quoted passage"
                active={state?.quote}
                onClick={() => editorRef.current?.chain().focus().toggleBlockquote().run()}
              >
                <Quote className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title="Divider line"
                onClick={() => editorRef.current?.chain().focus().setHorizontalRule().run()}
              >
                <Minus className="h-4 w-4" />
              </ToolButton>
            </ToolGroup>

            <Divider />

            <ToolGroup>
              <ToolButton
                title="Link"
                active={state?.link || linkOpen}
                onClick={() => {
                  setLinkDraft((editorRef.current?.getAttributes('link').href as string) ?? '')
                  setLinkOpen((open) => !open)
                }}
              >
                <Link2 className="h-4 w-4" />
              </ToolButton>
              <ToolButton title="Insert a photograph" onClick={() => bodyInput.current?.click()}>
                <ImagePlus className="h-4 w-4" />
              </ToolButton>
            </ToolGroup>

            <span className="ml-auto flex items-center gap-2 pl-2">
              {uploads > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Uploading {uploads === 1 ? 'a photograph' : `${uploads} photographs`}…
                </span>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleSource}
                title={mode === 'rich' ? 'Edit the underlying Markdown' : 'Back to the formatted view'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {mode === 'rich' ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {mode === 'rich' ? 'Markdown' : 'Formatted'}
              </button>
            </span>
          </div>

          {/* Where a link should point */}
          {linkOpen && mode === 'rich' && (
            <div className="flex flex-wrap items-center gap-2 border-x border-input bg-background px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {state?.link ? 'Link to' : 'Link the highlighted words to'}
              </span>
              <input
                autoFocus
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setLinkOpen(false)
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  applyLink()
                }}
                placeholder="https://"
                className="min-w-[16rem] flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={applyLink}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Apply
              </button>
              {state?.link && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editorRef.current?.chain().focus().unsetLink().run()
                    setLinkOpen(false)
                  }}
                  className={cn(SMALL_BUTTON, 'text-destructive')}
                >
                  <Link2Off className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </div>
          )}

          {/* The photograph the cursor is sitting on */}
          {state?.imageSrc && mode === 'rich' && (
            <div className="flex flex-wrap items-center gap-2 border-x border-input bg-accent/5 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">Photograph</span>
              {/* Second in the row, and first in usefulness: the order a
                  photograph sits in is the thing most often wrong. */}
              <span
                title="Drag the picture to move it, or step it up and down with these"
                className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
              >
                <ToolButton
                  title="Move it up (Alt+↑)"
                  disabled={!state.imageCanUp}
                  onClick={() => nudgeSelectedImage(-1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </ToolButton>
                <ToolButton
                  title="Move it down (Alt+↓)"
                  disabled={!state.imageCanDown}
                  onClick={() => nudgeSelectedImage(1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </ToolButton>
              </span>
              <input
                // Re-keyed on the picture itself, so choosing another one starts
                // this field from that picture's own description.
                key={state.imageSrc}
                defaultValue={state.imageAlt}
                onChange={(e) => setImageAlt(e.target.value)}
                // The editor usually sits inside the page's own form, where Enter
                // in a text field would submit and save everything.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault()
                }}
                placeholder="Describe it in a few words, for readers who cannot see it"
                className="min-w-[16rem] flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => replaceInput.current?.click()}
                className={cn(SMALL_BUTTON, 'hover:text-primary')}
              >
                <ImagePlus className="h-3.5 w-3.5" /> Replace
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={removeSelectedImage}
                className={cn(SMALL_BUTTON, 'text-destructive')}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          )}
        </div>

        {/* The writing area */}
        <div
          ref={shell}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDropping(true)
          }}
          onDragLeave={(e) => {
            if (shell.current?.contains(e.relatedTarget as Node | null)) return
            setDropping(false)
          }}
          onDrop={() => setDropping(false)}
          className={cn(
            'relative rounded-b-xl border border-input bg-background',
            dropping && 'border-primary ring-2 ring-primary/20',
          )}
        >
          {/*
            The formatted view stays mounted while the Markdown source is on
            screen: the editor is therefore never rebuilt, and its undo history
            never thrown away, by throwing the switch.
          */}
          <div className={cn('px-5 py-4', mode !== 'rich' && 'hidden')}>
            <EditorContent editor={editor} />
          </div>

          {mode === 'source' && (
            <textarea
              value={value}
              onChange={(e) => latest.current.onChange(e.target.value)}
              spellCheck={false}
              placeholder={'## A heading\n\nA paragraph.'}
              className={cn(
                'w-full resize-y rounded-b-xl bg-background px-5 py-4 font-mono text-[13px] leading-relaxed outline-none',
                minHeightClass,
              )}
            />
          )}

          {!editor && (
            <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparing the editor…
            </p>
          )}
        </div>

        <input
          ref={bodyInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            void accept(files, 'cursor')
          }}
        />
        <input
          ref={replaceInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            void accept(files, 'replace')
          }}
        />
      </div>
    )
  },
)
