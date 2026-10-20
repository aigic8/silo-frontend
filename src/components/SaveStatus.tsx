import type { SyncStatus } from '../lib/sync'

interface SaveStatusProps {
  status: SyncStatus
  connected: boolean
  dirty: boolean
  errorMessage?: string | null
  onRetry: () => void
}

export function SaveStatus({
  status,
  connected,
  dirty,
  errorMessage,
  onRetry,
}: SaveStatusProps) {
  if (status === 'loading') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Loading…
      </span>
    )
  }

  if (status === 'conflict') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Conflict — choose an action
      </span>
    )
  }

  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Saving…
      </span>
    )
  }

  if (status === 'offline' || (dirty && !connected)) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
      >
        {dirty ? 'Unsaved — retry' : 'Offline — retry'}
      </button>
    )
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={errorMessage ?? 'Error — retry'}
        aria-label={errorMessage ?? 'Error — retry'}
        className="inline-flex max-w-xs items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
      >
        <span className="truncate">{errorMessage ?? 'Error — retry'}</span>
      </button>
    )
  }

  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Unsaved changes
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
      Saved
    </span>
  )
}
