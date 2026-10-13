// Ring webhook signatures: X-Signature: sha256=<hex HMAC-SHA256(raw body)>.
const enc = new TextEncoder()

async function hmacHex(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(body)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function signBody(key: string, raw: string): Promise<string> {
  return `sha256=${await hmacHex(key, raw)}`
}

export async function verifySignature(key: string, raw: string, header: string | null): Promise<boolean> {
  if (!header) return false
  const expected = await hmacHex(key, raw)
  const got = header.replace(/^sha256=/, '')
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
