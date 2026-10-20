export interface AuthUser {
  id: string
  email: string
  salt: string
}

export interface VaultResponse {
  version: number
  ciphertext: string | null
  nonce: string | null
}

export interface VaultApi {
  getVault(): Promise<VaultResponse>
  putVault(
    expectedVersion: number,
    ciphertext: string,
    nonce: string,
  ): Promise<{ version: number }>
}

export interface WebSocketLike {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  close(): void
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Network request failed')
  }

  if (response.status === 204) {
    return undefined as T
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Some responses may not include JSON; fall through to status handling.
  }

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}`
    throw new ApiError(response.status, message)
  }

  return body as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export const api = {
  async health(): Promise<{ status: string }> {
    return request<{ status: string }>('/api/health')
  },

  async register(params: {
    email: string
    auth_key: string
    salt: string
  }): Promise<AuthUser> {
    return request<AuthUser>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  async getSalt(email: string): Promise<{ salt: string }> {
    return request<{ salt: string }>(
      `/api/auth/salt?email=${encodeURIComponent(canonicalizeEmail(email))}`,
    )
  },

  async login(params: { email: string; auth_key: string }): Promise<AuthUser> {
    return request<AuthUser>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  async me(): Promise<AuthUser> {
    return request<AuthUser>('/api/auth/me')
  },

  async logout(): Promise<void> {
    await request<void>('/api/auth/logout', { method: 'POST', body: '{}' })
  },
}

export const httpVaultApi: VaultApi = {
  async getVault(): Promise<VaultResponse> {
    return request<VaultResponse>('/api/vault')
  },

  async putVault(
    expectedVersion: number,
    ciphertext: string,
    nonce: string,
  ): Promise<{ version: number }> {
    return request<{ version: number }>('/api/vault', {
      method: 'PUT',
      body: JSON.stringify({ expected_version: expectedVersion, ciphertext, nonce }),
    })
  },
}

export function createEventsSocket(): WebSocketLike {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(`${protocol}//${window.location.host}/api/events`)
}
