# Recruit Video / Film — FUTURE IDEA (deferred 2026-07-30)

Design worked through with Trevor 2026-07-30. **Not built.** Deferred after the
recruit-identity + scouting-report work shipped; captured here so the decisions
aren't lost. This is the "Video (LAST phase)" of Scouting v2.

## What it is
PBR / PG **links are already built in** (external film). This feature is the OTHER
case: **short clips a coach shoots on their phone**, attached to a recruit, to go
with what they write in a scouting report. Not a Hudl replacement — quick looks
(a pitch, a swing) filmed courtside.

## The hard requirement that shapes everything
**MP4, playable for everyone. Trevor: "Defeats the purpose if not playable."**
iPhones shoot **.mov / HEVC (H.265)** — Safari plays it, Chrome/Android often don't.
So a clip one coach films could be unplayable for the rest of the staff. Getting to
"plays for everyone" means **transcoding to H.264 MP4 server-side**, and **Supabase
Edge Functions can't run real ffmpeg** — so the original "Supabase bucket only" spec
does NOT actually deliver this.

### Decision: use a managed video service (transcode is not DIY here)
- **Recommended: Cloudflare Stream** (or Mux). Ingests HEVC/.mov, auto-transcodes to
  universal MP4/HLS, returns a playback URL that works everywhere, handles
  private/signed access. Removes the transcode headache entirely.
- **Cost = monthly, metered** (not upfront). Cloudflare ≈ $5 / 1,000 min stored/mo +
  $1 / 1,000 min delivered/mo, ~$5/mo minimum. Mux = no minimum + a small per-upload
  encode fee. With short-clip caps + auto-scrub, realistic ≈ **a few $/month per
  program**; never balloons. One RSTR IQ account, aggregated across teams — Trevor
  decides eat-it vs pass-through.
- DIY alternative (Supabase Storage + our own ffmpeg worker on Fly/Railway) rejected
  as too fragile for a "must play for everyone" feature.
- **`gm_recruit_video` stores the provider video id + playback URL**, not a Supabase
  storage path. Retention/scrub = a provider API delete (cleaner than a purge job).

## Retention — soft-archive + restore (Trevor's instinct, locked)
Do **not** hard-delete. Coaches may want an old look back in the offseason when
there are no fresh views.
- Per-team **retention setting** (default ~90 days; shorter in-season if a staff wants).
- At the age limit a clip goes **Archived** (hidden from the active list, one-click
  **Restore**) — NOT deleted. File stays during a **grace window** (~60–90 more days).
- Only after the grace window does the purge actually delete. Always a restore window;
  cost stays bounded. Flexible to any staff's workflow.

## Caps — by SIZE, not count (Trevor)
"15 one-pitch iPhone clips = fine; 2 five-minute videos = a problem."
- **Per clip:** short only — ~60 sec / ~50 MB (60s ≈ "one pitch").
- **Per recruit:** a total storage budget (~400–500 MB), not a clip count.

## UI placement
- **Now:** a **"Video (N)"** section alongside Reports + Contacts in the recruit
  drill-down; a **titled link list (no thumbnails)** — click a clip → film-study
  player popup.
- **Future:** recruit **player-profiles** with a Film tab; this drops in there.

## The player (the differentiator Trevor cares about)
NOT a generic play button. A custom HTML5 film-study player on the provider's
playback URL:
- **Slow-mo / speed presets** (0.25× / 0.5× / 1× / 2×).
- **Scrubbable timeline** — grab + drag the cursor.
- **Frame-step** forward / back.
- **Side-by-side compare** — two clips (different angles) in one view.
  Build **independent scrub first**, add a **lock/sync** toggle as a fast-follow.

## Data model (when built)
`gm_recruit_video`: `recruit_id`, `customer_team_id`, `provider` (`cloudflare|mux`),
`provider_video_id`, `playback_url`, `title`, `duration_sec`, `size_bytes`,
`created_at`, `expires_at`, `archived_at`, `uploaded_by`. Team RLS by
`customer_team_id`. Retention config per team (a GM Settings value).

## Open when we pick this back up
- Cloudflare Stream vs Mux (no-minimum) — final pick + account/API key.
- Confirm retention default + grace numbers, per-clip + per-recruit caps.
- Mobile upload UX (record/pick → upload → "processing…" while it transcodes).
