import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError, type VaultApi, type WebSocketLike } from './api'
import { decryptVault, deriveKeys, encryptVault, type DerivedKeys } from './crypto'
import { VaultSyncController } from './sync'
import {
  addNote,
  createEmptyVault,
  type VaultDocument,
} from './vault'

class FakeVaultApi implements VaultApi {
  version = 0
  ciphertext: string | null = null
  nonce: string | null = null
  putCalls: Array<{ expectedVersion: number; ciphertext: string; nonce: string }> = []
  getCalls = 0
  failNextPut: Error | null = null
  failNextGet: Error | null = null
  nextGet: { version: number; ciphertext: string; nonce: string } | null = null
  putDelayMs = 0
  getDelayMs = 0

  async getVault() {
    this.getCalls += 1
    if (this.getDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.getDelayMs))
    }
    if (this.failNextGet) {
      const error = this.failNextGet
      this.failNextGet = null
      throw error
    }
    if (this.nextGet) {
      const response = this.nextGet
      this.nextGet = null
      return response
    }
    return { version: this.version, ciphertext: this.ciphertext, nonce: this.nonce }
  }

  async putVault(expectedVersion: number, ciphertext: string, nonce: string) {
    this.putCalls.push({ expectedVersion, ciphertext, nonce })
    if (this.putDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.putDelayMs))
    }
    if (this.failNextPut) {
      const error = this.failNextPut
      this.failNextPut = null
      throw error
    }
    if (expectedVersion !== this.version) {
      throw new ApiError(409, 'Vault changed on another device')
    }
    this.version += 1
    this.ciphertext = ciphertext
    this.nonce = nonce
    return { version: this.version }
  }

  async setRemoteVault(doc: VaultDocument, version: number, key: CryptoKey): Promise<void> {
    const encrypted = await encryptVault(doc, key)
    this.version = version
    this.ciphertext = encrypted.ciphertext
    this.nonce = encrypted.nonce
  }
}

class FakeSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  emitOpen(): void {
    this.onopen?.(new Event('open'))
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({
      data: JSON.stringify(payload),
    } as MessageEvent)
  }

  close(): void {
    this.onclose?.(new CloseEvent('close'))
  }
}

const remoteDoc: VaultDocument = addNote(createEmptyVault(), 'remote-note', 1)
const localDoc: VaultDocument = addNote(createEmptyVault(), 'local-note', 1)

describe('VaultSyncController', () => {
  let keys: DerivedKeys

  beforeAll(async () => {
    keys = await deriveKeys('correct horse battery staple', new Uint8Array(16))
  })

  function makeController(api: FakeVaultApi, socket: FakeSocket) {
    const controller = new VaultSyncController(keys, {
      vaultApi: api,
      createSocket: () => socket,
      debounceMs: 5,
      retryBaseMs: 5,
      retryMaxMs: 20,
    })
    controller.start()
    return controller
  }

  async function waitFor(
    assertion: () => void,
    timeout = 2_000,
  ): Promise<void> {
    await vi.waitFor(assertion, { timeout, interval: 5 })
  }

  it('loads an empty vault and marks it initialized', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    const controller = makeController(api, socket)

    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(controller.snapshot().draft).toEqual(createEmptyVault())
    expect(controller.snapshot().serverVersion).toBe(0)
    expect(controller.snapshot().initialized).toBe(true)
    expect(controller.snapshot().revision).toBe(1)
    controller.dispose()
  })

  it('does not let socket open before the initial fetch wedge an empty vault', async () => {
    const api = new FakeVaultApi()
    api.getDelayMs = 10
    const socket = new FakeSocket()
    const controller = makeController(api, socket)

    socket.emitOpen()
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(controller.snapshot().initialized).toBe(true)
    expect(controller.snapshot().serverVersion).toBe(0)
    controller.dispose()
  })

  it('blocks edits until the first verified load and then installs remote content', async () => {
    const api = new FakeVaultApi()
    api.getDelayMs = 15
    await api.setRemoteVault(remoteDoc, 4, keys.encryptionKey)
    const socket = new FakeSocket()
    const controller = makeController(api, socket)

    controller.mutate((draft) => addNote(draft, 'blocked-note', 1))
    expect(controller.snapshot().initialized).toBe(false)
    expect(controller.snapshot().draft).toEqual(createEmptyVault())

    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(controller.snapshot().draft).toEqual(remoteDoc)
    expect(controller.snapshot().serverVersion).toBe(4)
    expect(controller.snapshot().dirty).toBe(false)
    controller.dispose()
  })

  it('retries a failed initial load', async () => {
    const api = new FakeVaultApi()
    api.failNextGet = new ApiError(0, 'Network request failed')
    const socket = new FakeSocket()
    const controller = makeController(api, socket)

    await waitFor(() => expect(controller.snapshot().status).toBe('offline'))
    expect(controller.snapshot().initialized).toBe(false)

    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(controller.snapshot().initialized).toBe(true)
    expect(controller.snapshot().serverVersion).toBe(0)
    controller.dispose()
  })

  it('debounces and saves edits with a serialized CAS request', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(api.version).toBe(1)
    expect(api.putCalls).toHaveLength(1)
    expect(api.putCalls[0]?.expectedVersion).toBe(0)

    const decrypted = await decryptVault(
      { ciphertext: api.ciphertext!, nonce: api.nonce! },
      keys.encryptionKey,
    )
    expect(decrypted).toEqual(localDoc)
    controller.dispose()
  })

  it('serializes edits that arrive while a save is in flight', async () => {
    const api = new FakeVaultApi()
    api.putDelayMs = 20
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().status).toBe('saving'))

    const newerDoc = addNote(localDoc, 'second-note', 2)
    controller.setDraft(newerDoc)

    await waitFor(() => expect(api.version).toBe(2))
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    const decrypted = await decryptVault(
      { ciphertext: api.ciphertext!, nonce: api.nonce! },
      keys.encryptionKey,
    )
    expect(decrypted).toEqual(newerDoc)
    controller.dispose()
  })

  it('preserves the local draft on a save conflict', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    await api.setRemoteVault(remoteDoc, 5, keys.encryptionKey)
    controller.setDraft(localDoc)

    await waitFor(() => expect(controller.snapshot().conflict?.remoteDoc).toEqual(remoteDoc))
    const conflict = controller.snapshot().conflict
    expect(controller.snapshot().status).toBe('conflict')
    expect(conflict?.remoteVersion).toBe(5)
    expect(conflict?.remoteDoc).toEqual(remoteDoc)
    expect(conflict?.localDoc).toEqual(localDoc)
    expect(controller.snapshot().dirty).toBe(true)
    controller.dispose()
  })

  it('keep-local resolves a conflict with the latest remote CAS version', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    await api.setRemoteVault(remoteDoc, 5, keys.encryptionKey)
    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().conflict?.remoteDoc).toEqual(remoteDoc))

    controller.resolveConflict('keep-local')
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    expect(api.version).toBe(6)
    expect(api.putCalls.at(-1)?.expectedVersion).toBe(5)
    const decrypted = await decryptVault(
      { ciphertext: api.ciphertext!, nonce: api.nonce! },
      keys.encryptionKey,
    )
    expect(decrypted).toEqual(localDoc)
    controller.dispose()
  })

  it('load-remote bumps the editor revision', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    const initialRevision = controller.snapshot().revision

    await api.setRemoteVault(remoteDoc, 5, keys.encryptionKey)
    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().conflict?.remoteDoc).toEqual(remoteDoc))

    controller.resolveConflict('load-remote')
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(controller.snapshot().draft).toEqual(remoteDoc)
    expect(controller.snapshot().revision).toBe(initialRevision + 1)
    controller.dispose()
  })

  it('raises a conflict on a remote update while local edits are unsaved', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    await api.setRemoteVault(remoteDoc, 5, keys.encryptionKey)
    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().status).toBe('dirty'))

    socket.emitMessage({ type: 'vault_changed', version: 5 })
    await waitFor(() => expect(controller.snapshot().status).toBe('conflict'))
    expect(controller.snapshot().conflict?.localDoc).toEqual(localDoc)
    controller.dispose()
  })

  it('applies a remote update when there are no local edits', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    await api.setRemoteVault(remoteDoc, 7, keys.encryptionKey)
    socket.emitMessage({ type: 'vault_changed', version: 7 })

    await waitFor(() => expect(controller.snapshot().serverVersion).toBe(7))
    expect(controller.snapshot().draft).toEqual(remoteDoc)
    controller.dispose()
  })

  it('retries a save after a transient network failure', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    api.failNextPut = new ApiError(0, 'Network request failed')
    controller.setDraft(localDoc)

    await waitFor(() => expect(controller.snapshot().status).toBe('offline'))
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(api.version).toBe(1)
    controller.dispose()
  })

  it('freezes a dirty draft when a save returns 401', async () => {
    const api = new FakeVaultApi()
    api.putDelayMs = 20
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().status).toBe('saving'))
    api.failNextPut = new ApiError(401, 'Unauthorized')

    await waitFor(() => expect(controller.snapshot().sessionExpired).toBe(true))
    expect(controller.snapshot().draft).toEqual(localDoc)
    expect(controller.snapshot().dirty).toBe(true)

    controller.mutate((draft) => addNote(draft, 'must-not-write', 2))
    expect(controller.snapshot().draft).toEqual(localDoc)
    controller.dispose()
  })

  it('ignores the websocket echo of its own in-flight save', async () => {
    const api = new FakeVaultApi()
    api.putDelayMs = 20
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().status).toBe('saving'))

    socket.emitMessage({ type: 'vault_changed', version: 1 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(controller.snapshot().conflict).toBeNull()

    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(controller.snapshot().serverVersion).toBe(1)
    expect(controller.snapshot().conflict).toBeNull()
    controller.dispose()
  })

  it('reconciles a pending higher remote version after a successful save', async () => {
    const api = new FakeVaultApi()
    api.putDelayMs = 20
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    const encryptedRemote = await encryptVault(remoteDoc, keys.encryptionKey)
    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().status).toBe('saving'))

    api.nextGet = { version: 2, ...encryptedRemote }
    socket.emitMessage({ type: 'vault_changed', version: 2 })

    await waitFor(() => expect(controller.snapshot().serverVersion).toBe(2))
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(controller.snapshot().draft).toEqual(remoteDoc)
    expect(controller.snapshot().conflict).toBeNull()
    controller.dispose()
  })

  it('raises a conflict when a pending remote watermark arrives with local edits', async () => {
    const api = new FakeVaultApi()
    api.putDelayMs = 20
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    const encryptedRemote = await encryptVault(remoteDoc, keys.encryptionKey)
    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().status).toBe('saving'))

    const newerDoc = addNote(localDoc, 'second-note', 2)
    controller.setDraft(newerDoc)
    api.nextGet = { version: 2, ...encryptedRemote }
    socket.emitMessage({ type: 'vault_changed', version: 2 })

    await waitFor(() => expect(controller.snapshot().status).toBe('conflict'))
    expect(controller.snapshot().conflict?.localDoc).toEqual(newerDoc)
    expect(controller.snapshot().conflict?.remoteDoc).toEqual(remoteDoc)
    controller.dispose()
  })

  it('does not initiate a stale PUT when encryption finishes after dispose/restart', async () => {
    const api = new FakeVaultApi()
    const socket = new FakeSocket()
    let releaseEncryption!: () => void
    const encryptionGate = new Promise<void>((resolve) => {
      releaseEncryption = resolve
    })

    const controller = new VaultSyncController(keys, {
      vaultApi: api,
      createSocket: () => socket,
      debounceMs: 5,
      retryBaseMs: 5,
      retryMaxMs: 20,
      encryptVault: async () => {
        await encryptionGate
        return { ciphertext: 'ignored', nonce: 'ignored' }
      },
    })
    controller.start()
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    controller.setDraft(localDoc)
    await waitFor(() => expect(controller.snapshot().status).toBe('saving'))

    controller.dispose()
    controller.start()
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    releaseEncryption()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(api.putCalls).toHaveLength(0)
    expect(api.version).toBe(0)
    controller.dispose()
  })

  it('acknowledges that an already-sent PUT commits even though stale state is ignored', async () => {
    const api = new FakeVaultApi()
    api.putDelayMs = 60
    const socket = new FakeSocket()
    const controller = makeController(api, socket)
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))

    controller.setDraft(localDoc)
    await waitFor(() => expect(api.putCalls).toHaveLength(1))

    controller.dispose()
    controller.start()
    await waitFor(() => expect(controller.snapshot().status).toBe('saved'))
    expect(controller.snapshot().serverVersion).toBe(0)
    expect(controller.snapshot().draft).toEqual(createEmptyVault())

    // The HTTP write was already sent before dispose; the client cannot
    // retract it. Assert the server commit still happens but cannot mutate
    // the restarted local lifecycle.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(controller.snapshot().serverVersion).toBe(0)
    expect(controller.snapshot().draft).toEqual(createEmptyVault())
    expect(api.version).toBe(1)
    controller.dispose()
  })
})
