// GET /api/status
// Returns current service status for all WMAT communities, aggregated from
// reports submitted in the last 24 hours.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs' };

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { data, error } = await supabase()
      .from('wss_current_status')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;

    // Compute a derived status label per row so the frontend doesn't have to
    // duplicate the logic.
    const rows = (data || []).map((r) => ({
      ...r,
      derived_status: deriveStatus(r),
    }));

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).json({ rows, fetched_at: new Date().toISOString() });
  } catch (err) {
    console.error('Status fetch error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
}

function deriveStatus(r) {
  // Priority 1: if there's a fresh report (within last 2 hours), it represents
  // the current ground truth — water came back on, situation changed, etc.
  // A stale "no water" report from 12 hours ago shouldn't outrank a fresh
  // "water is on" report from 5 minutes ago.
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const latestAtMs = r.latest_at ? new Date(r.latest_at).getTime() : 0;
  const isFresh = latestAtMs && (Date.now() - latestAtMs) < TWO_HOURS_MS;

  if (isFresh && r.latest_status) {
    switch (r.latest_status) {
      case 'service_ok':
        return { code: 'ok', label: 'Service OK (recently confirmed)', severity: 1 };
      case 'no_service':
        return { code: 'outage', label: 'Outage (recently reported)', severity: 4 };
      case 'boil_advisory':
        return { code: 'boil_advisory', label: 'Boil advisory (recently reported)', severity: 3 };
      case 'low_pressure':
      case 'cloudy_water':
        return { code: 'degraded', label: 'Service issues (recently reported)', severity: 2 };
      // For 'other' or unrecognized statuses, fall through to the 24h aggregate.
    }
  }

  // Priority 2: fall back to 24-hour aggregate (worst case in window wins).
  // Used when there are no fresh reports in the last 2 hours.
  if (!r.total_reports_24h || Number(r.total_reports_24h) === 0) {
    return { code: 'unknown', label: 'No recent reports', severity: 0 };
  }
  if (Number(r.outage_count) > 0) {
    return { code: 'outage', label: 'Outage reported', severity: 4 };
  }
  if (Number(r.boil_advisory_count) > 0) {
    return { code: 'boil_advisory', label: 'Boil advisory reported', severity: 3 };
  }
  if (Number(r.low_pressure_count) > 0 || Number(r.cloudy_water_count) > 0) {
    return { code: 'degraded', label: 'Service issues reported', severity: 2 };
  }
  if (Number(r.ok_count) > 0) {
    return { code: 'ok', label: 'Service OK (community-reported)', severity: 1 };
  }
  return { code: 'unknown', label: 'No recent reports', severity: 0 };
}
