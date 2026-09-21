import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Renders event write-ups. Images inherit sizing from `.article-body`. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="article-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
