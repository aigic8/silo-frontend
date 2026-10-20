interface SessionExpiredDialogProps {
  onExport: () => void
  onDiscard: () => void
}

export function SessionExpiredDialog({
  onExport,
  onDiscard,
}: SessionExpiredDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h2 id="session-expired-title" className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
          Session expired
        </h2>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Your session is no longer valid. Saving and editing are paused, but
          your current draft is still held in memory on this device.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onExport}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-left font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            Export local draft as JSON
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg border border-red-200 px-4 py-2 text-left font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
          >
            Discard draft and sign out
          </button>
        </div>
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          Export first if you want to keep unsaved work. Signing out wipes the
          encryption key and draft from this device.
        </p>
      </div>
    </div>
  )
}
