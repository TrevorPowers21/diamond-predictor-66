# RSTR IQ — URL Structure & Migration Plan

> Status: **proposed — to think through.** Not scheduled yet. Captured 2026-07-17.

## What we're doing

Renaming `portal.rstriq.com` to `app.rstriq.com` and keeping every workflow underneath it as a path. The marketing site stays where it is.

```
rstriq.com              marketing / landing page
app.rstriq.com          new home page (active users land here)
app.rstriq.com/eval     player evaluation
app.rstriq.com/gm       front office
```

Two top-level workflows. Everything else (transfer portal, target board, draft board, pulse chart) is a **function inside one of those**, not a route beside them.

## Why

**Why paths and not subdomains.** `gm.rstriq.com` and `app.rstriq.com` are separate browser origins. Separate origins mean separate sessions, separate deploys, and a new DNS record plus TLS cert every time we ship a workflow. Paths give us one auth, one shell, one router, and instant client-side navigation between workflows. Our multi-tenancy already lives in `org_id` and RLS, so there is no reason for tenancy or workflow to live in DNS.

**Why we're dropping "portal."** We sell to college baseball staffs. To them, "portal" means the transfer portal. Our own product uses the word that way: portal pulse, portal scraper, portal windows. Having the app itself live at `portal.rstriq.com` collides with our own vocabulary. "App" is boring, which is the point: it carries no baseball meaning and will never conflict with a feature name we ship later.

**Why the root domain stays marketing.** `rstriq.com` is the sales and SEO asset. Keeping it a pure static deploy means landing-page copy is never coupled to app releases. Cheap win later: have the root detect an active session and flip the CTA from "Book a Demo" to "Open App."

**Why the new home page matters here.** The shell needs a reason to exist. The new home page (Morning Briefing strip, hero card for top target, target board, activity feed) is the place a coach lands, gets oriented, and picks a workflow. That's what turns the shell from a pass-through into the daily destination.

## Steps, in order

**1. Ship cookie-based Supabase auth scoped to `.rstriq.com`.**
Supabase stores the session in localStorage by default, which is scoped per-origin. If we skip this, every active user gets logged out the moment we cut over. Swap the client to a cookie storage adapter with the domain set to `.rstriq.com`. Cookies scope to the registrable domain, so the session rides across the subdomain change and nobody notices.
Ship this a release or two ahead of the cutover so the cookie is already sitting in browsers when we flip.

**2. Update Supabase auth config.**
- Add `https://app.rstriq.com` to the redirect allow-list
- Update Site URL
- Update any hardcoded links in email templates (confirmation, magic link, password reset)
- Update any third-party OAuth callback URLs

Miss any of these and magic links fail with an error that looks like nothing is wrong.

**3. Stand up DNS and TLS for `app.rstriq.com`.**
Verify the app serves correctly on the new host before touching the old one.

**4. Add the wildcard 301 from portal to app.**
```json
{
  "redirects": [{
    "source": "/:path*",
    "has": [{ "type": "host", "value": "portal.rstriq.com" }],
    "destination": "https://app.rstriq.com/:path*",
    "permanent": true
  }]
}
```
Path is preserved, so an old bookmark to `portal.rstriq.com/gm/targets/1042` lands on `app.rstriq.com/gm/targets/1042`. No dead links.

**5. Test one magic link end to end before announcing.**
Query strings have to survive the hop. Supabase auth callbacks carry `?code=`, magic links use `#access_token=`. Confirm a real login works through the redirect.

**6. Announce.**
One email, one in-app banner. "We renamed the address, your old bookmarks still work." At our current active user count this is a non-event.

## What this does and doesn't do for users

The 301 saves bookmarks. It does **not** save sessions. That's the whole reason step 1 comes first. Without the cookie work, every active coach gets bounced to a login screen on their next visit, which with magic links means an email round trip on a random Tuesday with no explanation.

**Fine either way:** password managers (they match on registrable domain), deep links pasted into group texts, old links a coach saved months ago.

**Watch for:** analytics will show a fake traffic drop on portal and a fake spike on app unless the analytics cookie is also scoped to the parent domain. That week's retention numbers will be noise.

## Two things that will bite us if we forget

**Keep the `portal.rstriq.com` DNS record and TLS cert alive forever.** A redirect only fires if the hostname resolves and completes a TLS handshake first. Let the cert lapse and every old bookmark dies with a browser security warning, which is worse than a 404.

**A 301 is cached by browsers more or less permanently.** Good, because repeat visitors skip the hop entirely. But it means we can never reuse `portal.rstriq.com` for anything else. Anyone who cached the redirect keeps bouncing to app no matter what we serve there. Since we're retiring the word anyway, that's fine. Just know the door locks behind us.

## Timing

Do this **before the next onboarding round** so new programs never learn the old URL. Changing a base URL is cheap once and expensive twice.

## One rule going forward

`/eval` and `/gm` are the only top-level paths. Resist promoting a function to a route just because it feels important this week. Everything else lives inside a workflow and earns its way up.
