/**
 * The writing editor, fetched when it is first needed.
 *
 * The editor is the heaviest thing in the project — half a megabyte of
 * ProseMirror and its Markdown bridge — and it is one field among many. Named
 * at the top of the pages that use it, it was part of their own bundle, so
 * opening the settings tab meant fetching all of it whether or not anything was
 * going to be written, and on a slow connection the tab sat there while it
 * arrived. Named from inside, the page appears at once and the editor lands when
 * a field that wants one is actually put on screen — which, with the long
 * sections folded away until they are opened, is not until it is asked for.
 *
 * The frame the editor will occupy is drawn while it is on its way, at its own
 * height, so that nothing on the page moves when it arrives.
 */
import { forwardRef, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor'

export type { MarkdownEditorHandle, MarkdownEditorProps }

const Editor = lazy(() =>
  import('./MarkdownEditor').then((module) => ({ default: module.MarkdownEditor })),
)

export const LazyMarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function LazyMarkdownEditor({ minHeightClass, ...props }, ref) {
    return (
      <Suspense fallback={<Arriving minHeightClass={minHeightClass} />}>
        <Editor ref={ref} minHeightClass={minHeightClass} {...props} />
      </Suspense>
    )
  },
)

function Arriving({ minHeightClass }: { minHeightClass?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-input bg-background px-5 py-4 text-sm text-muted-foreground',
        minHeightClass,
      )}
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Fetching the editor…
    </div>
  )
}
