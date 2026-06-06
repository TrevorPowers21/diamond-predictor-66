import posthog from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

export function initPostHog() {
  if (!KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    defaults: "2026-05-30",
    person_profiles: "always",
    // We fire $pageview/$pageleave manually in PostHogPageView (App.tsx)
    // so SPA route changes are tracked correctly.
    capture_pageview: false,
    capture_pageleave: false,
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: { password: true },
    },
    autocapture: true, // capture clicks, form submits, etc.
  });
}

export function identifyUser(user: {
  id: string;
  email?: string | null;
  teamName?: string | null;
  teamRole?: string | null;
  isSuperadmin?: boolean;
}) {
  if (!KEY) return;
  posthog.identify(user.id, {
    email: user.email,
    team: user.teamName,
    team_role: user.teamRole,
    is_superadmin: user.isSuperadmin ?? false,
  });
}

export function resetPostHog() {
  if (!KEY) return;
  posthog.reset();
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!KEY) return;
  posthog.capture(event, properties);
}

export function capturePageView(path: string) {
  if (!KEY) return;
  posthog.capture("$pageview", {
    $current_url: window.location.href,
    $pathname: path,
    $host: window.location.host,
    $referrer: document.referrer || "$direct",
    $referring_domain: document.referrer ? new URL(document.referrer).hostname : "$direct",
    $screen_height: window.screen.height,
    $screen_width: window.screen.width,
    $viewport_height: window.innerHeight,
    $viewport_width: window.innerWidth,
  });
}

export function capturePageLeave(path: string) {
  if (!KEY) return;
  posthog.capture("$pageleave", {
    $current_url: window.location.href,
    $pathname: path,
    $host: window.location.host,
  });
}

export function captureWebVital(name: string, value: number, rating: string) {
  if (!KEY) return;
  posthog.capture("$web_vitals", {
    [`$web_vitals_${name.toLowerCase()}_value`]: value,
    [`$web_vitals_${name.toLowerCase()}_rating`]: rating,
  });
}
