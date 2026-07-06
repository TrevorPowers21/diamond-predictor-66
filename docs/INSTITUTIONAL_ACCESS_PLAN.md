# Institutional Access Plan — getting past school IT (web + email)

**Date:** 2026-07-01 · **For discussion with Peyton**

## Problem
Our customers are locked-down college/athletics IT environments. Their security
stack blocks or degrades RSTR IQ in two recurring ways:
1. **Web:** a user gets Chrome's *"An application is stopping Chrome from safely
   connecting to this site"* — the school's web proxy / secure web gateway is
   doing SSL/TLS inspection and Chrome rejects the intercept cert. (Worked before,
   suddenly new = the proxy re-categorized or tightened inspection on the domain.)
2. **Email:** deliverability problems reaching school inboxes ("email issue with
   schools").

## Root causes found (2026-07-01 DNS audit of rstriq.com)
- **EMAIL — TWO SPF records exist (this is broken):**
  ```
  "v=spf1 include:spf.improvmx.com include:spf.mtasv.net ~all"   (Postmark + ImprovMX)
  "v=spf1 include:_spf.google.com ~all"                          (Google Workspace)
  ```
  RFC 7208 requires **exactly one** SPF record. Two = **PERMERROR → SPF fails
  outright**. School filters (M365, Proofpoint, Mimecast, Barracuda) are strict
  enough to quarantine/reject on that. **Almost certainly THE school email issue.**
- **WEB — rstriq.com is a proper custom domain** (good — not a wholesale-blocked
  `*.vercel.app`), but it's young/uncategorized, so school proxies flag it during
  SSL inspection.
- Context: MX = Google Workspace; transactional/auth mail goes via **Postmark**
  (`mtasv.net`; DMARC rua → postmarkapp.com); **DMARC = `p=none`** (monitor only);
  Google Workspace DKIM present. No email service in the app code → auth/reset
  mail rides Supabase → (custom SMTP likely Postmark).

## The plan

### Email (do first — highest leverage)
1. **Merge the two SPF records into ONE** (delete both, add this single TXT on rstriq.com):
   ```
   v=spf1 include:_spf.google.com include:spf.mtasv.net include:spf.improvmx.com ~all
   ```
   (~5–6 DNS lookups, under SPF's limit of 10.) This alone likely fixes school delivery.
2. **Confirm Postmark DKIM** is fully set up (its domain-specific selector CNAME/TXT).
3. **Later: tighten DMARC** from `p=none` → `p=quarantine` once SPF/DKIM verified clean.
4. Confirm the auth-email sender (Supabase) actually authenticates as rstriq.com via Postmark.

### Web (SSL-inspection / proxy blocking)
1. **Submit rstriq.com for categorization** to the major web-security vendors so
   their proxies stop flagging it org-wide (categorize as Business/Sports/Education):
   Zscaler, Cisco Talos/Umbrella, Palo Alto (URL filtering), Symantec/Bluecoat
   (WebPulse Site Review), Forcepoint, Netskope, McAfee/Trellix. Each has a public
   "submit a site for review" portal.
2. Nothing to fix on our cert — Vercel's is valid; the block is client/proxy side.

### Process (stop the fire drills)
- **IT onboarding one-pager** handed to every new customer's IT during setup:
  - Allowlist `rstriq.com` and **exclude it from SSL/TLS inspection**.
  - Allowlist **Postmark's sending IPs** for email (so auth/reset mail isn't filtered).
  - Include the "why" (SSL inspection intercept cert) so IT recognizes it fast.

## Discussion points for Peyton
- Who owns rstriq.com DNS / can make the SPF change? (do it today)
- Is Postmark the confirmed transactional sender, and is its DKIM verified?
- Do we have a customer-facing IT onboarding step yet, or does this become one?
- Any schools already blocking — which proxy vendor (block page names it) so we
  prioritize that categorization submission first?

## Immediate action for the currently-blocked user (corporate machine)
They can't fix it locally. Their IT must allowlist rstriq.com + exclude it from
SSL inspection. Confirm it's the proxy by loading the site on a phone hotspot first.
