// Edge function `digest`: counts only, no names and no record contents, so it needs no secret.
// The admin's daily check reads it and nudges him when something is waiting; the names and
// details are on the Home page once he signs in. Tightened to names later only behind a secret.

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Dataset } from '../../../src/model/types.ts';
import { activityFeed, waitingCounts } from '../../../src/model/activity.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const hours = Math.min(24 * 30, Math.max(1, Number(url.searchParams.get('hours') || 24)));
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data } = await admin.from('family_documents').select('document, updated_at').eq('id', 'main').maybeSingle();
  if (!data) return json({ ok: false, reason: 'no-document' }, 503);
  const doc = data.document as Dataset;
  const recent = activityFeed(doc, 500).filter((a) => a.at >= since);
  const count = (k: string) => recent.filter((a) => a.kind === k).length;
  const inv = doc.invitations.filter((i) => i.status !== 'revoked');
  return json({
    ok: true, since, hours, lastChange: data.updated_at,
    recent: { opens: count('open'), submissions: count('submit'), confirmations: count('confirm'), disputes: count('dispute'), requests: count('request') },
    waiting: waitingCounts(doc),
    invitations: { active: inv.filter((i) => i.status === 'active').length, notOpened: inv.filter((i) => i.status === 'pending').length },
    people: doc.people.filter((p) => !p.placeholder).length,
  });
});
