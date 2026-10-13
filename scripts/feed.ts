// Usage: node scripts/feed.ts <url> <hmacKey> [motion_detected|button_press] [sub_type] [--twice] [--bad-sig]
import { signBody } from '../worker/hmac.ts'
import { ringPayload, type FeedType } from '../worker/feeder.ts'

const [url, key, type = 'motion_detected', subType] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!url || !key) throw new Error('usage: node scripts/feed.ts <url> <hmacKey> [type] [sub_type]')
const raw = JSON.stringify(ringPayload('ava1.ring.device.demo', type as FeedType, Date.now(), subType))
const sig = process.argv.includes('--bad-sig') ? 'sha256=00' : await signBody(key, raw)
const times = process.argv.includes('--twice') ? 2 : 1
for (let i = 0; i < times; i++) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Signature': sig, 'X-Lookout-Source': 'feeder' },
    body: raw,
  })
  console.log(res.status, await res.text())
}
