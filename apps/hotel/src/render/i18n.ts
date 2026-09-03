// Minimal i18n table for player-visible HUD strings. English only in source,
// per CLAUDE.md: "Player-visible strings go through the i18n table (`t()`
// keys), English only in source." No existing i18n helper was found
// elsewhere in the repo (checked packages/ and apps/), so this is the hotel
// app's own table.

const TABLE: Record<string, string> = {
  "wordmark": "GRAND FOYER",
  "entry.cta": "Click to enter the hotel",
  "entry.controls": "W A S D move · Mouse look · Click interact · V third person · H hints · Esc release mouse",
  "entry.assetsMissing": "CC0 asset pack not installed — run npm run assets:fetch -w apps/hotel",
  "loading.pending": "Loading assets… {n} pending",
  "loading.ready": "Ready",
  "prompt.door": "Open / close door",
  "prompt.terminal": "Use terminal",
  "prompt.guest": "Serve guest",
  "prompt.mess": "Clean up",
  "prompt.prop": "Repair",
  "prompt.candidate": "Interview candidate",
  "prompt.document": "Pick up document",
  "walkthrough.desk": "Walk to the front desk.",
  "walkthrough.papers": "Click the guest to take their papers.",
  "walkthrough.terminal": "Use the terminal.",
  "walkthrough.checkin": "Read the papers and check the guest in.",
  "walkthrough.clean": "Clean the room after checkout.",
  "walkthrough.repair": "Repair the broken prop.",
  "walkthrough.audit": "Open LEDGER and run the night audit.",
  "walkthrough.hire": "Open STAFF and hire a clerk.",
  "walkthrough.renovate": "You can afford to renovate — open LEDGER.",
  "endcard.title": "The Grand Foyer opens",
  "endcard.body": "Day {day} · {cash} in the till.",
};

/** Looks up a player-visible string by key. Falls back to the key itself
 *  (surfacing missing translations loudly rather than hiding them). */
export function t(key: string): string {
  return TABLE[key] ?? key;
}
