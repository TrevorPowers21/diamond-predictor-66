import posthog from "posthog-js";

export function initPostHog() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  const host = import.meta.env.VITE_POSTHOG_HOST;
  if (!key) return;

  posthog.init(key, {
    api_host: host,
    defaults: "2026-05-30",
    person_profiles: "identified_only",
    capture_pageview: true,       // auto page view on every route change
    capture_pageleave: true,      // time on page
    session_recording: {
      maskAllInputs: true,        // mask password fields in recordings
      maskInputOptions: { password: true },
    },
  });
}

export function identifyUser(user: {
  id: string;
  email?: string | null;
  teamName?: string | null;
  teamRole?: string | null;
  isSuperadmin?: boolean;
}) {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  posthog.identify(user.id, {
    email: user.email,
    team: user.teamName,
    team_role: user.teamRole,
    is_superadmin: user.isSuperadmin ?? false,
  });
}

export function resetPostHog() {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  posthog.reset();
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  posthog.capture(event, properties);
}
