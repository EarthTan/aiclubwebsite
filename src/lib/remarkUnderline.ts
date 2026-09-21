/**
 * Underline, which Markdown has no syntax for.
 *
 * Typora and its relatives store an underlined run as `<u>…</u>`, and that is
 * the form this project uses too — it is what a word processor hands over, and
 * it survives a paste from one. But a renderer will not show raw HTML unless it
 * carries a full HTML parser, and the library that does that (`rehype-raw`, via
 * `parse5`) is around half a megabyte of source, which every reader of the site
 * would pay for a single formatting option.
 *
 * This does the small part of that job which is actually needed. The Markdown
 * parser already reports each tag as an `html` node rather than as text — it is
 * simply that nothing reads it, so the tag vanishes and the words around it stay
 * plain. Here, a run of `<u>` … `</u>` among a node's children becomes one
 * element. Everything the run contains keeps whatever formatting it already had,
 * because those children were parsed as Markdown in the ordinary way. And every
 * *other* piece of raw HTML is left exactly where it was: unread, and never
 * reaching the page.
 *
 * Deliberately not attempted: a tag that is never closed, or one opened in one
 * paragraph and closed in another. Both are left as the raw text they are, and
 * nothing is rendered, which is what the site did before any of this existed.
 */

interface Node {
  type: string
  value?: string
  children?: Node[]
  data?: Record<string, unknown>
}

const OPEN = /^\s*<u(\s[^>]*)?>\s*$/i
const CLOSE = /^\s*<\/u\s*>\s*$/i
/** A whole run inside a single node, which is how a line of its own arrives. */
const WHOLE = /^\s*<u(\s[^>]*)?>([\s\S]*?)<\/u\s*>\s*$/i

const isTag = (node: Node): node is Node & { value: string } =>
  node.type === 'html' && typeof node.value === 'string'

/** An underlined run, said in a node type the renderer already understands. */
function underlined(children: Node[]): Node {
  return {
    // `emphasis` is used only because it is an inline node that takes inline
    // children; `hName` replaces the tag it would otherwise have produced, so a
    // `u` element comes out and not an `em`.
    type: 'emphasis',
    data: { hName: 'u' },
    children,
  }
}

function rewrite(children: Node[]): Node[] {
  const next: Node[] = []

  for (let i = 0; i < children.length; i += 1) {
    const node = children[i]

    if (isTag(node)) {
      const whole = WHOLE.exec(node.value)
      if (whole) {
        next.push(underlined([{ type: 'text', value: whole[2].trim() }]))
        continue
      }

      if (OPEN.test(node.value)) {
        // Gather the run: everything up to the tag that closes it.
        let depth = 1
        let end = i + 1
        const inner: Node[] = []
        for (; end < children.length; end += 1) {
          const candidate = children[end]
          if (isTag(candidate)) {
            if (OPEN.test(candidate.value)) depth += 1
            else if (CLOSE.test(candidate.value)) {
              depth -= 1
              if (depth === 0) break
            }
          }
          inner.push(candidate)
        }
        if (depth === 0 && inner.length > 0) {
          next.push(underlined(rewrite(inner)))
          i = end
          continue
        }
      }
    }

    if (node.children) node.children = rewrite(node.children)
    next.push(node)
  }

  return next
}

export function remarkUnderline() {
  return (tree: Node): void => {
    tree.children = rewrite(tree.children ?? [])
  }
}
