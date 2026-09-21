/**
 * The one description of what the writing editor is.
 *
 * The panel edits Markdown, and the public pages render that same Markdown, so
 * this file is the contract between the two: whichever extensions are listed
 * here decide which constructs survive a trip through the editor. It is kept
 * apart from the React component so the round-trip check can load the very same
 * set rather than a copy of it.
 */
import { Image } from '@tiptap/extension-image'
import type { Level } from '@tiptap/extension-heading'
import { Placeholder } from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import type { Extensions } from '@tiptap/core'
import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Markdown } from 'tiptap-markdown'

/**
 * Two columns of three dots, the usual sign that a block can be dragged.
 *
 * A string rather than a component: a node view is built with the DOM API, and
 * it stands outside React entirely.
 */
const IMAGE_GRIP =
  '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false">' +
  '<circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/>' +
  '<circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>' +
  '<circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>'

/** Copies a photograph's attributes onto the element showing it. */
function applyImage(picture: HTMLImageElement, node: { attrs: Record<string, unknown> }): void {
  const src = String(node.attrs.src ?? '')
  if (picture.getAttribute('src') !== src) picture.setAttribute('src', src)

  const alt = String(node.attrs.alt ?? '')
  if (picture.getAttribute('alt') !== alt) picture.setAttribute('alt', alt)

  const title = node.attrs.title
  if (title == null || title === '') picture.removeAttribute('title')
  else picture.setAttribute('title', String(title))
}

/**
 * A photograph on its own line.
 *
 * The stock serializer writes `![alt](src)` and stops there, without closing
 * the block it has just written. The paragraph that follows is therefore joined
 * straight onto the image — `![Team](/media/team.jpg)## The people`, in which
 * the `##` is no longer a heading but three stray characters inside a
 * paragraph. A write-up opened in the panel and saved would lose a heading every
 * time, and a second pass would lose more. Declaring the block closed restores
 * the blank line, and photographs in these write-ups always stand as their own
 * block, so the empty separator is never unwanted.
 */
export const BlockImage = Image.extend({
  /**
   * A photograph is a block that gets moved, not a run of text that gets
   * selected.
   *
   * The stock node puts `draggable` on the `<img>` itself, and it is the only
   * element there is. A drag begun on a picture therefore starts the browser's
   * own image drag, fought over inside a `contenteditable` region by the
   * selection machinery — which is why a writer setting out to move a picture
   * can end up having swept a paragraph instead.
   *
   * So the picture sits inside a wrapper, and the wrapper is the drag source
   * while the `<img>` is explicitly not draggable. A drag can begin anywhere on
   * the photograph and still mean "move this block"; there is no longer a
   * gesture that could be read as selecting text across it. The wrapper is also
   * somewhere for the grip to stand, which is how the block says out loud that
   * it can be moved at all.
   */
  addNodeView() {
    // A node view is made of DOM, and the round-trip check builds an editor
    // without any.
    if (typeof document === 'undefined') return null
    return ({ node }: { node: { attrs: Record<string, unknown> } }) => {
      const dom = document.createElement('div')
      dom.className = 'md-image-block'
      dom.draggable = true

      const grip = document.createElement('span')
      grip.className = 'md-image-grip'
      grip.setAttribute('aria-hidden', 'true')
      grip.innerHTML = IMAGE_GRIP

      const picture = document.createElement('img')
      picture.draggable = false
      picture.loading = 'lazy'
      applyImage(picture, node)

      dom.append(grip, picture)

      return {
        dom,
        update: (next: { type: { name: string }; attrs: Record<string, unknown> }) => {
          if (next.type.name !== 'image') return false
          applyImage(picture, next)
          return true
        },
        // Nothing inside the wrapper is editable, so no mutation arriving from
        // it can be a change to the document.
        ignoreMutation: () => true,
      }
    }
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: MarkdownNode) {
          const alt = state.esc((node.attrs.alt as string) ?? '')
          const src = String(node.attrs.src ?? '').replace(/[()]/g, '\\$&')
          const title = node.attrs.title
            ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
            : ''
          state.write(`![${alt}](${src}${title})`)
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})

interface MarkdownNode {
  attrs: Record<string, unknown>
}

interface MarkdownSerializerState {
  esc: (text: string) => string
  write: (text: string) => void
  closeBlock: (node: unknown) => void
}

/**
 * Headings start at the second level.
 *
 * The event's own title is the page's `h1`, and the About and History pages
 * carry theirs in the page chrome, so a write-up that introduced a second `h1`
 * would describe a document that does not exist. The archive is written this way
 * already: 38 `##` and 13 `###`, and not a single `#`.
 */
export const HEADING_LEVELS: Level[] = [2, 3]

export function editorExtensions(placeholder?: string): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      heading: { levels: HEADING_LEVELS },
      // Fenced code never appears in a write-up, and a paste from elsewhere
      // would be the only way to acquire one. A horizontal rule is the opposite
      // case: it is a divider a long write-up may reasonably want, and it
      // survives a round trip unchanged.
      codeBlock: false,
      horizontalRule: {},
      // A link is edited through the toolbar bubble, where the destination can
      // be seen, rather than by clicking through to the live site mid-sentence.
      link: { openOnClick: false, autolink: false },
      // StarterKit installs the drop cursor already — the line drawn while a
      // block is being dragged, and the only thing that says where a photograph
      // will come to rest. It is coloured here rather than added again, which
      // would install a second copy under the same name.
      dropcursor: { color: 'hsl(var(--primary))', width: 3 },
    }),
    BlockImage.configure({ inline: false, allowBase64: false }),
    Markdown.configure({
      // Raw HTML has to be allowed through: it is how underline is stored.
      html: true,
      tightLists: true,
      bulletListMarker: '-',
      // Typing a URL should not silently acquire link markup — the destination
      // would then be stored in the write-up without ever having been chosen.
      linkify: false,
      // A single newline stays a single newline rather than becoming a <br>,
      // which is what the archive assumes.
      breaks: false,
      // Pasting Markdown source is a real way of working here, and the panel is
      // the only tool the club has for this content.
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ]

  if (placeholder) {
    extensions.push(Placeholder.configure({ placeholder }))
  }

  return extensions
}

/**
 * The Markdown a document holds, as the editor would write it.
 *
 * Used to decide whether a value arriving from outside differs from what the
 * editor is already showing, without treating a trailing newline as an edit.
 */
export function sameMarkdown(a: string, b: string): boolean {
  return a.replace(/\s+$/, '') === b.replace(/\s+$/, '')
}

/** `IMG_4821.jpeg` → `Img 4821`, a serviceable first guess at alt text. */
export function altFromFileName(name: string): string {
  const base = name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!base) return ''
  const spaced = base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Where the chosen photograph sits among its siblings.
 *
 * A node selection's `from` is the position immediately before the node, and
 * the siblings are located by walking the parent's children and adding up their
 * sizes. Asking the resolved position instead — `before(depth)` — answers a
 * different question: the position before the *parent*, which is not the same
 * thing at any depth, and is meaningless at the top level.
 */
function imageSlot(state: EditorState) {
  const selection = state.selection
  if (!(selection instanceof NodeSelection)) return null
  if (selection.node.type.name !== 'image') return null

  const from = selection.from
  const $from = state.doc.resolve(from)
  const parent = $from.parent

  const starts: number[] = []
  let offset = $from.start($from.depth)
  for (let i = 0; i < parent.childCount; i++) {
    starts.push(offset)
    offset += parent.child(i).nodeSize
  }

  const index = starts.indexOf(from)
  if (index < 0) return null

  return { node: selection.node, parent, starts, index }
}

/**
 * A blank paragraph — the kind a document ends with whether or not its author
 * put one there, since StarterKit keeps one at the foot of every document.
 */
function isBlank(node: { type: { name: string }; content: { size: number } }): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0
}

/**
 * The sibling a photograph should trade places with, or `null` when there is
 * none left in that direction.
 *
 * Blank paragraphs are stepped over. Without that, the last photograph in a
 * write-up would still be offered a move down — one that traded it with the
 * empty paragraph at the foot of the document and changed nothing a reader
 * could see. A button that is lit and does nothing is worse than one that is
 * dimmed, because it teaches the writer to distrust the arrows.
 */
function swapIndex(
  parent: {
    childCount: number
    child: (index: number) => { type: { name: string }; content: { size: number } }
  },
  index: number,
  direction: -1 | 1,
): number | null {
  for (let at = index + direction; at >= 0 && at < parent.childCount; at += direction) {
    if (!isBlank(parent.child(at))) return at
  }
  return null
}

/** Whether the chosen photograph has a neighbour to trade places with. */
export function canMoveImage(state: EditorState, direction: -1 | 1): boolean {
  const slot = imageSlot(state)
  if (!slot) return false
  return swapIndex(slot.parent, slot.index, direction) !== null
}

/**
 * Trades the chosen photograph with the block beside it.
 *
 * A delete followed by an insert, rather than a swap of two known blocks: that
 * is what makes it work at the start and the end of a document, and against a
 * neighbour of any kind — a heading, a paragraph, another photograph — instead
 * of only between two pictures. The selection is carried to the picture's new
 * position so that a second press moves it again rather than doing nothing.
 */
export function moveImage(view: EditorView, direction: -1 | 1): boolean {
  const state = view.state
  const slot = imageSlot(state)
  if (!slot) return false

  const { node, parent, starts, index } = slot
  const target = swapIndex(parent, index, direction)
  if (target === null) return false

  const blockStart = starts[index]
  const siblingStart = starts[target]
  const siblingSize = parent.child(target).nodeSize

  const tr = state.tr
  tr.delete(blockStart, blockStart + node.nodeSize)

  // Taking the photograph out shifts everything after it back by its own
  // length, including the neighbour when that neighbour comes second.
  const shifted = siblingStart > blockStart ? siblingStart - node.nodeSize : siblingStart
  const landing = direction === 1 ? shifted + siblingSize : shifted

  tr.insert(landing, node)
  tr.setSelection(NodeSelection.create(tr.doc, landing))
  view.dispatch(tr.scrollIntoView())
  return true
}
