import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64 } from './base64'

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('uses standard padded base64', () => {
    expect(bytesToBase64(new Uint8Array([0xfb]))).toBe('+w==')
    expect(bytesToBase64(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('Zm9v')
  })

  it('rejects invalid base64', () => {
    expect(() => base64ToBytes('not base64!!!')).toThrow()
  })
})
