import { useCallback, useEffect, useState } from 'react'
import { AuthDialog, type AuthMode } from './components/AuthDialog'
import { UnlockScreen } from './components/UnlockScreen'
import { useTheme } from './hooks/useTheme'
import { api, ApiError, type AuthUser } from './lib/api'
import { base64ToBytes } from './lib/base64'
import { deriveKeys, generateSalt, type DerivedKeys } from './lib/crypto'
import { VaultValidationError } from './lib/vault'
import { VaultApp } from './VaultApp'

type AuthState =
  | { phase: 'booting' }
  | { phase: 'signedOut' }
  | { phase: 'locked'; user: AuthUser; error: string | null }
  | { phase: 'ready'; user: AuthUser; keys: DerivedKeys }
  | { phase: 'error'; message: string }

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [auth, setAuth] = useState<AuthState>({ phase: 'booting' })
  const [authMode, setAuthMode] = useState<AuthMode>('signup')

  const boot = useCallback(async () => {
    setAuth({ phase: 'booting' })
    try {
      const user = await api.me()
      setAuth({ phase: 'locked', user, error: null })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth({ phase: 'signedOut' })
        return
      }
      setAuth({
        phase: 'error',
        message:
          error instanceof Error ? error.message : 'Could not reach the server.',
      })
    }
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  const handleAuthSubmit = useCallback(
    async (email: string, passphrase: string): Promise<void> => {
      if (authMode === 'signup') {
        const salt = generateSalt()
        const keys = await deriveKeys(passphrase, salt)
        const user = await api.register({
          email,
          auth_key: keys.authKeyBase64,
          salt: keys.saltBase64,
        })
        setAuth({ phase: 'ready', user, keys })
        return
      }

      let saltBase64: string
      try {
        const response = await api.getSalt(email)
        saltBase64 = response.salt
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw new Error('Invalid email or passphrase')
        }
        throw error
      }

      const keys = await deriveKeys(passphrase, base64ToBytes(saltBase64))
      try {
        const user = await api.login({ email, auth_key: keys.authKeyBase64 })
        setAuth({ phase: 'ready', user, keys })
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw new Error('Invalid email or passphrase')
        }
        throw error
      }
    },
    [authMode],
  )

  const handleUnlock = useCallback(
    async (passphrase: string): Promise<void> => {
      if (auth.phase !== 'locked') return
      const keys = await deriveKeys(passphrase, base64ToBytes(auth.user.salt))
      try {
        const verifiedUser = await api.login({
          email: auth.user.email,
          auth_key: keys.authKeyBase64,
        })
        if (
          verifiedUser.id !== auth.user.id ||
          verifiedUser.email !== auth.user.email ||
          verifiedUser.salt !== auth.user.salt
        ) {
          throw new Error('Account identity changed. Sign in again.')
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw new Error('Incorrect passphrase')
        }
        throw error
      }
      setAuth({ phase: 'ready', user: auth.user, keys })
    },
    [auth],
  )

  const handleSignOut = useCallback(async (): Promise<void> => {
    await api.logout()
    setAuth({ phase: 'signedOut' })
  }, [])

  const handleFatal = useCallback((error: Error) => {
    const message =
      error instanceof VaultValidationError
        ? 'The vault data is invalid or corrupt.'
        : 'Could not decrypt the vault. Check your passphrase.'
    setAuth((current) =>
      current.phase === 'ready'
        ? { phase: 'locked', user: current.user, error: message }
        : current,
    )
  }, [])

  if (auth.phase === 'booting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <p role="status">Checking session…</p>
      </div>
    )
  }

  if (auth.phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="mb-2 text-xl font-semibold">Server unavailable</h1>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{auth.message}</p>
          <button
            type="button"
            onClick={() => void boot()}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (auth.phase === 'signedOut') {
    return (
      <AuthDialog
        mode={authMode}
        onModeChange={setAuthMode}
        onSubmit={handleAuthSubmit}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    )
  }

  if (auth.phase === 'locked') {
    return (
      <UnlockScreen
        email={auth.user.email}
        error={auth.error}
        theme={theme}
        onToggleTheme={toggleTheme}
        onUnlock={handleUnlock}
        onSignOut={handleSignOut}
      />
    )
  }

  return (
    <VaultApp
      keys={auth.keys}
      user={auth.user}
      theme={theme}
      onToggleTheme={toggleTheme}
      onSignOut={handleSignOut}
      onDiscardSession={() => setAuth({ phase: 'signedOut' })}
      onFatal={handleFatal}
    />
  )
}
