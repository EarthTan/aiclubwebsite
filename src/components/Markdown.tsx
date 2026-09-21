import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkUnderline } from '@/lib/remarkUnderline'

/**
 * Renders event write-ups. Images inherit sizing from `.article-body`.
 *
 * Two remark plugins: GFM for tables and strikethrough, and the project's own
 * `remarkUnderline`, which is what lets an underlined run appear at all — it is
 * stored as `<u>`, since Markdown has no syntax for underline.
 *
 * Raw HTML is not permitted through. Whatever `remarkUnderline` does not
 * recognise as underline stays unread, exactly as it did before that plugin
 * existed, so a `<script>` reaching the library is still silently dropped.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="article-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkUnderline]}
        components={{
          // `node` is react-markdown's own AST prop — strip it before it reaches the DOM.
          img: ({ node: _node, ...props }) => <img {...props} loading="lazy" alt={props.alt ?? ''} />,
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
