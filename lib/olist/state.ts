import { createHmac, timingSafeEqual } from 'crypto'

type StatePayload = { orgId: string }

function getSecret(): string {
  const secret = process.env.OLIST_STATE_SECRET
  if (!secret) {
    throw new Error('OLIST_STATE_SECRET must be set')
  }
  return secret
}

export function signState(payload: StatePayload): string {
  const json = JSON.stringify(payload)
  const encoded = Buffer.from(json, 'utf8').toString('base64url')
  const signature = createHmac('sha256', getSecret()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyState(token: string): StatePayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, signature] = parts

  const expectedSignature = createHmac('sha256', getSecret()).update(encoded).digest('base64url')

  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null
  }

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8')
    const payload = JSON.parse(json)
    if (typeof payload.orgId !== 'string') return null
    return { orgId: payload.orgId }
  } catch {
    return null
  }
}
