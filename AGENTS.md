# Personal Study Tracker

This is a NEW independent project. Never modify /workspace/pure-maths-library as part of this project. Cloud tasks are already isolated; use this checkout, do not create worktrees unless asked.

Node 24. Install with npm ci. Run npm test, npm run test:database, npm run build. Browser checks: npx playwright install chromium; npm run test:browser (starts Vite automatically). In the managed environment, use PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium and supported permissions for port binding/browser launch.

Respect 04:00 device-IANA-timezone study days, integer milliseconds, pause segment exclusion, largest-remainder adjusted allocation, week starting Monday, soft delete, immutable original duration and revision audit. Tests must cover DST and year/week boundaries. Do not substitute UTC calendar-day grouping.

RLS and optimistic concurrency must be tested with real Postgres (PGlite is the fast suite). Browser must use only public Supabase keys, never service_role, database passwords or tokens. Do not publish or claim live cloud behavior without real service evidence. The opt-in backup workflow is disabled until the owner's configuration and a restoration drill; sync is not backup.

Do not silently merge conflicting offline snapshots. Pending writes and local edits must survive reload and network failure. Cloud-mode offline new starts must be rejected; only previously started timers continue offline. Never claim full offline availability or automatic behavior detection.

See docs/ACCEPTANCE.md for verified scope and outstanding deployment checks. All UI must work at 390px, keyboard focus must remain visible, dialogs must be native modal dialogs. Use hash navigation for GitHub Pages refresh/direct links. No ads/social/rankings.

## Current shared-backend decision (2026-11-03)

The user explicitly authorized sharing the maths Library Supabase, keeping sixsigma untouched. Source repositories and websites remain separate. Read docs/SHARED_SUPABASE.md. Never apply the standalone 001 migration to the existing math project. Use the generated read-only preflight first; shared installer must preserve exact legacy pp_new_user source and existing data, fail on drift or unknown INSERT hooks, and remain atomic. Do not enable global Confirm Email, change the old Site URL, or overwrite mail templates/redirect lists. Shared enrollment relies on server-verified Email OTP AMR, not editable metadata or auto-confirmed email flags; only current Email-provider behavior is reviewed. Add phone/OAuth only after a separate security review.

Run npm run test:shared (Docker, unchanged original math SQL fixture), npm run test:shared-auth (browser/API contracts with simulated hosted responses), then existing checks. Generated shared SQL is rebuilt by scripts/build-shared-sql.mjs. Do not edit only generated files. Actual live checks and email delivery remain unverified.

The owner supplied a pg_get_functiondef export after the first preflight mismatch. It has identical SQL tokens to the repository validator but different formatting. Keep BOTH exact reviewed sources in the allowlist; never normalize away whitespace inside string literals or broadly accept arbitrary function edits. npm run test:shared now tests both variants.
