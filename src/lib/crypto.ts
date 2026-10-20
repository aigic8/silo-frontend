import { base64ToBytes, bytesToBase64 } from './base64'
import { parseVaultDocument, type VaultDocument } from './vault'

export const PBKDF2_ITERATIONS = 600_000
export const SALT_BYTES = 16
export const NONCE_BYTES = 12
export const KEY_BITS = 256

const AUTH_INFO = 'silo-auth-v1'
const ENCRYPTION_INFO = 'silo-encryption-v1'
const VAULT_AAD = 'silo-vault-v1'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export interface DerivedKeys {
  /** Standard padded base64 auth key (PBKDF2 -> HKDF). */
  authKeyBase64: string
  /** Non-extractable AES-GCM-256 key derived for vault encryption. */
  encryptionKey: CryptoKey
  /** Standard padded base64 random salt used for PBKDF2. */
  saltBase64: string
}

export interface EncryptedVault {
  ciphertext: string
  nonce: string
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES)
}

async function deriveBitsFromHkdf(
  inputKeyMaterial: ArrayBuffer,
  info: string,
): Promise<ArrayBuffer> {
  const hkdfKey = await crypto.subtle.importKey('raw', inputKeyMaterial, 'HKDF', false, [
    'deriveBits',
  ])
  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: textEncoder.encode(info),
    },
    hkdfKey,
    KEY_BITS,
  )
}

/**
 * Derive the auth key and vault encryption key from a passphrase and salt.
 * The raw passphrase and derived bytes never leave this module and the
 * encryption key is imported as non-extractable.
 */
export async function deriveKeys(
  passphrase: string,
  salt: Uint8Array,
): Promise<DerivedKeys> {
  if (passphrase.length < 12) {
    throw new Error('passphrase must be at least 12 characters')
  }

  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const pbkdf2Bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    passphraseKey,
    KEY_BITS,
  )

  const authBits = await deriveBitsFromHkdf(pbkdf2Bits, AUTH_INFO)
  const encryptionBits = await deriveBitsFromHkdf(pbkdf2Bits, ENCRYPTION_INFO)

  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    encryptionBits,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )

  return {
    authKeyBase64: bytesToBase64(new Uint8Array(authBits)),
    encryptionKey,
    saltBase64: bytesToBase64(salt),
  }
}

/**
 * Encrypt the entire vault document with a fresh random 12-byte nonce.
 */
export async function encryptVault(
  vault: VaultDocument,
  key: CryptoKey,
): Promise<EncryptedVault> {
  const nonce = randomBytes(NONCE_BYTES)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: textEncoder.encode(VAULT_AAD),
      tagLength: 128,
    },
    key,
    textEncoder.encode(JSON.stringify(vault)),
  )
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    nonce: bytesToBase64(nonce),
  }
}

/**
 * Decrypt and validate the entire vault document. Authenticity and schema
 * failures throw so callers fail closed and never reset/overwrite the vault.
 */
export async function decryptVault(
  encrypted: EncryptedVault,
  key: CryptoKey,
): Promise<VaultDocument> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(encrypted.nonce),
      additionalData: textEncoder.encode(VAULT_AAD),
      tagLength: 128,
    },
    key,
    base64ToBytes(encrypted.ciphertext),
  )
  const json = textDecoder.decode(plaintext)
  return parseVaultDocument(JSON.parse(json))
}
