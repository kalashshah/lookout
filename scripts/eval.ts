// Accuracy check: run each demo scene through the real Bedrock evaluator and compare with expected matches.
// Usage: AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… node scripts/eval.ts
import { readFileSync } from 'node:fs'
import { evaluateFrame } from '../worker/ai.ts'
import type { Rule } from '../worker/types.ts'

const rule = (id: string, look_for: string): Rule => ({
  id, look_for, text: '', summary: id, kind: 'arrival', days: [], start: null, end: null, minutes: null, severity: 'info', enabled: true,
})

const RULES = [
  rule('kids', 'a child with a school backpack'),
  rule('package', 'a cardboard package on the porch'),
  rule('van', 'a delivery van'),
  rule('cleaner', 'a person carrying cleaning supplies'),
  rule('suitcase', 'people with suitcases or luggage'),
  rule('night', 'a person at the door at night'),
  rule('line', 'a line of several people waiting outside'),
]

// Scene → rule ids that should match. Everything else should not.
const EXPECTED: Record<string, string[]> = {
  'kids-arrive': ['kids'],
  'empty-porch': [],
  package: ['package'],
  'package-gone': ['package'],
  'delivery-van': ['van'],
  'cleaner-leaving': ['cleaner'],
  'guests-suitcases': ['suitcase'],
  'night-visitor': ['night'],
  'shop-line': ['line'],
}

const env = {
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,
  AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
  MODEL_ID: process.env.MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0',
} as unknown as Env

let right = 0
let total = 0
for (const [scene, expected] of Object.entries(EXPECTED)) {
  const img = new Uint8Array(readFileSync(`public/scenes/${scene}.jpg`))
  const { caption, matches } = await evaluateFrame(env, img, RULES)
  const wrong = matches.filter((m) => m.match !== expected.includes(m.ruleId))
  total += matches.length
  right += matches.length - wrong.length
  console.log(`${wrong.length ? '✗' : '✓'} ${scene.padEnd(18)} ${caption}`)
  for (const w of wrong) console.log(`    ${w.ruleId}: got ${w.match} (${w.confidence}) — ${w.reason}`)
}
console.log(`\n${right}/${total} rule checks correct (${Math.round((right / total) * 100)}%)`)
