export const VAULT_SCHEMA_VERSION = 1

export interface Folder {
  id: string
  name: string
}

export interface Note {
  id: string
  title: string
  /** Folder id or null for the root "Notes" collection. */
  folderId: string | null
  /** Serialized Lexical editor state (JSON string), or null for an empty note. */
  editorState: string | null
  /** Unix epoch milliseconds of the last local edit. */
  updatedAt: number
}

export interface VaultDocument {
  schemaVersion: number
  folders: Folder[]
  notes: Note[]
}

export class VaultValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUniqueIds(items: ReadonlyArray<{ id: string }>, label: string): void {
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new VaultValidationError(`duplicate ${label} id: ${item.id}`)
    }
    ids.add(item.id)
  }
}

function parseEditorState(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new VaultValidationError('note editorState must be a string or null')
  }
  try {
    const parsed = JSON.parse(value) as unknown
    if (!isRecord(parsed)) {
      throw new VaultValidationError('note editorState must be a JSON object')
    }
  } catch (error) {
    if (error instanceof VaultValidationError) throw error
    throw new VaultValidationError('note editorState is not valid JSON')
  }
  return value
}

/**
 * Validate and return a vault document. Throws {@link VaultValidationError}
 * for any schema or integrity violation so callers fail closed.
 */
export function parseVaultDocument(value: unknown): VaultDocument {
  if (!isRecord(value)) {
    throw new VaultValidationError('vault must be a JSON object')
  }
  if (value.schemaVersion !== VAULT_SCHEMA_VERSION) {
    throw new VaultValidationError(
      `unsupported vault schema version: ${String(value.schemaVersion)}`,
    )
  }
  if (!Array.isArray(value.folders)) {
    throw new VaultValidationError('vault folders must be an array')
  }
  if (!Array.isArray(value.notes)) {
    throw new VaultValidationError('vault notes must be an array')
  }

  const folders: Folder[] = value.folders.map((folder, index) => {
    if (!isRecord(folder)) {
      throw new VaultValidationError(`folder ${index} must be an object`)
    }
    if (typeof folder.id !== 'string' || folder.id.length === 0) {
      throw new VaultValidationError(`folder ${index} id must be a non-empty string`)
    }
    if (typeof folder.name !== 'string') {
      throw new VaultValidationError(`folder ${index} name must be a string`)
    }
    return { id: folder.id, name: folder.name }
  })

  const notes: Note[] = value.notes.map((note, index) => {
    if (!isRecord(note)) {
      throw new VaultValidationError(`note ${index} must be an object`)
    }
    if (typeof note.id !== 'string' || note.id.length === 0) {
      throw new VaultValidationError(`note ${index} id must be a non-empty string`)
    }
    if (typeof note.title !== 'string') {
      throw new VaultValidationError(`note ${index} title must be a string`)
    }
    if (note.folderId !== null && typeof note.folderId !== 'string') {
      throw new VaultValidationError(`note ${index} folderId must be a string or null`)
    }
    if (typeof note.updatedAt !== 'number' || !Number.isFinite(note.updatedAt)) {
      throw new VaultValidationError(`note ${index} updatedAt must be a finite number`)
    }
    return {
      id: note.id,
      title: note.title,
      folderId: note.folderId as string | null,
      editorState: parseEditorState(note.editorState),
      updatedAt: note.updatedAt,
    }
  })

  const folderIds = new Set(folders.map((folder) => folder.id))
  for (const note of notes) {
    if (note.folderId !== null && !folderIds.has(note.folderId)) {
      throw new VaultValidationError(
        `note ${note.id} references missing folder ${note.folderId}`,
      )
    }
  }

  hasUniqueIds(folders, 'folder')
  hasUniqueIds(notes, 'note')

  return { schemaVersion: VAULT_SCHEMA_VERSION, folders, notes }
}

export function createEmptyVault(): VaultDocument {
  return { schemaVersion: VAULT_SCHEMA_VERSION, folders: [], notes: [] }
}

export function newId(): string {
  return crypto.randomUUID()
}

export function sortVaultNotes(vault: VaultDocument): VaultDocument {
  return {
    ...vault,
    notes: [...vault.notes].sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
      return a.title.localeCompare(b.title)
    }),
  }
}

export function addNote(
  vault: VaultDocument,
  id: string,
  now: number,
  folderId: string | null = null,
): VaultDocument {
  return sortVaultNotes({
    ...vault,
    notes: [
      ...vault.notes,
      { id, title: '', folderId, editorState: null, updatedAt: now },
    ],
  })
}

export function updateNote(
  vault: VaultDocument,
  noteId: string,
  patch: Partial<Pick<Note, 'title' | 'editorState' | 'folderId' | 'updatedAt'>>,
): VaultDocument {
  return sortVaultNotes({
    ...vault,
    notes: vault.notes.map((note) =>
      note.id === noteId ? { ...note, ...patch } : note,
    ),
  })
}

export function deleteNote(vault: VaultDocument, noteId: string): VaultDocument {
  return { ...vault, notes: vault.notes.filter((note) => note.id !== noteId) }
}

export function addFolder(vault: VaultDocument, id: string, name: string): VaultDocument {
  return { ...vault, folders: [...vault.folders, { id, name }] }
}

export function renameFolder(
  vault: VaultDocument,
  folderId: string,
  name: string,
): VaultDocument {
  return {
    ...vault,
    folders: vault.folders.map((folder) =>
      folder.id === folderId ? { ...folder, name } : folder,
    ),
  }
}

/**
 * Delete a folder and move its contained notes back to the root collection.
 * This keeps user content intact while removing the folder.
 */
export function deleteFolder(vault: VaultDocument, folderId: string): VaultDocument {
  return {
    ...vault,
    folders: vault.folders.filter((folder) => folder.id !== folderId),
    notes: vault.notes.map((note) =>
      note.folderId === folderId ? { ...note, folderId: null } : note,
    ),
  }
}

export function moveNote(
  vault: VaultDocument,
  noteId: string,
  folderId: string | null,
): VaultDocument {
  const validFolderIds = new Set(vault.folders.map((folder) => folder.id))
  if (folderId !== null && !validFolderIds.has(folderId)) {
    throw new VaultValidationError(`cannot move note to missing folder ${folderId}`)
  }
  return sortVaultNotes({
    ...vault,
    notes: vault.notes.map((note) =>
      note.id === noteId ? { ...note, folderId } : note,
    ),
  })
}
