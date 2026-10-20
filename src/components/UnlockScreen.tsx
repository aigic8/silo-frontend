import { useEffect, useRef, useState, type FormEvent } from 'react'

interface UnlockScreenProps {
  email: string
  error: string | null
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onUnlock: (passphrase: string) => Promise<void>
  onSignOut: () => Promise<void>
}

export function UnlockScreen({
  email,
  error,
  theme,
  onToggleTheme,
  onUnlock,
  onSignOut,
}: UnlockScreenProps) {
  const [passphrase, setPassphrase] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (error) setLocalError(error)
  }, [error])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setLocalError(null)
    if (passphrase.length < 12) {
      setLocalError('Passphrase must be at least 12 characters.')
      return
    }
    setBusy(true)
    try {
      await onUnlock(passphrase)
    } catch (unlockError) {
      setLocalError(
        unlockError instanceof Error
          ? unlockError.message
          : 'Could not unlock the vault.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOut(): Promise<void> {
    setSignOutBusy(true)
    try {
      await onSignOut()
    } catch {
      setLocalError('Could not sign out. Try again.')
    } finally {
      setSignOutBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        className="absolute right-4 top-4 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-title"
      >
        <h1 id="unlock-title" className="mb-1 text-xl font-semibold">
          Unlock your vault
        </h1>
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
          Signed in as {email}. Your vault is encrypted and never leaves this
          device in plaintext.
        </p>

        <label htmlFor="unlock-passphrase" className="mb-1 block text-sm font-medium">
          Passphrase
        </label>
        <input
          ref={inputRef}
          id="unlock-passphrase"
          type="password"
          autoComplete="current-password"
          required
          minLength={12}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-indigo-900"
        />

        {localError ? (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {localError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Deriving keys…' : 'Unlock'}
        </button>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signOutBusy}
          className="mt-3 w-full rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {signOutBusy ? 'Signing out…' : 'Use a different account'}
        </button>
      </form>
    </div>
  )
}
