import { ApiError, type VaultApi, type WebSocketLike } from './api'
import { decryptVault, encryptVault, type DerivedKeys } from './crypto'
import { createEmptyVault, type VaultDocument } from './vault'

export type SyncStatus =
  | 'loading'
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'error'
  | 'conflict'

export interface ConflictState {
  remoteVersion: number | null
  remoteDoc: VaultDocument | null
  localDoc: VaultDocument
}

export interface VaultSyncSnapshot {
  draft: VaultDocument
  serverVersion: number
  status: SyncStatus
  connected: boolean
  dirty: boolean
  conflict: ConflictState | null
  errorMessage: string | null
}

export interface VaultSyncOptions {
  vaultApi: VaultApi
  createSocket: () => WebSocketLike
  debounceMs?: number
  retryBaseMs?: number
  retryMaxMs?: number
  onAuthError?: () => void
  onFatal?: (error: Error) => void
}

const DEFAULT_DEBOUNCE_MS = 800
const DEFAULT_RETRY_BASE_MS = 2_000
const DEFAULT_RETRY_MAX_MS = 30_000
const MAX_VAULT_BYTES = 7 * 1024 * 1024
const textEncoder = new TextEncoder()

type ResolveAction = 'load-remote' | 'keep-local' | 'export-local'

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export class VaultSyncController {
  private draftDoc: VaultDocument = createEmptyVault()
  private dirtyFlag = false
  private serverVersion = 0
  private status: SyncStatus = 'loading'
  private connectedFlag = false
  private conflictState: ConflictState | null = null
  private errorMessage: string | null = null

  private readonly listeners = new Set<() => void>()
  private inflight = false
  private queued = false
  private generation = 0
  private retryAttempt = 0
  private disposed = false
  private socket: WebSocketLike | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly keys: DerivedKeys,
    private readonly options: VaultSyncOptions,
  ) {}

  snapshot(): VaultSyncSnapshot {
    return {
      draft: this.draftDoc,
      serverVersion: this.serverVersion,
      status: this.status,
      connected: this.connectedFlag,
      dirty: this.dirtyFlag,
      conflict: this.conflictState,
      errorMessage: this.errorMessage,
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  start(): void {
    // Restarting must be safe: React StrictMode mounts, unmounts, then mounts
    // the same controller instance again in development.
    this.socket?.close()
    this.socket = null
    this.clearTimers()
    this.disposed = false
    this.generation += 1
    this.draftDoc = createEmptyVault()
    this.dirtyFlag = false
    this.serverVersion = 0
    this.status = 'loading'
    this.connectedFlag = false
    this.conflictState = null
    this.errorMessage = null
    this.inflight = false
    this.queued = false
    this.retryAttempt = 0
    this.emit()
    void this.loadInitial()
    this.connectSocket()
  }

  dispose(): void {
    this.disposed = true
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.listeners.clear()
  }

  setDraft = (next: VaultDocument): void => {
    this.mutate(() => next)
  }

  mutate = (mutator: (draft: VaultDocument) => VaultDocument): void => {
    if (this.disposed) return
    this.draftDoc = mutator(this.draftDoc)
    if (this.conflictState) {
      // Autosave is paused while the user has a conflict to resolve.
      this.emit()
      return
    }
    this.errorMessage = null
    this.dirtyFlag = true
    this.setStatus('dirty')
    this.scheduleSave()
  }

  retryNow = (): void => {
    if (this.disposed) return
    this.clearRetryTimer()
    this.clearDebounceTimer()
    this.errorMessage = null
    if (this.conflictState) {
      void this.fetchRemoteForConflict(this.conflictState.remoteVersion ?? undefined)
      return
    }
    if (this.dirtyFlag) {
      this.setStatus('dirty')
      this.enqueueSave()
      return
    }
    void this.applyRemote()
  }

  resolveConflict = (action: ResolveAction): void => {
    const conflict = this.conflictState
    if (!conflict || this.disposed) return

    if (action === 'export-local') {
      this.exportLocalDraft(conflict.localDoc)
      return
    }

    if (action === 'load-remote') {
      if (!conflict.remoteDoc || conflict.remoteVersion === null) {
        void this.fetchRemoteForConflict(conflict.remoteVersion ?? undefined)
        return
      }
      this.draftDoc = conflict.remoteDoc
      this.serverVersion = conflict.remoteVersion
      this.dirtyFlag = false
      this.conflictState = null
      this.errorMessage = null
      this.queued = false
      this.setStatus('saved')
      return
    }

    if (action === 'keep-local') {
      if (conflict.remoteVersion === null) {
        void this.fetchRemoteForConflict(undefined)
        return
      }
      this.serverVersion = conflict.remoteVersion
      this.conflictState = null
      this.errorMessage = null
      this.dirtyFlag = true
      this.queued = false
      this.setStatus('dirty')
      this.enqueueSave()
    }
  }

  private emit(): void {
    if (this.disposed) return
    for (const listener of this.listeners) listener()
  }

  private setStatus(status: SyncStatus): void {
    this.status = status
    this.emit()
  }

  private async loadInitial(): Promise<void> {
    const generation = ++this.generation
    try {
      const response = await this.options.vaultApi.getVault()
      if (!this.isCurrent(generation)) return
      const doc = await this.decryptResponse(response)
      if (!this.isCurrent(generation)) return
      this.draftDoc = doc
      this.serverVersion = response.version
      this.dirtyFlag = false
      this.setStatus('saved')
    } catch (error) {
      if (!this.isCurrent(generation)) return
      if (error instanceof ApiError) {
        if (error.status === 401) {
          this.options.onAuthError?.()
          return
        }
        this.setStatus('offline')
        return
      }
      this.setStatus('error')
      this.options.onFatal?.(toError(error))
    }
  }

  private async decryptResponse(response: {
    ciphertext: string | null
    nonce: string | null
  }): Promise<VaultDocument> {
    if (!response.ciphertext || !response.nonce) return createEmptyVault()
    return decryptVault(
      { ciphertext: response.ciphertext, nonce: response.nonce },
      this.keys.encryptionKey,
    )
  }

  private async applyRemote(): Promise<void> {
    // Let an in-flight save settle first; its CAS response is the source of
    // truth for whether the remote version changed.
    if (this.inflight && this.dirtyFlag) return
    const generation = ++this.generation
    try {
      const response = await this.options.vaultApi.getVault()
      if (!this.isCurrent(generation)) return
      const doc = await this.decryptResponse(response)
      if (!this.isCurrent(generation)) return
      if (response.version <= this.serverVersion) return
      if (this.dirtyFlag || this.conflictState) {
        await this.enterConflict(response.version, doc)
        return
      }
      this.draftDoc = doc
      this.serverVersion = response.version
      this.dirtyFlag = false
      this.setStatus('saved')
    } catch (error) {
      if (!this.isCurrent(generation)) return
      if (error instanceof ApiError) {
        if (error.status === 401) {
          this.options.onAuthError?.()
          return
        }
        this.setStatus('offline')
        return
      }
      this.setStatus('error')
      this.options.onFatal?.(toError(error))
    }
  }

  private connectSocket(): void {
    if (this.disposed) return
    this.clearReconnectTimer()

    let socket: WebSocketLike
    try {
      socket = this.options.createSocket()
    } catch {
      this.setConnected(false)
      this.scheduleReconnect()
      return
    }

    this.socket = socket

    socket.onopen = () => {
      if (this.disposed || this.socket !== socket) return
      this.retryAttempt = 0
      this.setConnected(true)
      // Reconnecting may have missed invalidation events, so fetch latest.
      void this.applyRemote()
    }

    socket.onmessage = (event) => {
      if (this.disposed || this.socket !== socket) return
      this.handleMessage(event)
    }

    socket.onerror = () => {
      // The browser follows this with onclose; reconnect is scheduled there.
    }

    socket.onclose = () => {
      if (this.disposed || this.socket !== socket) return
      this.socket = null
      this.setConnected(false)
      this.scheduleReconnect()
    }
  }

  private handleMessage(event: MessageEvent): void {
    let payload: unknown
    try {
      payload = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (!isRecord(payload)) return
    if (payload.type === 'vault_changed' && typeof payload.version === 'number') {
      void this.handleRemoteVersion(payload.version)
    }
  }

  private async handleRemoteVersion(version: number): Promise<void> {
    if (this.disposed || version <= this.serverVersion) return
    // A save that is already in flight owns reconciliation for the version it
    // is about to produce. This avoids treating our own save's websocket echo
    // (or a competing save whose result arrives via our PUT response) as a
    // separate conflict before the CAS response is known.
    if (this.inflight && this.dirtyFlag) return
    if (this.dirtyFlag || this.conflictState) {
      await this.fetchRemoteForConflict(version)
      return
    }
    await this.applyRemote()
  }

  private async fetchRemoteForConflict(knownVersion?: number): Promise<void> {
    const generation = ++this.generation
    const localDoc = this.draftDoc
    try {
      const response = await this.options.vaultApi.getVault()
      if (!this.isCurrent(generation)) return
      const doc = await this.decryptResponse(response)
      if (!this.isCurrent(generation)) return
      this.conflictState = {
        remoteVersion: response.version,
        remoteDoc: doc,
        localDoc,
      }
      this.setStatus('conflict')
    } catch (error) {
      if (!this.isCurrent(generation)) return
      if (error instanceof ApiError && error.status === 401) {
        this.options.onAuthError?.()
        return
      }
      this.conflictState = {
        remoteVersion: knownVersion ?? null,
        remoteDoc: null,
        localDoc,
      }
      this.setStatus('conflict')
    }
  }

  private async enterConflict(remoteVersion: number, remoteDoc: VaultDocument): Promise<void> {
    this.conflictState = {
      remoteVersion,
      remoteDoc,
      localDoc: this.draftDoc,
    }
    this.setStatus('conflict')
  }

  private scheduleSave(): void {
    if (this.disposed) return
    this.clearDebounceTimer()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.enqueueSave()
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
  }

  private enqueueSave(): void {
    if (this.disposed || this.conflictState || !this.dirtyFlag) return
    if (this.inflight) {
      this.queued = true
      return
    }
    void this.performSave()
  }

  private async performSave(): Promise<void> {
    if (this.inflight) return
    this.inflight = true
    try {
      while (this.dirtyFlag && !this.conflictState && !this.disposed) {
        this.setStatus('saving')
        const docToSave = this.draftDoc
        const expectedVersion = this.serverVersion

        if (textEncoder.encode(JSON.stringify(docToSave)).length > MAX_VAULT_BYTES) {
          this.errorMessage = 'Vault is too large to save. Remove some content and try again.'
          this.setStatus('error')
          return
        }

        let encrypted
        try {
          encrypted = await encryptVault(docToSave, this.keys.encryptionKey)
        } catch (error) {
          this.errorMessage = 'Could not encrypt the vault. Your data was not sent.'
          this.setStatus('error')
          this.options.onFatal?.(toError(error))
          return
        }

        try {
          const response = await this.options.vaultApi.putVault(
            expectedVersion,
            encrypted.ciphertext,
            encrypted.nonce,
          )
          if (this.disposed) return
          this.serverVersion = response.version
          this.retryAttempt = 0
          this.errorMessage = null
          if (this.draftDoc === docToSave) {
            this.dirtyFlag = false
          } else {
            this.queued = true
          }
          this.setStatus(this.dirtyFlag ? 'dirty' : 'saved')
        } catch (error) {
          if (this.disposed) return
          if (error instanceof ApiError && error.status === 409) {
            await this.enterConflictFromSave()
            return
          }
          if (error instanceof ApiError && error.status === 401) {
            this.options.onAuthError?.()
            return
          }
          if (error instanceof ApiError && error.status >= 500) {
            this.setStatus('offline')
            this.scheduleRetry()
            return
          }
          if (error instanceof ApiError && error.status >= 400) {
            this.errorMessage = error.message
            this.setStatus('error')
            return
          }
          this.setStatus('offline')
          this.scheduleRetry()
          return
        }

        if (!this.queued) break
        this.queued = false
      }
    } finally {
      this.inflight = false
    }
  }

  private async enterConflictFromSave(): Promise<void> {
    this.conflictState = {
      remoteVersion: null,
      remoteDoc: null,
      localDoc: this.draftDoc,
    }
    this.setStatus('conflict')
    await this.fetchRemoteForConflict(undefined)
  }

  private scheduleRetry(): void {
    if (this.disposed) return
    this.clearRetryTimer()
    const base = this.options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
    const max = this.options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
    const delay = Math.min(max, base * 2 ** this.retryAttempt)
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.enqueueSave()
    }, delay)
  }

  private scheduleReconnect(): void {
    if (this.disposed) return
    this.clearReconnectTimer()
    const base = this.options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
    const max = this.options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
    const delay = Math.min(max, base * 2 ** this.retryAttempt)
    this.retryAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connectSocket()
    }, delay)
  }

  private setConnected(connected: boolean): void {
    if (this.connectedFlag === connected) return
    this.connectedFlag = connected
    this.emit()
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private clearTimers(): void {
    this.clearDebounceTimer()
    this.clearRetryTimer()
    this.clearReconnectTimer()
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private exportLocalDraft(doc: VaultDocument): void {
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'silo-local-draft.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
