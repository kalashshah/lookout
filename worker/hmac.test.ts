import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signBody, verifySignature } from './hmac'

const KEY = 'test-key'
const BODY = '{"meta":{"request_id":"abc"},"data":{"type":"motion_detected"}}'

describe('hmac', () => {
  it('matches Ring\'s documented format: sha256=<hex HMAC-SHA256 of raw body>', async () => {
    const expected = 'sha256=' + createHmac('sha256', KEY).update(BODY).digest('hex')
    expect(await signBody(KEY, BODY)).toBe(expected)
  })
  it('verifies a signature it produced', async () => {
    expect(await verifySignature(KEY, BODY, await signBody(KEY, BODY))).toBe(true)
  })
  it('rejects the wrong key', async () => {
    expect(await verifySignature(KEY, BODY, await signBody('other', BODY))).toBe(false)
  })
  it('rejects a missing header', async () => {
    expect(await verifySignature(KEY, BODY, null)).toBe(false)
  })
  it('rejects a body with one changed byte', async () => {
    const sig = await signBody(KEY, BODY)
    expect(await verifySignature(KEY, BODY.replace('abc', 'abd'), sig)).toBe(false)
  })
})
