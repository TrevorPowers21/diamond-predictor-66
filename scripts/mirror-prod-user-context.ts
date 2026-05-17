#!/usr/bin/env node
/**
 * Mirror a user's full auth context (roles + team access + customer_team)
 * from prod → staging. Preserves all UUIDs so prod-keyed references
 * (impersonation, RLS, watchlist scoping) continue to work in staging.
 *
 * Run AFTER mirror-prod-auth-user (the auth.users row must already exist
 * in staging with the matching id).
 *
 * Usage:
 *   npm run mirror-user-context -- <email>
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes("@")) { err("Usage: npm run mirror-user-context -- <email>"); process.exit(1); }

  console.log(COLOR.bold + `\n══ Mirror User Context: ${email} ══` + COLOR.reset);

  const stagingUrl = process.env.SUPABASE_URL ?? "";
  const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const prodEnv = loadEnvFile(join(process.cwd(), ".env.production.local"));
  const prodUrl = prodEnv.SUPABASE_URL ?? "";
  const prodKey = prodEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!stagingUrl.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL"); process.exit(1); }
  if (!prodUrl.includes("trbvxuoliwrfowibatkm")) { err("Expected prod URL"); process.exit(1); }

  const staging = createClient(stagingUrl, stagingKey, { auth: { persistSession: false } });
  const prod = createClient(prodUrl, prodKey, { auth: { persistSession: false } });

  // ── Resolve user_id ──────────────────────────────────────────────────
  const { data: prodList } = await prod.auth.admin.listUsers({ page: 1, perPage: 200 });
  const prodUser = (prodList?.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!prodUser) { err(`No prod user for ${email}`); process.exit(1); }
  const uid = prodUser.id;
  ok(`Prod user_id: ${uid}`);

  // ── Confirm staging auth.users exists ────────────────────────────────
  const { data: stagingList } = await staging.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (!(stagingList?.users || []).some((u) => u.id === uid)) {
    err(`Staging auth.users missing for ${uid}. Run mirror-auth-user first.`);
    process.exit(1);
  }
  ok(`Staging auth.users present`);

  // ── Phase 1: user_roles ──────────────────────────────────────────────
  console.log(`\n${COLOR.bold}→${COLOR.reset} Phase 1: user_roles`);
  const { data: prodRoles } = await prod.from("user_roles").select("*").eq("user_id", uid);
  info(`Prod has ${prodRoles?.length ?? 0} roles: ${(prodRoles ?? []).map((r: any) => r.role).join(", ")}`);
  for (const r of prodRoles ?? []) {
    const { error } = await staging.from("user_roles").upsert(r, { onConflict: "id" });
    if (error) { err(`  Failed: ${error.message}`); continue; }
    ok(`  ${r.role} (id=${r.id})`);
  }

  // ── Phase 2: customer_teams (mirror the team this user belongs to) ───
  console.log(`\n${COLOR.bold}→${COLOR.reset} Phase 2: customer_teams`);
  const { data: prodAccess } = await prod.from("user_team_access").select("*").eq("user_id", uid).maybeSingle();
  if (!prodAccess) {
    warn("No prod user_team_access — skipping customer_teams + access mirror");
  } else {
    const { data: prodCT } = await prod.from("customer_teams").select("*").eq("id", prodAccess.customer_team_id).maybeSingle();
    if (prodCT) {
      info(`Mirroring customer_team: ${prodCT.name} (id=${prodCT.id})`);
      // Null created_by — the prod creator user doesn't exist in staging auth.
      const ctPayload = { ...prodCT, created_by: null };
      const { error } = await staging.from("customer_teams").upsert(ctPayload, { onConflict: "id" });
      if (error) err(`  customer_teams upsert failed: ${error.message}`);
      else ok(`  customer_team upserted`);

      console.log(`\n${COLOR.bold}→${COLOR.reset} Phase 3: user_team_access`);
      // No unique constraint on user_id — check + insert manually
      const { data: existing } = await staging.from("user_team_access").select("user_id").eq("user_id", uid).maybeSingle();
      if (existing) {
        ok(`  user_team_access already exists for ${uid}`);
      } else {
        const accPayload = { ...prodAccess, created_by: null };
        const { error: accErr } = await staging.from("user_team_access").insert(accPayload);
        if (accErr) err(`  user_team_access insert failed: ${accErr.message}`);
        else ok(`  user_team_access inserted (role=${prodAccess.role})`);
      }
    }
  }

  console.log(`\n${COLOR.green}Done.${COLOR.reset} Sign out + sign back in to refresh the session.`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
