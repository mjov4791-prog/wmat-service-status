// POST /api/report
// Accepts a community-submitted status report. Anonymous; no auth required.
// Light rate limiting via IP hashing (one report per 60 seconds per IP).

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

export const config = { runtime: 'nodejs' };

const VALID_STATUSES = new Set([
  'service_ok',
  'no_service',
  'low_pressure',
  'cloudy_water',
  'boil_advisory',
  'other',
]);

let _supabase;
function supabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return _supabase;
}

function hashIp(ip) {
  return createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 32);
}

function getIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    ''
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const communitySlug = String(body.community_slug || '').trim();
  const serviceSlug = String(body.service_slug || 'water').trim();
  const status = String(body.status || '').trim();
  const description = String(body.description || '').trim().slice(0, 500);
  const reporterName = String(body.reporter_name || '').trim().slice(0, 80);
  const reporterContact = String(body.reporter_contact || '').trim().slice(0, 120);

  if (!communitySlug) {
    res.status(400).json({ error: 'Missing community_slug' });
    return;
  }
  if (!VALID_STATUSES.has(status)) {
    res.status(400).json({ error: 'Invalid status value' });
    return;
  }

  const ip = getIp(req);
  const ipHash = hashIp(ip);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 200);

  try {
    // Light rate limit: refuse if this IP submitted in the last 60 seconds.
    const { data: recent, error: rlError } = await supabase()
      .from('wss_reports')
      .select('id')
      .eq('ip_hash', ipHash)
      .gt('created_at', new Date(Date.now() - 60_000).toISOString())
      .limit(1);

    if (rlError) throw rlError;
    if (recent && recent.length > 0) {
      res.status(429).json({ error: 'You just submitted a report — please wait a minute before submitting another.' });
      return;
    }

    // Look up community and service IDs from their slugs.
    const { data: comm, error: cErr } = await supabase()
      .from('wss_communities')
      .select('id, name')
      .eq('slug', communitySlug)
      .single();
    if (cErr || !comm) {
      res.status(404).json({ error: 'Unknown community' });
      return;
    }

    const { data: svc, error: sErr } = await supabase()
      .from('wss_services')
      .select('id, name')
      .eq('slug', serviceSlug)
      .single();
    if (sErr || !svc) {
      res.status(404).json({ error: 'Unknown service' });
      return;
    }

    const { data: inserted, error: insertErr } = await supabase()
      .from('wss_reports')
      .insert({
        community_id: comm.id,
        service_id: svc.id,
        status,
        description: description || null,
        reporter_name: reporterName || null,
        reporter_contact: reporterContact || null,
        ip_hash: ipHash,
        user_agent: userAgent,
      })
      .select('id, created_at')
      .single();

    if (insertErr) throw insertErr;

    res.status(200).json({
      ok: true,
      id: inserted.id,
      created_at: inserted.created_at,
      community: comm.name,
      service: svc.name,
    });
  } catch (err) {
    console.error('Report submission error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
}
