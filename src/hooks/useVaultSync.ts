import { useEffect, useMemo, useState } from 'react'
import { createEventsSocket, httpVaultApi, type VaultApi, type WebSocketLike } from '../lib/api'
import type { DerivedKeys } from '../lib/crypto'
import {
  VaultSyncController,
  type VaultSyncSnapshot,
} from '../lib/sync'
import type { VaultDocument } from '../lib/vault'

export interface VaultSyncActions {
  setDraft: (next: VaultDocument) => void
  mutate: (mutator: (draft: VaultDocument) => VaultDocument) => void
  retryNow: () => void
  resolveConflict: (action: 'load-remote' | 'keep-local' | 'export-local') => void
}

export type VaultSync = VaultSyncSnapshot & VaultSyncActions

export interface UseVaultSyncOptions {
  vaultApi?: VaultApi
  createSocket?: () => WebSocketLike
  debounceMs?: number
  retryBaseMs?: number
  retryMaxMs?: number
  onAuthError?: () => void
  onFatal?: (error: Error) => void
}

export function useVaultSync(keys: DerivedKeys, options: UseVaultSyncOptions = {}): VaultSync {
  const {
    vaultApi = httpVaultApi,
    createSocket = createEventsSocket,
    debounceMs,
    retryBaseMs,
    retryMaxMs,
    onAuthError,
    onFatal,
  } = options

  const controller = useMemo(
    () =>
      new VaultSyncController(keys, {
        vaultApi,
        createSocket,
        debounceMs,
        retryBaseMs,
        retryMaxMs,
        onAuthError,
        onFatal,
      }),
    [
      keys,
      vaultApi,
      createSocket,
      debounceMs,
      retryBaseMs,
      retryMaxMs,
      onAuthError,
      onFatal,
    ],
  )

  const [snapshot, setSnapshot] = useState<VaultSyncSnapshot>(() => controller.snapshot())

  useEffect(() => {
    const unsubscribe = controller.subscribe(() => setSnapshot(controller.snapshot()))
    controller.start()
    setSnapshot(controller.snapshot())
    return () => {
      unsubscribe()
      controller.dispose()
    }
  }, [controller])

  const actions = useMemo<VaultSyncActions>(
    () => ({
      setDraft: controller.setDraft,
      mutate: controller.mutate,
      retryNow: controller.retryNow,
      resolveConflict: controller.resolveConflict,
    }),
    [controller],
  )

  return { ...snapshot, ...actions }
}
