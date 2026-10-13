// Ring Partner API (https://developer.amazon.com/docs/ring/api-documentation.html).
const API = 'https://api.amazonvision.com'

export type RingDevice = { id: string; name: string }

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Ring ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function listDevices(token: string): Promise<RingDevice[]> {
  const data = await get<{ data: { id: string; attributes?: { name?: string; description?: string } }[] }>(
    token,
    '/v1/devices',
  )
  return data.data.map((d) => ({ id: d.id, name: d.attributes?.name || d.attributes?.description || 'Ring device' }))
}

export async function deviceStatus(token: string, id: string): Promise<{ online: boolean }> {
  const data = await get<{ data: { attributes: { online?: boolean } } }>(token, `/v1/devices/${id}/status`)
  return { online: !!data.data.attributes.online }
}

export async function history(token: string, id: string): Promise<unknown> {
  return get(token, `/v1/history/devices/${id}/events`)
}

/** Snapshot at a moment. Ring answers 303 → pre-signed URL; fetch follows it. Null if unavailable. */
export async function snapshot(token: string, id: string, atMs: number): Promise<Uint8Array | null> {
  const res = await fetch(`${API}/v1/devices/${id}/media/image/download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'at_timestamp',
      timestamp: Math.min(atMs, Date.now()),
      image_options: { format: 'jpeg', resolution: { width: 1280, height: 720 } },
    }),
  })
  if (!res.ok) {
    console.warn('ring snapshot failed', res.status, await res.text())
    return null
  }
  return new Uint8Array(await res.arrayBuffer())
}
