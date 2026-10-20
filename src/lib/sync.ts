import { ApiError, type VaultApi, type WebSocketLike } from './api'
import {
  decryptVault,
  encryptVault,
  type DerivedKeys,
  type EncryptedVault,
} from './crypto'
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
  /** True only after the first vault fetch has decrypted and installed safely. */
  initialized: boolean
  /** Bumped only when server state is installed; drives editor remounts. */
  revision: number
  /** True when the session was revoked/expired and the local draft is frozen. */
  sessionExpired: boolean
}

export interface VaultSyncOptions {
  vaultApi: VaultApi
  createSocket: () => WebSocketLike
  debounceMs?: number
  retryBaseMs?: number
  retryMaxMs?: number
  onFatal?: (error: Error) => void
  /** Test seam; defaults to the real AES-GCM vault encryption. */
  encryptVault?: (vault: VaultDocument, key: CryptoKey) => Promise<EncryptedVault>
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
  private initializedFlag = false
  private revision = 0
  private sessionExpiredFlag = false

  private readonly listeners = new Set<() => void>()
  private inflight = false
  private queued = false
  /** Lifecycle generation: only work started in the current lifecycle may mutate state. */
  private lifecycle = 0
  /** Fetch generation: only the latest remote GET may install remote state. */
  private fetchGeneration = 0
  private retryAttempt = 0
  private disposed = false
  private initialLoadInFlight = false
  private pendingRemoteVersion = 0
  private postSaveReconcile = false
  private socket: WebSocketLike | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private initialRetryTimer: ReturnType<typeof setTimeout> | null = null

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
      initialized: this.initializedFlag,
      revision: this.revision,
      sessionExpired: this.sessionExpiredFlag,
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
    this.lifecycle += 1
    this.fetchGeneration += 1
    this.draftDoc = createEmptyVault()
    this.dirtyFlag = false
    this.serverVersion = 0
    this.status = 'loading'
    this.connectedFlag = false
    this.conflictState = null
    this.errorMessage = null
    this.initializedFlag = false
    this.revision = 0
    this.sessionExpiredFlag = false
    this.inflight = false
    this.queued = false
    this.initialLoadInFlight = false
    this.pendingRemoteVersion = 0
    this.postSaveReconcile = false
    this.retryAttempt = 0
    this.emit()
    void this.loadInitial()
    this.connectSocket()
  }

  dispose(): void {
    this.disposed = true
    this.lifecycle += 1
    this.fetchGeneration += 1
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.listeners.clear()
  }

  setDraft = (next: VaultDocument): void => {
    this.mutate(() => next)
  }

  mutate = (mutator: (draft: VaultDocument) => VaultDocument): void => {
    if (
      this.disposed ||
      !this.initializedFlag ||
      this.sessionExpiredFlag ||
      this.conflictState
    ) {
      return
    }
    this.draftDoc = mutator(this.draftDoc)
    this.errorMessage = null
    this.dirtyFlag = true
    this.setStatus('dirty')
    this.scheduleSave()
  }

  exportDraft = (): void => {
    if (this.disposed) return
    this.exportLocalDraft(this.draftDoc)
  }

  retryNow = (): void => {
    if (this.disposed || this.sessionExpiredFlag) return
    this.clearRetryTimer()
    this.clearDebounceTimer()
    this.clearInitialRetryTimer()
    this.errorMessage = null

    if (!this.initializedFlag) {
      this.setStatus('loading')
      void this.loadInitial()
      return
    }

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
    if (!conflict || this.disposed || this.sessionExpiredFlag) return

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
      this.pendingRemoteVersion = 0
      this.queued = false
      this.revision += 1
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
      this.pendingRemoteVersion = 0
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
    if (this.disposed || this.sessionExpiredFlag || this.initialLoadInFlight) return
    this.initialLoadInFlight = true
    const lifecycle = this.lifecycle
    try {
      const response = await this.options.vaultApi.getVault()
      if (!this.isCurrentLifecycle(lifecycle)) return
      const doc = await this.decryptResponse(response)
      if (!this.isCurrentLifecycle(lifecycle)) return
      if (this.initializedFlag || this.sessionExpiredFlag) return
      this.draftDoc = doc
      this.serverVersion = response.version
      this.dirtyFlag = false
      this.initializedFlag = true
      this.revision += 1
      this.setStatus('saved')
    } catch (error) {
      if (!this.isCurrentLifecycle(lifecycle)) return
      if (error instanceof ApiError) {
        if (error.status === 401) {
          this.enterSessionExpired()
          return
        }
        this.setStatus('offline')
        this.scheduleInitialLoadRetry()
        return
      }
      this.setStatus('error')
      this.options.onFatal?.(toError(error))
    } finally {
      if (this.isCurrentLifecycle(lifecycle)) {
        this.initialLoadInFlight = false
      }
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
    if (
      this.disposed ||
      this.sessionExpiredFlag ||
      !this.initializedFlag ||
      (this.inflight && this.dirtyFlag)
    ) {
      return
    }
    const fetchGeneration = ++this.fetchGeneration
    const lifecycle = this.lifecycle
    try {
      const response = await this.options.vaultApi.getVault()
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return
      const doc = await this.decryptResponse(response)
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return
      if (response.version <= this.serverVersion) return
      if (this.dirtyFlag || this.conflictState) {
        await this.enterConflict(response.version, doc)
        return
      }
      this.draftDoc = doc
      this.serverVersion = response.version
      this.dirtyFlag = false
      this.revision += 1
      this.setStatus('saved')
    } catch (error) {
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return
      if (error instanceof ApiError) {
        if (error.status === 401) {
          this.enterSessionExpired()
          return
        }
        this.setStatus('offline')
        return
      }
      this.setStatus('error')
      this.options.onFatal?.(toError(error))
    }
  }

  private async reconcilePostSave(): Promise<boolean> {
    if (this.disposed || this.sessionExpiredFlag || !this.initializedFlag) return false
    const fetchGeneration = ++this.fetchGeneration
    const lifecycle = this.lifecycle
    try {
      const response = await this.options.vaultApi.getVault()
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return false
      const doc = await this.decryptResponse(response)
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return false
      if (response.version <= this.serverVersion) return false
      if (this.dirtyFlag) {
        await this.enterConflict(response.version, doc)
        return true
      }
      this.draftDoc = doc
      this.serverVersion = response.version
      this.dirtyFlag = false
      this.revision += 1
      this.setStatus('saved')
      return true
    } catch (error) {
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return false
      if (error instanceof ApiError) {
        if (error.status === 401) {
          this.enterSessionExpired()
          return false
        }
        this.setStatus('offline')
        return false
      }
      this.setStatus('error')
      this.options.onFatal?.(toError(error))
      return false
    }
  }

  private connectSocket(): void {
    if (this.disposed || this.sessionExpiredFlag) return
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
      if (this.disposed || this.socket !== socket || this.sessionExpiredFlag) return
      this.retryAttempt = 0
      this.setConnected(true)
      // Initial load owns the first fetch; reconnects refresh only after that.
      if (this.initializedFlag) {
        if (this.inflight && this.dirtyFlag) {
          this.postSaveReconcile = true
        } else {
          void this.applyRemote()
        }
      }
    }

    socket.onmessage = (event) => {
      if (this.disposed || this.socket !== socket || this.sessionExpiredFlag) return
      this.handleMessage(event)
    }

    socket.onerror = () => {
      // The browser follows this with onclose; reconnect is scheduled there.
    }

    socket.onclose = () => {
      if (this.disposed || this.socket !== socket) return
      this.socket = null
      this.setConnected(false)
      if (!this.sessionExpiredFlag) {
        this.scheduleReconnect()
      }
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
    if (this.disposed || this.sessionExpiredFlag || version <= this.serverVersion) return
    // While a save is in flight, remember the highest observed remote version
    // instead of dropping it. The save result then reconciles that watermark.
    if (this.inflight && this.dirtyFlag) {
      this.pendingRemoteVersion = Math.max(this.pendingRemoteVersion, version)
      return
    }
    if (this.dirtyFlag || this.conflictState) {
      await this.fetchRemoteForConflict(version)
      return
    }
    await this.applyRemote()
  }

  private async fetchRemoteForConflict(knownVersion?: number): Promise<void> {
    if (this.disposed || this.sessionExpiredFlag) return
    const fetchGeneration = ++this.fetchGeneration
    const lifecycle = this.lifecycle
    const localDoc = this.draftDoc
    try {
      const response = await this.options.vaultApi.getVault()
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return
      const doc = await this.decryptResponse(response)
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return
      this.conflictState = {
        remoteVersion: response.version,
        remoteDoc: doc,
        localDoc,
      }
      this.setStatus('conflict')
    } catch (error) {
      if (!this.isCurrentFetch(fetchGeneration) || !this.isCurrentLifecycle(lifecycle)) return
      if (error instanceof ApiError && error.status === 401) {
        this.enterSessionExpired()
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
    if (this.disposed || this.sessionExpiredFlag || !this.initializedFlag) return
    this.clearDebounceTimer()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.enqueueSave()
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
  }

  private enqueueSave(): void {
    if (
      this.disposed ||
      this.sessionExpiredFlag ||
      !this.initializedFlag ||
      this.conflictState ||
      !this.dirtyFlag
    ) {
      return
    }
    if (this.inflight) {
      this.queued = true
      return
    }
    void this.performSave()
  }

  private async performSave(): Promise<void> {
    if (this.inflight || !this.initializedFlag || this.sessionExpiredFlag) return
    const lifecycle = this.lifecycle
    this.inflight = true
    try {
      while (
        this.dirtyFlag &&
        !this.conflictState &&
        !this.sessionExpiredFlag &&
        this.isCurrentLifecycle(lifecycle)
      ) {
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
          encrypted = await (this.options.encryptVault ?? encryptVault)(
            docToSave,
            this.keys.encryptionKey,
          )
        } catch (error) {
          if (!this.isCurrentLifecycle(lifecycle)) return
          this.errorMessage = 'Could not encrypt the vault. Your data was not sent.'
          this.setStatus('error')
          this.options.onFatal?.(toError(error))
          return
        }

        // Encryption is the last async boundary before an HTTP write. A
        // disposed/restarted lifecycle must never initiate a stale PUT.
        if (!this.isCurrentLifecycle(lifecycle)) return

        try {
          const response = await this.options.vaultApi.putVault(
            expectedVersion,
            encrypted.ciphertext,
            encrypted.nonce,
          )
          if (!this.isCurrentLifecycle(lifecycle)) return
          this.serverVersion = response.version
          this.retryAttempt = 0
          this.errorMessage = null
          if (this.draftDoc === docToSave) {
            this.dirtyFlag = false
          } else {
            this.queued = true
          }
          this.setStatus(this.dirtyFlag ? 'dirty' : 'saved')

          if (this.pendingRemoteVersion > this.serverVersion) {
            const pending = this.pendingRemoteVersion
            this.pendingRemoteVersion = 0
            this.postSaveReconcile = false
            if (this.dirtyFlag) {
              await this.fetchRemoteForConflict(pending)
            } else {
              await this.applyRemote()
            }
            // Reconciliation installs remote/conflict state and pauses the queue.
            return
          }

          if (this.postSaveReconcile) {
            this.postSaveReconcile = false
            const remoteChanged = await this.reconcilePostSave()
            if (remoteChanged || this.conflictState || this.sessionExpiredFlag) return
            // No newer remote content; fall through and continue any queued
            // local save below.
          }
        } catch (error) {
          if (!this.isCurrentLifecycle(lifecycle)) return
          if (error instanceof ApiError && error.status === 409) {
            await this.enterConflictFromSave()
            return
          }
          if (error instanceof ApiError && error.status === 401) {
            this.enterSessionExpired()
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

        if (!this.isCurrentLifecycle(lifecycle)) return
        if (!this.queued) break
        this.queued = false
      }
    } finally {
      if (this.isCurrentLifecycle(lifecycle)) {
        this.inflight = false
      }
    }
  }

  private async enterConflictFromSave(): Promise<void> {
    this.conflictState = {
      remoteVersion: null,
      remoteDoc: null,
      localDoc: this.draftDoc,
    }
    this.pendingRemoteVersion = 0
    this.setStatus('conflict')
    await this.fetchRemoteForConflict(undefined)
  }

  private enterSessionExpired(): void {
    if (this.disposed) return
    this.sessionExpiredFlag = true
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.setConnected(false)
    this.errorMessage = 'Session expired'
    this.setStatus('error')
  }

  private scheduleRetry(): void {
    if (this.disposed || this.sessionExpiredFlag) return
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

  private scheduleInitialLoadRetry(): void {
    if (this.disposed || this.sessionExpiredFlag) return
    this.clearInitialRetryTimer()
    const base = this.options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
    const max = this.options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
    const delay = Math.min(max, base * 2 ** this.retryAttempt)
    this.retryAttempt += 1
    this.initialRetryTimer = setTimeout(() => {
      this.initialRetryTimer = null
      if (!this.initializedFlag && !this.sessionExpiredFlag) {
        this.setStatus('loading')
        void this.loadInitial()
      }
    }, delay)
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.sessionExpiredFlag) return
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

  private isCurrentLifecycle(generation: number): boolean {
    return !this.disposed && generation === this.lifecycle
  }

  private isCurrentFetch(generation: number): boolean {
    return !this.disposed && generation === this.fetchGeneration
  }

  private clearTimers(): void {
    this.clearDebounceTimer()
    this.clearRetryTimer()
    this.clearReconnectTimer()
    this.clearInitialRetryTimer()
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

  private clearInitialRetryTimer(): void {
    if (this.initialRetryTimer !== null) {
      clearTimeout(this.initialRetryTimer)
      this.initialRetryTimer = null
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
