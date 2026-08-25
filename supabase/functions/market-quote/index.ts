// Supabase Edge Function: market-quote
// Server-side proxy to Yahoo Finance quote endpoint.
// Returns real latest price for a symbol with CORS headers so the
// browser app can call it. Authorizes to signed-in users + owner.
import { createClient } from 'npm:@supabase/supabase-js'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OWNER = 'kingston3288@gmail.com'
const admin = createClient(supabaseUrl, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// Small in-memory cache: symbol -> {price, pct, time} for ~75s to respect rate limits.
const cache = new Map<string, { price: number; pct: number; time: number }>()

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim()
  if (!symbol) return new Response(JSON.stringify({ error: 'symbol required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

  // Authorize: any signed-in user (covers approved beta users) or owner.
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  let authed = false
  try {
    const { data: u } = await admin.auth.getUser(token)
    if (u?.user) authed = true
  } catch { authed = false }
  if (!authed) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })

  const cached = cache.get(symbol)
  if (cached && Date.now() - cached.time < 75000) {
    return new Response(JSON.stringify({ symbol, price: cached.price, pct: cached.pct, cached: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // Fetch real price from Yahoo.
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
    if (!r.ok) throw new Error('yahoo ' + r.status)
    const j = await r.json() as any
    const meta = j?.chart?.result?.[0]?.meta
    const price = meta?.regularMarketPrice
    const prev = meta?.chartPreviousClose ?? meta?.previousClose
    const pct = price && prev ? ((price - prev) / prev) * 100 : 0
    if (!price) throw new Error('no price')
    cache.set(symbol, { price, pct, time: Date.now() })
    return new Response(JSON.stringify({ symbol, price, pct, cached: false }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    // If we have a stale cache entry, return it rather than erroring.
    if (cached) return new Response(JSON.stringify({ symbol, price: cached.price, pct: cached.pct, cached: true, stale: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ error: 'quote failed', detail: String(e) }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
