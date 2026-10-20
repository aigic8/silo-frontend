import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConflictDialog } from './components/ConflictDialog'
import { NoteEditor } from './components/NoteEditor'
import { SaveStatus } from './components/SaveStatus'
import { SessionExpiredDialog } from './components/SessionExpiredDialog'
import { Sidebar } from './components/Sidebar'
import { useSidebarPreference } from './hooks/useSidebarPreference'
import { useVaultSync } from './hooks/useVaultSync'
import type { AuthUser } from './lib/api'
import type { DerivedKeys } from './lib/crypto'
import {
  addFolder,
  addNote,
  deleteFolder,
  deleteNote,
  moveNote,
  newId,
  renameFolder,
  updateNote,
} from './lib/vault'
import type { Theme } from './hooks/useTheme'

interface VaultAppProps {
  keys: DerivedKeys
  user: AuthUser
  theme: Theme
  onToggleTheme: () => void
  onSignOut: () => Promise<void>
  onDiscardSession: () => void
  onFatal: (error: Error) => void
}

export function VaultApp({
  keys,
  user,
  theme,
  onToggleTheme,
  onSignOut,
  onDiscardSession,
  onFatal,
}: VaultAppProps) {
  const { sidebarCollapsed, toggleSidebar } = useSidebarPreference()
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const flushRef = useRef<(() => void) | null>(null)

  const syncOptions = useMemo(
    () => ({
      onFatal,
      debounceMs: 800,
      retryBaseMs: 2_000,
      retryMaxMs: 30_000,
    }),
    [onFatal],
  )

  const sync = useVaultSync(keys, syncOptions)
  const mutate = sync.mutate
  const draft = sync.draft
  const selectedNote = draft.notes.find((note) => note.id === selectedNoteId) ?? null
  const canEdit = sync.initialized && !sync.sessionExpired

  useEffect(() => {
    if (draft.notes.length === 0) {
      if (selectedNoteId !== null) setSelectedNoteId(null)
      return
    }
    if (
      selectedNoteId === null ||
      !draft.notes.some((note) => note.id === selectedNoteId)
    ) {
      setSelectedNoteId(draft.notes[0]?.id ?? null)
    }
  }, [draft.notes, selectedNoteId])

  const selectNote = useCallback(
    (id: string) => {
      if (id === selectedNoteId) return
      const flush = flushRef.current
      flushRef.current = null
      flush?.()
      setSelectedNoteId(id)
    },
    [selectedNoteId],
  )

  const handleEditorChange = useCallback(
    (noteId: string, editorState: string | null) => {
      mutate((current) =>
        updateNote(current, noteId, { editorState, updatedAt: Date.now() }),
      )
    },
    [mutate],
  )

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!selectedNote) return
      mutate((current) =>
        updateNote(current, selectedNote.id, { title, updatedAt: Date.now() }),
      )
    },
    [selectedNote, mutate],
  )

  const handleAddNote = useCallback(
    (folderId: string | null) => {
      const id = newId()
      mutate((current) => addNote(current, id, Date.now(), folderId))
      flushRef.current?.()
      flushRef.current = null
      setSelectedNoteId(id)
    },
    [mutate],
  )

  const handleDeleteNote = useCallback(
    (id: string) => {
      mutate((current) => deleteNote(current, id))
      if (selectedNoteId === id) setSelectedNoteId(null)
    },
    [selectedNoteId, mutate],
  )

  const handleRenameNote = useCallback(
    (id: string, title: string) => {
      mutate((current) =>
        updateNote(current, id, { title, updatedAt: Date.now() }),
      )
    },
    [mutate],
  )

  const handleMoveNote = useCallback(
    (id: string, folderId: string | null) => {
      try {
        mutate((current) => moveNote(current, id, folderId))
      } catch {
        // The sidebar only offers valid folders; ignore invalid moves.
      }
    },
    [mutate],
  )

  const handleAddFolder = useCallback(
    (name: string) => {
      mutate((current) => addFolder(current, newId(), name))
    },
    [mutate],
  )

  const handleRenameFolder = useCallback(
    (id: string, name: string) => {
      mutate((current) => renameFolder(current, id, name))
    },
    [mutate],
  )

  const handleDeleteFolder = useCallback(
    (id: string) => {
      mutate((current) => deleteFolder(current, id))
    },
    [mutate],
  )

  function requestLogout(): void {
    if (sync.dirty || sync.status === 'saving') {
      setLogoutConfirm(true)
      return
    }
    void handleSignOut()
  }

  async function handleSignOut(): Promise<void> {
    setSignOutBusy(true)
    setLogoutError(null)
    try {
      await onSignOut()
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : 'Could not log out. Try again.',
      )
    } finally {
      setSignOutBusy(false)
      setLogoutConfirm(false)
    }
  }

  if (sync.sessionExpired) {
    return (
      <SessionExpiredDialog
        onExport={sync.exportDraft}
        onDiscard={onDiscardSession}
      />
    )
  }

  if (!sync.initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="mb-2 text-xl font-semibold">
            {sync.status === 'offline' ? 'Loading vault failed' : 'Loading vault…'}
          </h1>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            {sync.status === 'offline'
              ? 'Could not reach the server. Your vault has not been loaded yet.'
              : 'Decrypting and validating your vault before editing.'}
          </p>
          {sync.status === 'offline' || sync.status === 'error' ? (
            <button
              type="button"
              onClick={sync.retryNow}
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <input
            aria-label="Note title"
            value={selectedNote?.title ?? ''}
            onChange={(event) => handleTitleChange(event.target.value)}
            placeholder={selectedNote ? 'Untitled' : 'No note selected'}
            disabled={!selectedNote || !canEdit}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-medium outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 dark:placeholder:text-slate-500 dark:focus:border-indigo-800 dark:focus:ring-indigo-900"
          />
          <SaveStatus
            status={sync.status}
            connected={sync.connected}
            dirty={sync.dirty}
            errorMessage={sync.errorMessage}
            onRetry={sync.retryNow}
          />
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </header>

        {logoutError ? (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {logoutError}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {selectedNote ? (
            <NoteEditor
              key={`${selectedNote.id}:${sync.revision}`}
              initialEditorState={selectedNote.editorState}
              onChange={(serialized) => handleEditorChange(selectedNote.id, serialized)}
              onFlushReady={(flush) => {
                flushRef.current = flush
              }}
              onFlushUnmount={() => {
                flushRef.current = null
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="mb-3 text-slate-500 dark:text-slate-400">
                  No note selected
                </p>
                <button
                  type="button"
                  onClick={() => handleAddNote(null)}
                  className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                >
                  New note
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <Sidebar
        vault={draft}
        selectedNoteId={selectedNoteId}
        collapsed={sidebarCollapsed}
        userEmail={user.email}
        onSelectNote={selectNote}
        onAddNote={handleAddNote}
        onDeleteNote={handleDeleteNote}
        onRenameNote={handleRenameNote}
        onMoveNote={handleMoveNote}
        onAddFolder={handleAddFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onToggleSidebar={toggleSidebar}
        onLogout={requestLogout}
      />

      {sync.conflict ? (
        <ConflictDialog conflict={sync.conflict} onResolve={sync.resolveConflict} />
      ) : null}

      {logoutConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h2 id="logout-title" className="mb-2 text-lg font-semibold">
              Unsaved changes
            </h2>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
              You have unsaved changes. Logging out will discard them and wipe
              the encryption key from this device.
            </p>
            {logoutError ? (
              <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {logoutError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLogoutConfirm(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signOutBusy}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {signOutBusy ? 'Logging out…' : 'Discard and log out'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
