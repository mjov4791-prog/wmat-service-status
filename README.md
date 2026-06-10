# WMAT Service Status

A community-driven service status dashboard for the White Mountain Apache Tribe (Fort Apache Indian Reservation). V1 tracks **water service** across all 11 communities. Residents submit reports anonymously; the dashboard aggregates them into a current status view in real time.

**Owner:** Mario Jovenal / CyberApache AI Solutions
**Status:** V1 build, ready to deploy.

---

## What this is and why it exists

Multi-day water outages on the reservation often pass without any official communication from the Utility Authority. Elders, families with young kids, and pets are left without water and without an estimate of when service will be restored. Residents end up calling neighbors trying to figure out whether the outage is system-wide, what's happening, and when to expect water back.

This dashboard fixes the simplest version of that problem: it lets residents share what they're seeing in their own community, and shows the resulting picture across the whole reservation. When you don't know what's going on with your water, you can look here and at least see what your neighbors are reporting.

It is **not** an official Utility Authority service. If/when the Authority chooses to participate, the architecture supports adding official updates alongside community reports.

## Communities tracked (V1)

1. Whiteriver
2. East Fork
3. Cedar Creek
4. Carrizo
5. McNary
6. Cibecue
7. Hon-Dah
8. Forestdale
9. **Miner Flats** — flagged as upstream water pump infrastructure; issues here cascade to downstream communities
10. Sunrise Park Resort
11. Turkey Creek

## Phased roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| V1    | Water service, all 11 communities, community-driven reporting | **Built, ready to deploy** |
| V1.1  | SMS alert subscriptions (via Twilio) | Planned |
| V1.2  | Light moderation if abuse appears | Planned, contingent on need |
| V2    | Add electric service tracking | Planned |
| V3    | Add cell coverage reporting | Planned |
| Phase 4 | Western Apache language UI (Ndee biyáti') | Planned |
| Phase 5 | Utility Authority direct participation (admin login or email-to-post) | Planned |

## Tech stack

- **Frontend:** Single `index.html` with embedded CSS and vanilla JavaScript. Mobile-first.
- **API:** Two Vercel serverless functions — `api/status.js` (GET) and `api/report.js` (POST)
- **Database:** Supabase Postgres with `wss_` table prefix
- **Hosting:** Vercel static + serverless

Same architectural pattern as the other CyberApache AI Solutions tools.

## File layout

```
wmat-service-status/
├── README.md                ← this file
├── index.html               ← public dashboard + report form
├── vercel.json              ← Vercel config
├── package.json             ← Node deps (@supabase/supabase-js)
├── .env.example             ← env var template
├── api/
│   ├── status.js            ← GET /api/status — current aggregated status
│   └── report.js            ← POST /api/report — submit a community report
└── supabase/
    └── schema.sql           ← run this once in Supabase SQL Editor before deploy
```

## Setup steps

1. **Run the schema migration.** Open your Supabase project's SQL Editor, paste the contents of `supabase/schema.sql`, and run it. This creates the `wss_communities`, `wss_services`, `wss_reports` tables, seeds the 11 communities, and creates the `wss_current_status` view.

2. **Set environment variables in Vercel.** Same `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as the other projects sharing the same Supabase backend.

3. **Deploy.** Push the repo to GitHub, import into Vercel as a new project, hit Deploy.

## Editorial principles

1. **Honest about what it is.** This is community-reported, not official. The intro band makes that clear.
2. **No barriers to reporting.** No accounts, no email verification, no captcha. Anonymous is fine.
3. **Lightweight rate limiting.** 60-second cool-down per IP to deter accidental double-posts and basic abuse.
4. **Privacy.** Reporter name and contact are optional. Posted reports show only the community and what was reported, not who reported it.
5. **Tribal sovereignty.** Eventually the Utility Authority should run this themselves or co-own it. The architecture supports adding their participation when they're ready.
6. **Cultural readiness.** The data model carries Apache-language fields from day one so Phase 4 doesn't require a rewrite.

## Status logic

Current V1 derivation (per community, last 24 hours):

| Condition | Status |
|-----------|--------|
| 0 reports | Unknown |
| Any `no_service` report | Outage |
| Any `boil_advisory` | Boil advisory |
| Any `low_pressure` or `cloudy_water` | Degraded |
| Only `service_ok` reports | OK |

These thresholds are deliberately simple for V1. Once we have real reporting volume, we can refine them.

## Future architectural notes

When the Utility Authority eventually participates, the right pattern is:

- Add a `wss_official_updates` table for authoritative posts (planned outages, restoration estimates, boil advisories)
- Add either an admin login (Supabase Auth) or an email-to-post bridge (designated email address; messages received become posts after validation)
- Update the status derivation to prefer official updates over community reports when both are present

This pattern lets the Authority join without disrupting the existing community-driven layer.

## Disclaimer

This is a community-built communication tool. It is not affiliated with the WMAT Utility Authority, the White Mountain Apache Tribal Council, or any tribal government office. In an emergency, contact the Utility Authority directly or call 911. Do not rely on this dashboard as your sole source of water service information.
