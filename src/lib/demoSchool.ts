/**
 * Demo School Configuration
 *
 * Single source of truth for the demo school lock.
 * Change ONLY this file to switch which school all pages default to.
 * After changing, clear localStorage: localStorage.removeItem("team_builder_draft_v3")
 */

export const DEMO_SCHOOL = {
  name: "TCU",
  fullName: "Texas Christian University",
  logo: "/tculogo.png",
  primaryColor: "#4D1979",
  secondaryColor: "#A3A9AC",
  mascot: "Horned Frogs",
} as const;
