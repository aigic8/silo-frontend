import { useEffect, useRef, useState, type FormEvent } from 'react'

export type AuthMode = 'login' | 'signup'

interface AuthDialogProps {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onSubmit: (email: string, passphrase: string) => Promise<void>
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase())
}

export function AuthDialog({
  mode,
  onModeChange,
  onSubmit,
  theme,
  onToggleTheme,
}: AuthDialogProps) {
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [mode])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)

    if (!isValidEmail(email)) {
      setError('Enter a valid email address.')
      return
    }
    if (passphrase.length < 12) {
      setError('Passphrase must be at least 12 characters.')
      return
    }

    setBusy(true)
    try {
      await onSubmit(email.trim().toLowerCase(), passphrase)
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Authentication failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Silo</h1>
          <button
            type="button"
            onClick={onToggleTheme}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-title"
        >
          <h2 id="auth-title" className="mb-1 text-xl font-semibold">
            {mode === 'signup' ? 'Create your vault' : 'Sign in'}
          </h2>
          <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
            Your notes are encrypted in your browser before they leave this device.
          </p>

          <div className="mb-4">
            <label htmlFor="auth-email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              ref={emailRef}
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-indigo-900"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="auth-passphrase" className="mb-1 block text-sm font-medium">
              Passphrase
            </label>
            <input
              id="auth-passphrase"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={12}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-indigo-900"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Minimum 12 characters. There is no password recovery — losing your
              passphrase loses your vault.
            </p>
          </div>

          {error ? (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? 'Deriving keys…'
              : mode === 'signup'
                ? 'Create vault'
                : 'Sign in'}
          </button>

          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {mode === 'signup' ? 'Already have an account?' : 'New to Silo?'}{' '}
            <button
              type="button"
              onClick={() => onModeChange(mode === 'signup' ? 'login' : 'signup')}
              className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            >
              {mode === 'signup' ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
