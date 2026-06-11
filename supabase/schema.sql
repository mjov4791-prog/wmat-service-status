-- WMAT Service Status — database schema
-- Run this once in your Supabase SQL Editor before deploying the project.
-- Uses `wss_` prefix so the tables don't collide with the other CyberApache
-- AI Solutions projects sharing the same Supabase backend.

-- ===========================================================================
-- COMMUNITIES — the 11 WMAT communities served by the dashboard.
-- Seeded below with current data. Add/remove communities by editing this file
-- and re-running the relevant inserts.
-- ===========================================================================
create table if not exists wss_communities (
  id                serial primary key,
  slug              text unique not null,
  name              text not null,
  region            text,                          -- optional: north / central / south
  is_upstream_node  boolean default false,         -- true for Miner Flats (main water pumps)
  notes             text,
  sort_order        int default 0,
  created_at        timestamptz default now()
);

-- Seed the WMAT communities (only inserts if not already present).
insert into wss_communities (slug, name, is_upstream_node, notes, sort_order)
values
  ('whiteriver',          'Whiteriver',            false, 'Main administrative town for WMAT', 10),
  ('east-fork',           'East Fork',             false, null, 20),
  ('cedar-creek',         'Cedar Creek',           false, null, 30),
  ('carrizo',             'Carrizo',               false, null, 40),
  ('mcnary',              'McNary',                false, null, 50),
  ('cibecue',             'Cibecue',               false, null, 60),
  ('hon-dah',             'Hon-Dah',               false, null, 70),
  ('forestdale',          'Forestdale',            false, null, 80),
  ('miner-flats',         'Miner Flats',           true,  'Location of main water pumps — outages here may cascade to downstream communities', 5),
  ('sunrise-park-resort', 'Sunrise Park Resort',   false, null, 90),
  ('turkey-creek',        'Turkey Creek',          false, null, 100),
  -- Added June 2026 after community feedback (councilman from Canyon Day, others)
  ('canyon-day',          'Canyon Day',            false, null, 110),
  ('dark-shadows',        'Dark Shadows',          false, null, 120),
  ('diamond-creek',       'Diamond Creek',         false, null, 130),
  ('rainbow-city',        'Rainbow City',          false, null, 140),
  ('china-town',          'China Town',            false, null, 150)
on conflict (slug) do nothing;

-- ===========================================================================
-- SERVICES — what kinds of utility/service the dashboard tracks.
-- V1 = water only. Phase 2 adds electric. Phase 3 adds cell coverage.
-- ===========================================================================
create table if not exists wss_services (
  id        serial primary key,
  slug      text unique not null,
  name      text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

insert into wss_services (slug, name, is_active)
values
  ('water',      'Water',          true),
  ('electric',   'Electric',       false),
  ('cell',       'Cell coverage',  false)
on conflict (slug) do nothing;

-- ===========================================================================
-- REPORTS — community-submitted status reports. The aggregated dashboard
-- status is computed from these in real time. For V1 there is no official
-- "incidents" table — when the Utility Authority later joins, we'll add a
-- separate wss_official_updates table.
-- ===========================================================================
create table if not exists wss_reports (
  id              uuid primary key default gen_random_uuid(),
  community_id    int references wss_communities(id) not null,
  service_id      int references wss_services(id) not null,
  status          text not null,
    -- One of: 'service_ok', 'no_service', 'low_pressure', 'cloudy_water',
    --        'boil_advisory', 'unknown', 'other'
  description     text,
  reporter_name   text,                              -- optional, free-text
  reporter_contact text,                             -- optional, free-text
  ip_hash         text,                              -- light dedup/abuse signal
  user_agent      text,                              -- for diagnostic only
  created_at      timestamptz default now()
);

create index if not exists wss_reports_community_recent_idx
  on wss_reports (community_id, created_at desc);

create index if not exists wss_reports_service_idx
  on wss_reports (service_id);

-- ===========================================================================
-- VIEW: current status per (community × service), aggregated from reports
-- in the last 24 hours. Used by the dashboard front page.
-- ===========================================================================
drop view if exists wss_current_status;
create view wss_current_status as
with recent as (
  select
    community_id,
    service_id,
    status,
    description,
    created_at
  from wss_reports
  where created_at > now() - interval '24 hours'
),
latest_per_community as (
  select distinct on (community_id, service_id)
    community_id, service_id,
    status      as latest_status,
    created_at  as latest_at
  from recent
  order by community_id, service_id, created_at desc
)
select
  c.id              as community_id,
  c.slug            as community_slug,
  c.name            as community_name,
  c.is_upstream_node,
  c.sort_order,
  s.id              as service_id,
  s.slug            as service_slug,
  s.name            as service_name,
  count(r.*) filter (where r.status = 'service_ok')      as ok_count,
  count(r.*) filter (where r.status = 'no_service')      as outage_count,
  count(r.*) filter (where r.status = 'low_pressure')    as low_pressure_count,
  count(r.*) filter (where r.status = 'cloudy_water')    as cloudy_water_count,
  count(r.*) filter (where r.status = 'boil_advisory')   as boil_advisory_count,
  count(r.*)                                             as total_reports_24h,
  max(r.created_at)                                      as last_report_at,
  lpc.latest_status,
  lpc.latest_at
from wss_communities c
cross join wss_services s
left join recent r on r.community_id = c.id and r.service_id = s.id
left join latest_per_community lpc
  on lpc.community_id = c.id and lpc.service_id = s.id
where s.is_active = true
group by c.id, c.slug, c.name, c.is_upstream_node, c.sort_order,
         s.id, s.slug, s.name,
         lpc.latest_status, lpc.latest_at;

-- ===========================================================================
-- ROW LEVEL SECURITY — anyone can read, anyone can insert reports.
-- Service role bypasses RLS, so the API endpoints (using SERVICE_ROLE_KEY)
-- can do anything; public anon access is limited.
-- ===========================================================================
alter table wss_communities enable row level security;
alter table wss_services    enable row level security;
alter table wss_reports     enable row level security;

-- Postgres does not support CREATE POLICY IF NOT EXISTS, so we DROP first
-- to make this idempotent.
drop policy if exists "Public read communities" on wss_communities;
create policy "Public read communities"
  on wss_communities for select using (true);

drop policy if exists "Public read services" on wss_services;
create policy "Public read services"
  on wss_services for select using (true);

drop policy if exists "Public read reports" on wss_reports;
create policy "Public read reports"
  on wss_reports for select using (true);

-- Reports are inserted through the API (service role), not directly by
-- anonymous users, so we leave anon insert disabled. If we ever expose
-- direct insert to the anon role, add a policy here with abuse protections.
