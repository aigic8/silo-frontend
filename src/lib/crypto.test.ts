import { describe, expect, it } from 'vitest'
import {
  decryptVault,
  deriveKeys,
  encryptVault,
  generateSalt,
} from './crypto'
import { createEmptyVault, type VaultDocument } from './vault'

const vault: VaultDocument = {
  schemaVersion: 1,
  folders: [{ id: 'folder-1', name: 'Private' }],
  notes: [
    {
      id: 'note-1',
      title: 'Secret note',
      folderId: 'folder-1',
      editorState: JSON.stringify({ root: { children: [] } }),
      updatedAt: 123,
    },
  ],
}

async function deriveTestKeys(passphrase: string, salt: Uint8Array) {
  return deriveKeys(passphrase, salt)
}

describe('crypto', () => {
  it('derives distinct auth and encryption material and encodes salt', async () => {
    const salt = generateSalt()
    const keys = await deriveTestKeys('correct horse battery staple', salt)
    expect(salt).toHaveLength(16)
    expect(keys.saltBase64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(keys.authKeyBase64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(keys.authKeyBase64).not.toBe(keys.saltBase64)
    expect(keys.encryptionKey.extractable).toBe(false)
  })

  it('rejects a passphrase shorter than 12 characters', async () => {
    await expect(deriveTestKeys('short', generateSalt())).rejects.toThrow(
      /at least 12 characters/,
    )
  })

  it('round-trips an encrypted vault', async () => {
    const keys = await deriveTestKeys('correct horse battery staple', generateSalt())
    const encrypted = await encryptVault(vault, keys.encryptionKey)
    expect(await decryptVault(encrypted, keys.encryptionKey)).toEqual(vault)
  })

  it('uses a fresh random nonce for every encryption', async () => {
    const keys = await deriveTestKeys('correct horse battery staple', generateSalt())
    const first = await encryptVault(vault, keys.encryptionKey)
    const second = await encryptVault(vault, keys.encryptionKey)
    expect(first.nonce).not.toBe(second.nonce)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it('fails to decrypt with a different key', async () => {
    const keysA = await deriveTestKeys('correct horse battery staple', generateSalt())
    const keysB = await deriveTestKeys('different passphrase here', generateSalt())
    const encrypted = await encryptVault(vault, keysA.encryptionKey)
    await expect(decryptVault(encrypted, keysB.encryptionKey)).rejects.toThrow()
  })

  it('fails closed when ciphertext is tampered with', async () => {
    const keys = await deriveTestKeys('correct horse battery staple', generateSalt())
    const encrypted = await encryptVault(vault, keys.encryptionKey)
    const last = encrypted.ciphertext.at(-1)!
    const tampered = {
      ...encrypted,
      ciphertext:
        encrypted.ciphertext.slice(0, -1) + (last === 'A' ? 'B' : 'A'),
    }
    await expect(decryptVault(tampered, keys.encryptionKey)).rejects.toThrow()
  })

  it('fails closed when nonce is tampered with', async () => {
    const keys = await deriveTestKeys('correct horse battery staple', generateSalt())
    const encrypted = await encryptVault(vault, keys.encryptionKey)
    const last = encrypted.nonce.at(-1)!
    const tampered = {
      ...encrypted,
      nonce: encrypted.nonce.slice(0, -1) + (last === 'A' ? 'B' : 'A'),
    }
    await expect(decryptVault(tampered, keys.encryptionKey)).rejects.toThrow()
  })

  it('encrypts empty vaults', async () => {
    const keys = await deriveTestKeys('correct horse battery staple', generateSalt())
    const encrypted = await encryptVault(createEmptyVault(), keys.encryptionKey)
    expect(await decryptVault(encrypted, keys.encryptionKey)).toEqual(createEmptyVault())
  })
})
