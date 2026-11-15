import { createHash, randomBytes } from 'node:crypto'

export function createOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url')
}
