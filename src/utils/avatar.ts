import { createAvatar } from '@dicebear/core'
import * as adventurer from '@dicebear/adventurer'

const BACKGROUNDS = [
  'b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf',
  'c1f4c5', 'ffe08a', 'ffc9a3', 'a0e7e5', 'fbe7c6',
]

/** Deterministic colorful avatar (DiceBear Adventurer) for email/password users. */
export function avatarSvg(seed: string): string {
  return createAvatar(adventurer, {
    seed: seed.trim().toLowerCase() || 'mowen',
    size: 128,
    backgroundType: ['solid'],
    backgroundColor: BACKGROUNDS,
  }).toString()
}

export function avatarPath(seed: string): string {
  return `/api/avatars/${encodeURIComponent(seed.trim().toLowerCase())}?v=color`
}

export function withAvatar(picture: string | null | undefined, email: string): string {
  const value = picture?.trim() ?? ''
  if (value && !value.includes('/api/avatars/')) return value
  return avatarPath(email)
}
