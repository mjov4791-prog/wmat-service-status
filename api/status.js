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
  // Simple V1 rules.
  // - 0 reports in last 24h     → unknown / no data
  // - any "no_service" report   → outage (red)
  // - any "boil_advisory"       → boil advisory (orange)
  // - any "low_pressure"        → degraded (yellow)
  // - any "cloudy_water"        → quality issue (yellow)
  // - only "service_ok" reports → ok (green)
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
