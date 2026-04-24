/**
 * Demo School Configuration
 *
 * Single source of truth for the demo school lock.
 * Change ONLY this file to switch which school all pages default to.
 * After changing, clear localStorage: localStorage.removeItem("team_builder_draft_v3")
 */

export const DEMO_SCHOOL = {
  name: "RSTR IQ All-Americans",
  fullName: "RSTR IQ All-Americans",
  logo: "/rstr-iq-logo.png",
  primaryColor: "#D4AF37",
  secondaryColor: "#0a1428",
  mascot: "All-Americans",
} as const;
