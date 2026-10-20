import { useEffect } from 'react'
import { noteEditorMockState } from './noteEditorMockState'

interface MockNoteEditorProps {
  initialEditorState: string | null
  onChange?: (serialized: string | null) => void
  onFlushReady?: (flush: () => void) => void
  onFlushUnmount?: () => void
}

export function MockNoteEditor({ initialEditorState, onChange }: MockNoteEditorProps) {
  useEffect(() => {
    noteEditorMockState.mountCount += 1
  }, [])

  return (
    <div>
      <div data-testid="note-editor">{initialEditorState ?? 'EMPTY'}</div>
      <button
        type="button"
        data-testid="type-after-remote"
        onClick={() => onChange?.('typed-after-remote')}
      >
        type
      </button>
    </div>
  )
}
