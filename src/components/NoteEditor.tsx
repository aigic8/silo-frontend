import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { CodeNode } from '@lexical/code'
import { ListItemNode, ListNode } from '@lexical/list'
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  ORDERED_LIST,
  QUOTE,
  registerMarkdownShortcuts,
  UNORDERED_LIST,
  type Transformer,
} from '@lexical/markdown'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import type { LexicalEditor } from 'lexical'
import { editorTheme } from './editorTheme'

const EDITOR_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode]

const MARKDOWN_TRANSFORMERS: Transformer[] = [
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  INLINE_CODE,
  CODE,
  HEADING,
  ORDERED_LIST,
  UNORDERED_LIST,
  QUOTE,
]

function onLexicalError(error: Error): void {
  // Lexical runtime errors are surfaced to the browser console for diagnostics.
  // Vault bytes, keys, passphrases, and tokens are never logged here.
  console.error('Lexical editor error', error)
}

interface SyncPluginProps {
  onChangeRef: MutableRefObject<(serialized: string | null) => void>
  onFlushReadyRef: MutableRefObject<(flush: () => void) => void>
  onFlushUnmountRef: MutableRefObject<() => void>
}

function serializeState(editor: LexicalEditor): string | null {
  const editorState = editor.getEditorState()
  let serialized: string | null = null
  editorState.read(() => {
    serialized = JSON.stringify(editorState.toJSON())
  })
  return serialized
}

function SyncPlugin({ onChangeRef, onFlushReadyRef, onFlushUnmountRef }: SyncPluginProps) {
  const [editor] = useLexicalComposerContext()
  const lastSerializedRef = useRef<string | null>(null)

  useEffect(() => {
    const flush = (): void => {
      const serialized = serializeState(editor)
      if (serialized === lastSerializedRef.current) return
      lastSerializedRef.current = serialized
      onChangeRef.current(serialized)
    }
    onFlushReadyRef.current(flush)
    const clearFlush = onFlushUnmountRef.current

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const serialized = JSON.stringify(editorState.toJSON())
        if (serialized === lastSerializedRef.current) return
        lastSerializedRef.current = serialized
        onChangeRef.current(serialized)
      })
    })

    return () => {
      clearFlush()
      unregister()
    }
  }, [editor, onChangeRef, onFlushReadyRef, onFlushUnmountRef])

  useEffect(() => {
    return registerMarkdownShortcuts(editor, MARKDOWN_TRANSFORMERS)
  }, [editor])

  return null
}

interface NoteEditorProps {
  initialEditorState: string | null
  onChange: (serialized: string | null) => void
  onFlushReady: (flush: () => void) => void
  onFlushUnmount: () => void
}

export function NoteEditor({
  initialEditorState,
  onChange,
  onFlushReady,
  onFlushUnmount,
}: NoteEditorProps) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const onFlushReadyRef = useRef(onFlushReady)
  useEffect(() => {
    onFlushReadyRef.current = onFlushReady
  })

  const onFlushUnmountRef = useRef(onFlushUnmount)
  useEffect(() => {
    onFlushUnmountRef.current = onFlushUnmount
  })

  const initialConfig = useMemo(
    () => ({
      namespace: 'silo-note',
      nodes: EDITOR_NODES,
      theme: editorTheme,
      onError: onLexicalError,
      ...(initialEditorState !== null ? { editorState: initialEditorState } : {}),
    }),
    [initialEditorState],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative h-full">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="min-h-full w-full max-w-3xl px-8 py-6 outline-none"
              aria-placeholder="Start typing…"
              placeholder={
                <span className="pointer-events-none absolute left-8 top-6 text-slate-400 dark:text-slate-500">
                  Start typing…
                </span>
              }
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <SyncPlugin
          onChangeRef={onChangeRef}
          onFlushReadyRef={onFlushReadyRef}
          onFlushUnmountRef={onFlushUnmountRef}
        />
      </div>
    </LexicalComposer>
  )
}
