import type { ConflictState } from '../lib/sync'

interface ConflictDialogProps {
  conflict: ConflictState
  onResolve: (action: 'load-remote' | 'keep-local' | 'export-local') => void
}

export function ConflictDialog({ conflict, onResolve }: ConflictDialogProps) {
  const remoteMissing = conflict.remoteDoc === null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h2 id="conflict-title" className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
          Vault changed on another device
        </h2>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          You have unsaved local changes, and the server has a newer vault. Your
          local draft is preserved. Choose how to continue.
        </p>

        {remoteMissing ? (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            The remote vault could not be loaded yet. You can retry loading it or
            keep your local draft.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onResolve('load-remote')}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-left font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {remoteMissing ? 'Retry loading remote' : 'Load remote vault'}
          </button>
          <button
            type="button"
            onClick={() => onResolve('keep-local')}
            className="rounded-lg border border-indigo-200 px-4 py-2 text-left font-medium text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
          >
            Keep my local draft and overwrite remote
          </button>
          <button
            type="button"
            onClick={() => onResolve('export-local')}
            className="rounded-lg border border-slate-200 px-4 py-2 text-left font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Export local draft as JSON
          </button>
        </div>

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          Loading remote discards local changes. Keeping local overwrites the
          remote vault using the latest remote version.
        </p>
      </div>
    </div>
  )
}
