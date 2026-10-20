import { describe, expect, it } from 'vitest'
import {
  addFolder,
  addNote,
  createEmptyVault,
  deleteFolder,
  moveNote,
  parseVaultDocument,
  updateNote,
  VAULT_SCHEMA_VERSION,
  VaultValidationError,
  type VaultDocument,
} from './vault'

function makeVault(): VaultDocument {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    folders: [{ id: 'folder-1', name: 'Work' }],
    notes: [
      {
        id: 'note-1',
        title: 'First',
        folderId: 'folder-1',
        editorState: JSON.stringify({ root: { children: [] } }),
        updatedAt: 100,
      },
    ],
  }
}

describe('parseVaultDocument', () => {
  it('accepts a valid document', () => {
    expect(parseVaultDocument(makeVault())).toEqual(makeVault())
  })

  it('accepts null editor state', () => {
    const vault = makeVault()
    vault.notes[0]!.editorState = null
    expect(parseVaultDocument(vault).notes[0]?.editorState).toBeNull()
  })

  it('rejects an unsupported schema version', () => {
    expect(() => parseVaultDocument({ ...makeVault(), schemaVersion: 2 })).toThrow(
      VaultValidationError,
    )
  })

  it('rejects duplicate note ids', () => {
    const vault = makeVault()
    vault.notes.push({ ...vault.notes[0]! })
    expect(() => parseVaultDocument(vault)).toThrow(/duplicate note id/)
  })

  it('rejects a note referencing a missing folder', () => {
    const vault = makeVault()
    vault.notes[0]!.folderId = 'missing'
    expect(() => parseVaultDocument(vault)).toThrow(/missing folder/)
  })

  it('rejects malformed editor state', () => {
    const vault = makeVault()
    vault.notes[0]!.editorState = '{not json'
    expect(() => parseVaultDocument(vault)).toThrow(/not valid JSON/)
  })
})

describe('vault helpers', () => {
  it('creates empty notes and folders', () => {
    let vault = createEmptyVault()
    vault = addFolder(vault, 'folder-1', 'Work')
    vault = addNote(vault, 'note-1', 200, 'folder-1')
    expect(vault.folders).toHaveLength(1)
    expect(vault.notes[0]?.title).toBe('')
    expect(vault.notes[0]?.folderId).toBe('folder-1')
  })

  it('updates a note', () => {
    let vault = addNote(createEmptyVault(), 'note-1', 200)
    vault = updateNote(vault, 'note-1', { title: 'Hello', updatedAt: 300 })
    expect(vault.notes[0]?.title).toBe('Hello')
  })

  it('deleting a folder moves contained notes to root', () => {
    let vault = addFolder(createEmptyVault(), 'folder-1', 'Work')
    vault = addNote(vault, 'note-1', 200, 'folder-1')
    vault = deleteFolder(vault, 'folder-1')
    expect(vault.folders).toHaveLength(0)
    expect(vault.notes[0]?.folderId).toBeNull()
  })

  it('moveNote rejects a missing folder', () => {
    const vault = addNote(createEmptyVault(), 'note-1', 200)
    expect(() => moveNote(vault, 'note-1', 'missing')).toThrow(VaultValidationError)
  })
})
