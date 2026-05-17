#!/usr/bin/env node
/**
 * Mirror a single auth user from prod → staging.
 *
 * Preserves the user_id (UUID) so any RLS / team_id linkage keyed to the
 * prod user_id continues to work in staging. Password is set fresh at the
 * prompt — Supabase admin API can't extract a plaintext password from prod.
 *
 * Usage:
 *   npm run mirror-auth-user -- <email>
 *   npm run mirror-auth-user -- trevor.m.powers21@gmail.com
 */
import { createInterface } from "node:readline/promises";
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
  if (!email || !email.includes("@")) { err("Usage: npm run mirror-auth-user -- <email>"); process.exit(1); }

  console.log(COLOR.bold + `\n══ Mirror Auth User: ${email} ══` + COLOR.reset);

  const stagingUrl = process.env.SUPABASE_URL ?? "";
  const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const prodEnv = loadEnvFile(join(process.cwd(), ".env.production.local"));
  const prodUrl = prodEnv.SUPABASE_URL ?? "";
  const prodKey = prodEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!stagingUrl.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL — check .env.local SUPABASE_URL"); process.exit(1); }
  if (!prodUrl.includes("trbvxuoliwrfowibatkm")) { err("Expected prod URL — check .env.production.local"); process.exit(1); }

  const staging = createClient(stagingUrl, stagingKey, { auth: { persistSession: false } });
  const prod = createClient(prodUrl, prodKey, { auth: { persistSession: false } });

  // ── Fetch prod user ──────────────────────────────────────────────────
  info(`Looking up ${email} in prod...`);
  const { data: prodList, error: prodErr } = await prod.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (prodErr) { err(`Prod listUsers failed: ${prodErr.message}`); process.exit(1); }
  const prodUser = (prodList?.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!prodUser) { err(`No prod user found with email ${email}`); process.exit(1); }
  ok(`Found prod user: id=${prodUser.id}`);
  info(`  created_at: ${prodUser.created_at}`);
  info(`  metadata: ${JSON.stringify(prodUser.user_metadata || {})}`);

  // ── Check staging ────────────────────────────────────────────────────
  const { data: stagingList } = await staging.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = (stagingList?.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase() || u.id === prodUser.id);
  if (existing) {
    warn(`Staging user already exists: id=${existing.id}, email=${existing.email}`);
    warn(`Run nothing. If you want to reset the password, use Supabase dashboard or extend this script.`);
    process.exit(0);
  }

  // ── Prompt for password ──────────────────────────────────────────────
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = (await rl.question(`Set a staging password for ${email}: `)).trim();
  rl.close();
  if (password.length < 8) { err("Password must be at least 8 chars."); process.exit(1); }

  // ── Create staging user with matching id ─────────────────────────────
  info(`Creating staging user with id=${prodUser.id}...`);
  const { data: created, error: createErr } = await staging.auth.admin.createUser({
    id: prodUser.id,
    email: prodUser.email!,
    password,
    email_confirm: true,
    user_metadata: prodUser.user_metadata || {},
    app_metadata: prodUser.app_metadata || {},
  });
  if (createErr) { err(`createUser failed: ${createErr.message}`); process.exit(1); }
  ok(`Created staging user: id=${created.user?.id}`);
  ok(`You can now sign in at the staging app with ${email} + your chosen password.`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
