import { createClient } from 'npm:@supabase/supabase-js'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OWNER = 'kingston3288@gmail.com'
const admin = createClient(supabaseUrl, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } })

// CORS headers
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors })

  // Authorize caller: must be the owner
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  let callerEmail = ''
  try {
    const { data: user } = await admin.auth.getUser(token)
    callerEmail = (user?.user?.email || '').toLowerCase()
  } catch { callerEmail = '' }
  if (callerEmail !== OWNER) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  try {
    const { requestId, email, tempPassword } = await req.json()
    if (!requestId || !email || !tempPassword) {
      return new Response(JSON.stringify({ error: 'requestId, email, tempPassword required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    const cleanEmail = String(email).trim().toLowerCase()

    // 1) Create the auth user (email confirmed, no signup required)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
    })
    if (createErr) {
      // If user already exists, still allow updating the request row
      return new Response(JSON.stringify({ error: createErr.message }), { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // 2) Update the access request: approved + temp password + must change
    const { error: updErr } = await admin
      .from('tradeos_access_requests')
      .update({
        status: 'approved',
        temp_password: tempPassword,
        must_change_password: true,
        account_created: true,
        account_created_at: new Date().toISOString(),
        decided_at: new Date().toISOString(),
      })
      .eq('id', requestId)
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ ok: true, userId: created?.id, email: cleanEmail }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})