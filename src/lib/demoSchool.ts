/**
 * Demo School Configuration
 *
 * Single source of truth for the demo school lock.
 * Change ONLY this file to switch which school all pages default to.
 * After changing, clear localStorage: localStorage.removeItem("team_builder_draft_v3")
 */

export const DEMO_SCHOOL = {
  name: "Virginia Tech",
  fullName: "Virginia Polytechnic Institute and State University",
  logo: "/vtlogo.png",
  primaryColor: "#630031",
  secondaryColor: "#CF4420",
  mascot: "Hokies",
} as const;
