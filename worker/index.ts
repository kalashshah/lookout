import { Hono } from 'hono'
import { api } from './api'
import { tick } from './pipeline'
import { webhook } from './webhook'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/', webhook)
app.route('/api', api)

export default {
  fetch: app.fetch,
  async scheduled(_ctrl, env, ctx) {
    ctx.waitUntil(tick(env, Date.now()))
  },
} satisfies ExportedHandler<Env>
