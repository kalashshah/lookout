// Builds Ring webhook v1.1 payloads exactly as documented, for the demo console and scripts/feed.ts.
// The Ring Playground cannot emit motion/button webhooks, so this is how events reach the real webhook path.
export type FeedType = 'motion_detected' | 'button_press'

export function ringPayload(deviceId: string, type: FeedType, at: number, subType?: string) {
  const short = type === 'button_press' ? 'button_press' : (subType ?? 'motion')
  return {
    meta: {
      version: '1.1',
      time: new Date().toISOString(),
      request_id: crypto.randomUUID(),
      account_id: 'ava1.ring.account.watchword-demo',
    },
    data: {
      id: `${deviceId}_${short}_${at}`,
      type,
      attributes: {
        source: deviceId,
        source_type: 'devices',
        timestamp: at,
        ...(type === 'motion_detected' ? { sub_type: subType ?? 'motion' } : {}),
      },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  }
}
