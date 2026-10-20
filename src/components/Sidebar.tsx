import { useState, type FormEvent, type ReactNode } from 'react'
import type { Folder, Note, VaultDocument } from '../lib/vault'

interface SidebarProps {
  vault: VaultDocument
  selectedNoteId: string | null
  collapsed: boolean
  userEmail: string
  onSelectNote: (id: string) => void
  onAddNote: (folderId: string | null) => void
  onDeleteNote: (id: string) => void
  onRenameNote: (id: string, title: string) => void
  onMoveNote: (id: string, folderId: string | null) => void
  onAddFolder: (name: string) => void
  onRenameFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
  onToggleSidebar: () => void
  onLogout: () => void
}

function IconButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus:ring-indigo-900 ${
        danger ? 'hover:text-red-600 dark:hover:text-red-400' : ''
      }`}
    >
      {children}
    </button>
  )
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4V4z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M5.5 2V1h5v1H13v2H3V2h2.5zM4 5h8l-.6 9.2a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8L4 5zm1.5 2v6h2V7h-2zm3 0v6h2V7h-2z" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M11.3 2.3l2.4 2.4-8.2 8.2-3 .6.6-3 8.2-8.2zm0-1.4L3.4 8.8 2.5 13l4.2-.9 7.9-7.9-3.3-3.3z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden="true"
    >
      {collapsed ? (
        <path d="M6 3L11 8l-5 5V3z" />
      ) : (
        <path d="M10 3L5 8l5 5V3z" />
      )}
    </svg>
  )
}

function titleFor(note: Note): string {
  return note.title.trim() === '' ? 'Untitled' : note.title
}

export function Sidebar(props: SidebarProps) {
  const {
    vault,
    selectedNoteId,
    collapsed,
    userEmail,
    onSelectNote,
    onAddNote,
    onDeleteNote,
    onRenameNote,
    onMoveNote,
    onAddFolder,
    onRenameFolder,
    onDeleteFolder,
    onToggleSidebar,
    onLogout,
  } = props

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(vault.folders.map((folder) => folder.id)),
  )
  const [addingFolder, setAddingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteTitle, setEditingNoteTitle] = useState('')

  const rootNotes = vault.notes.filter((note) => note.folderId === null)
  const folders = vault.folders
  const notesInFolder = (folderId: string): Note[] =>
    vault.notes.filter((note) => note.folderId === folderId)

  function toggleFolder(folderId: string): void {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  function startAddFolder(): void {
    setAddingFolder(true)
    setNewFolderName('')
  }

  function submitAddFolder(event: FormEvent): void {
    event.preventDefault()
    const name = newFolderName.trim()
    if (name) onAddFolder(name)
    setAddingFolder(false)
    setNewFolderName('')
  }

  function submitRenameFolder(event: FormEvent, folderId: string): void {
    event.preventDefault()
    const name = editingFolderName.trim()
    if (name) onRenameFolder(folderId, name)
    setEditingFolderId(null)
    setEditingFolderName('')
  }

  function submitRenameNote(event: FormEvent, noteId: string): void {
    event.preventDefault()
    onRenameNote(noteId, editingNoteTitle)
    setEditingNoteId(null)
    setEditingNoteTitle('')
  }

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-l border-slate-200 bg-white py-3 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mb-4 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <CollapseIcon collapsed />
        </button>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          title="Log out"
          className="mt-auto rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M6 1h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6v-2h5V3H6V1zM2 4l4 4-4 4v-3H1V7h1V4z" />
          </svg>
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <h2 className="text-sm font-semibold">Files</h2>
        <div className="flex items-center gap-1">
          <IconButton label="New note" onClick={() => onAddNote(null)}>
            <PlusIcon />
          </IconButton>
          <IconButton label="New folder" onClick={startAddFolder}>
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M1 3h5l1.5 1.5H15V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3zm2 2v6h10V6H3z" />
            </svg>
          </IconButton>
          <IconButton label="Collapse sidebar" onClick={onToggleSidebar}>
            <CollapseIcon collapsed={false} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {addingFolder ? (
          <form onSubmit={submitAddFolder} className="mb-2 flex gap-1">
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              aria-label="Folder name"
              placeholder="Folder name"
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <button type="submit" className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white">
              Add
            </button>
            <button
              type="button"
              onClick={() => setAddingFolder(false)}
              className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </form>
        ) : null}

        <div className="mb-1 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Notes
        </div>
        {rootNotes.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            folders={folders}
            selected={note.id === selectedNoteId}
            onSelect={onSelectNote}
            onDelete={onDeleteNote}
            onMove={onMoveNote}
            editing={editingNoteId === note.id}
            editingTitle={editingNoteTitle}
            onStartEdit={() => {
              setEditingNoteId(note.id)
              setEditingNoteTitle(note.title)
            }}
            onEditChange={setEditingNoteTitle}
            onEditSubmit={(event) => submitRenameNote(event, note.id)}
            onEditCancel={() => setEditingNoteId(null)}
          />
        ))}

        {folders.length > 0 ? (
          <div className="mb-1 mt-3 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Folders
          </div>
        ) : null}

        {folders.map((folder) => {
          const expanded = expandedFolders.has(folder.id)
          const folderNotes = notesInFolder(folder.id)
          return (
            <div key={folder.id} className="mb-1">
              <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
                <button
                  type="button"
                  onClick={() => toggleFolder(folder.id)}
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${folder.name}`}
                  className="rounded p-0.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  <Chevron expanded={expanded} />
                </button>
                {editingFolderId === folder.id ? (
                  <form
                    onSubmit={(event) => submitRenameFolder(event, folder.id)}
                    className="flex flex-1 gap-1"
                  >
                    <input
                      autoFocus
                      value={editingFolderName}
                      onChange={(event) => setEditingFolderName(event.target.value)}
                      aria-label="Rename folder"
                      className="w-full rounded-md border border-slate-300 px-1 py-0.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                    <button type="submit" className="rounded px-1 text-xs text-indigo-600">
                      Save
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 truncate text-sm font-medium">{folder.name}</span>
                    <span className="text-xs text-slate-400">{folderNotes.length}</span>
                    <div className="hidden gap-0.5 group-hover:flex">
                      <IconButton
                        label={`Rename ${folder.name}`}
                        onClick={() => {
                          setEditingFolderId(folder.id)
                          setEditingFolderName(folder.name)
                        }}
                      >
                        <PencilIcon />
                      </IconButton>
                      <IconButton
                        label={`Delete ${folder.name}`}
                        danger
                        onClick={() => onDeleteFolder(folder.id)}
                      >
                        <TrashIcon />
                      </IconButton>
                    </div>
                  </>
                )}
              </div>

              {expanded ? (
                <div className="ml-3 border-l border-slate-200 pl-1 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => onAddNote(folder.id)}
                    className="mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  >
                    <PlusIcon /> New note
                  </button>
                  {folderNotes.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      folders={folders}
                      selected={note.id === selectedNoteId}
                      onSelect={onSelectNote}
                      onDelete={onDeleteNote}
                      onMove={onMoveNote}
                      editing={editingNoteId === note.id}
                      editingTitle={editingNoteTitle}
                      onStartEdit={() => {
                        setEditingNoteId(note.id)
                        setEditingNoteTitle(note.title)
                      }}
                      onEditChange={setEditingNoteTitle}
                      onEditSubmit={(event) => submitRenameNote(event, note.id)}
                      onEditCancel={() => setEditingNoteId(null)}
                    />
                  ))}
                  {folderNotes.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-slate-400 dark:text-slate-500">
                      Empty folder
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-800">
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{userEmail}</p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Log out
        </button>
      </div>
    </aside>
  )
}

interface NoteRowProps {
  note: Note
  folders: Folder[]
  selected: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, folderId: string | null) => void
  editing: boolean
  editingTitle: string
  onStartEdit: () => void
  onEditChange: (value: string) => void
  onEditSubmit: (event: FormEvent) => void
  onEditCancel: () => void
}

function NoteRow({
  note,
  folders,
  selected,
  onSelect,
  onDelete,
  onMove,
  editing,
  editingTitle,
  onStartEdit,
  onEditChange,
  onEditSubmit,
  onEditCancel,
}: NoteRowProps) {
  return (
    <div
      className={`group mb-0.5 flex items-center gap-1 rounded-md px-1 py-1 ${
        selected
          ? 'bg-indigo-50 dark:bg-indigo-950'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800'
      }`}
    >
      {editing ? (
        <form onSubmit={onEditSubmit} className="flex flex-1 gap-1">
          <input
            autoFocus
            value={editingTitle}
            onChange={(event) => onEditChange(event.target.value)}
            aria-label="Note title"
            className="w-full rounded-md border border-slate-300 px-1 py-0.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <button type="submit" className="rounded px-1 text-xs text-indigo-600">
            Save
          </button>
          <button
            type="button"
            onClick={onEditCancel}
            className="rounded px-1 text-xs text-slate-500"
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onSelect(note.id)}
            className="min-w-0 flex-1 truncate text-left text-sm"
            title={titleFor(note)}
          >
            {titleFor(note)}
          </button>
          <select
            aria-label={`Move ${titleFor(note)} to folder`}
            value={note.folderId ?? ''}
            onChange={(event) =>
              onMove(note.id, event.target.value === '' ? null : event.target.value)
            }
            className="max-w-24 rounded border border-slate-200 bg-white text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"
          >
            <option value="">Notes</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <div className="hidden gap-0.5 group-hover:flex">
            <IconButton label={`Rename ${titleFor(note)}`} onClick={onStartEdit}>
              <PencilIcon />
            </IconButton>
            <IconButton label={`Delete ${titleFor(note)}`} danger onClick={() => onDelete(note.id)}>
              <TrashIcon />
            </IconButton>
          </div>
        </>
      )}
    </div>
  )
}
