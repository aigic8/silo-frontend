import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultApp } from './VaultApp'
import type { VaultSync } from './hooks/useVaultSync'
import type { DerivedKeys } from './lib/crypto'
import { noteEditorMockState } from './test/noteEditorMockState'
import { getVaultSyncMock, setVaultSyncMock } from './test/vaultSyncMock'
import type { VaultDocument } from './lib/vault'

vi.mock('./hooks/useVaultSync', async () => {
  const { mockUseVaultSync } = await import('./test/vaultSyncMock')
  return { useVaultSync: mockUseVaultSync }
})

vi.mock('./components/NoteEditor', async () => {
  const { MockNoteEditor } = await import('./test/NoteEditorMock')
  return { NoteEditor: MockNoteEditor }
})

const keys = {
  authKeyBase64: 'auth-key',
  encryptionKey: {} as CryptoKey,
  saltBase64: 'salt',
} as DerivedKeys

const user = { id: 'user-1', email: 'alice@example.com', salt: 'salt' }

function makeSync(draft: VaultDocument, revision: number): VaultSync {
  return {
    draft,
    serverVersion: revision,
    status: 'saved',
    connected: true,
    dirty: false,
    conflict: null,
    errorMessage: null,
    initialized: true,
    revision,
    sessionExpired: false,
    setDraft: vi.fn(),
    mutate: vi.fn(),
    retryNow: vi.fn(),
    resolveConflict: vi.fn(),
    exportDraft: vi.fn(),
  }
}

function noteDraft(editorState: string | null): VaultDocument {
  return {
    schemaVersion: 1,
    folders: [],
    notes: [
      {
        id: 'note-1',
        title: 'Remote title',
        folderId: null,
        editorState,
        updatedAt: 1,
      },
    ],
  }
}

function renderApp() {
  return render(
    <VaultApp
      keys={keys}
      user={user}
      theme="light"
      onToggleTheme={() => {}}
      onSignOut={async () => {}}
      onDiscardSession={() => {}}
      onFatal={() => {}}
    />,
  )
}

afterEach(cleanup)

describe('VaultApp editor revision binding', () => {
  beforeEach(() => {
    noteEditorMockState.mountCount = 0
  })

  it('rebinds the mounted editor when a remote revision changes the active note', () => {
    setVaultSyncMock(makeSync(noteDraft('old-body'), 1))
    const { rerender } = renderApp()

    expect(screen.getByTestId('note-editor')).toHaveTextContent('old-body')
    const mountsBeforeRemote = noteEditorMockState.mountCount

    setVaultSyncMock(makeSync(noteDraft('new-body'), 2))
    rerender(
      <VaultApp
        keys={keys}
        user={user}
        theme="light"
        onToggleTheme={() => {}}
        onSignOut={async () => {}}
        onDiscardSession={() => {}}
        onFatal={() => {}}
      />,
    )

    expect(screen.getByTestId('note-editor')).toHaveTextContent('new-body')
    expect(noteEditorMockState.mountCount).toBe(mountsBeforeRemote + 1)
  })

  it('bases the next local edit on the latest remote body', () => {
    setVaultSyncMock(makeSync(noteDraft('new-body'), 2))
    renderApp()

    fireEvent.click(screen.getByTestId('type-after-remote'))

    const draft = getVaultSyncMock().draft
    expect(draft.notes[0]?.editorState).toBe('typed-after-remote')
    expect(draft.notes[0]?.title).toBe('Remote title')
  })

  it('surfaces logout failure and stays in the app', async () => {
    setVaultSyncMock(makeSync(noteDraft('new-body'), 2))
    const onSignOut = vi.fn().mockRejectedValue(new Error('Logout failed'))

    render(
      <VaultApp
        keys={keys}
        user={user}
        theme="light"
        onToggleTheme={() => {}}
        onSignOut={onSignOut}
        onDiscardSession={() => {}}
        onFatal={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Logout failed')
    expect(screen.getByTestId('note-editor')).toBeInTheDocument()
  })

  it('shows the session-expired dialog instead of silently discarding a draft', () => {
    setVaultSyncMock({ ...makeSync(noteDraft('new-body'), 2), sessionExpired: true })
    renderApp()

    expect(screen.getByRole('heading', { name: 'Session expired' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Export local draft as JSON' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Discard draft and sign out' }),
    ).toBeInTheDocument()
  })
})
