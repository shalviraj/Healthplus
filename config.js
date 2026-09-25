// Public app configuration. Nothing here is secret: an OAuth Client ID is
// meant to be public, and the Sheet can only be opened by a signed-in owner.
window.HP_CONFIG = {
  // Google Cloud → APIs & Services → Credentials → OAuth client ID (Web application)
  googleClientId: "947565540571-aleqemaac6jhpuo0dldglaj7c2is1s8m.apps.googleusercontent.com",
  // The ID from the Sheet URL: docs.google.com/spreadsheets/d/<THIS PART>/edit
  sheetId: "1RphV0cKU1ibt4895qZRplHO56YQPkoXtuG1OYswq4bQ",
  // First day of the "Day" counter (Day 1)
  day1: "2026-08-11",
  // Starting insulin sliding scale (from the prescription: Inj. Fiasp, thrice
  // daily before meals, per sliding scale). Below 100 suggests 0 and above
  // 420 shows "check with doctor" automatically — no separate rows needed.
  // Editable any time from the app's Insulin chart button; once you save an
  // edit there it's kept on the phone and this default is no longer used.
  insulinChart: [
    { min: 100, max: 140, units: 3 },
    { min: 140, max: 180, units: 5 },
    { min: 180, max: 220, units: 8 },
    { min: 220, max: 260, units: 10 },
    { min: 260, max: 300, units: 12 },
    { min: 300, max: 340, units: 15 },
    { min: 340, max: 380, units: 18 },
    { min: 380, max: 420, units: 20 },
  ],
};
