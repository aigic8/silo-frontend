import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api, ApiError } from './lib/api'

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
    },
  }
})

afterEach(cleanup)

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('locks an existing session and asks for the passphrase', async () => {
    vi.mocked(api.me).mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      salt: 'c2FsdA==',
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Unlock your vault' })).toBeInTheDocument()
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument()
  })

  it('shows the auth dialog when there is no session', async () => {
    vi.mocked(api.me).mockRejectedValue(new ApiError(401, 'Unauthorized'))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Create your vault' })).toBeInTheDocument()
  })

  it('verifies the passphrase before entering the ready editor', async () => {
    vi.mocked(api.me).mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      salt: 'c2FsdA==',
    })
    vi.mocked(api.login).mockRejectedValue(new ApiError(401, 'Unauthorized'))

    render(<App />)

    await screen.findByRole('heading', { name: 'Unlock your vault' })
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'wrong passphrase long enough' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('Incorrect passphrase')).toBeInTheDocument()
    expect(screen.queryByText('No note selected')).not.toBeInTheDocument()
    expect(api.login).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@example.com' }),
    )
  })
})
