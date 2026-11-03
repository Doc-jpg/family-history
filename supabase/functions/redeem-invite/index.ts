// Supabase Edge Function: redeem-invite
// Status: WRITTEN, NOT DEPLOYED OR TESTED (needs the Supabase project).
//
// Flow: the relative opens their link (raw token in the URL hash), enters the 6-digit code
// Deren gave them separately, and signs in with an email one-time code (Supabase Auth OTP).
// This function then checks token hash + code hash against `invitations`, confirms the
// invitation is pending/active and unexpired, and binds the invitation to the verified
// auth user. From then on row-level security scopes every read to that invitation.
//
// The link alone opens nothing. The code alone opens nothing. A forwarded link without the
// code and without access to the recipient's email is useless.

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { token, code, deviceId, deviceLabel } = await req.json();
    const authHeader = req.headers.get('Authorization') ?? '';
    // Client acting as the signed-in relative (so we learn who they are)...
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await asUser.auth.getUser();
    const user = userData.user;
    if (!user) return json({ ok: false, reason: 'not-signed-in' }, 401);
    // ...and a service client to read hashes and bind the invitation.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const tokenHash = await sha256Hex(String(token ?? ''));
    const { data: inv } = await admin.from('invitations').select('*').eq('token_hash', tokenHash).maybeSingle();
    if (!inv) return json({ ok: false, reason: 'not-found' });
    if (inv.status === 'revoked') return json({ ok: false, reason: 'revoked' });
    if (new Date(inv.expires_at) < new Date() || inv.status === 'expired') return json({ ok: false, reason: 'expired' });
    // Device rule: a device other than the bound one can only ever get view-only (per `forwarded`).
    const deviceHash = await sha256Hex(String(deviceId ?? ''));
    const codeOk = String(code ?? '').trim().length > 0 && (await sha256Hex(String(code).trim())) === inv.code_hash;
    const viewOnly = { ok: true, mode: 'view', invitation: { id: inv.id, recipientName: inv.recipient_name, scope: inv.scope } };
    if (inv.device_hash && inv.device_hash !== deviceHash) {
      if (inv.forwarded === 'refuse') return json({ ok: false, reason: 'bound-elsewhere' });
      if (inv.forwarded === 'view-with-code' && !codeOk) return json({ ok: false, reason: 'code-required' });
      return json(viewOnly);
    }
    if (!codeOk) return inv.forwarded === 'view' && !String(code ?? '').trim() ? json(viewOnly) : json({ ok: false, reason: 'bad-code' });
    if (inv.member_user_id && inv.member_user_id !== user.id) return json({ ok: false, reason: 'already-claimed' });
    if (inv.email && user.email && inv.email.toLowerCase() !== user.email.toLowerCase()) return json({ ok: false, reason: 'email-mismatch' });
    await admin.from('invitations').update({ member_user_id: user.id, verified_identity: user.email, status: 'active', activated_at: inv.activated_at ?? new Date().toISOString(), last_seen_at: new Date().toISOString(), device_hash: inv.device_hash ?? deviceHash, bound_at: inv.bound_at ?? new Date().toISOString(), device_label: inv.device_label ?? String(deviceLabel ?? '') }).eq('id', inv.id);
    await admin.from('audit_log').insert({ actor: user.id, actor_label: inv.recipient_name, action: 'invitation-redeemed', entity: 'invitation', entity_id: inv.id });
    return json({ ok: true, mode: 'full', firstDevice: !inv.device_hash, invitation: { id: inv.id, recipientName: inv.recipient_name, role: inv.role, scope: inv.scope } });
  } catch (e) {
    return json({ ok: false, reason: 'error', detail: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
}
