// Regression tests for role-gated callout selection.
//
// The CLI emits the callout class from `type.toLowerCase()`
// (cli/src/render/callouts.ts), but a role name keeps whatever case the user
// typed — `role add` validates case-insensitively and stores verbatim. Class
// selectors are case-sensitive in the no-quirks document DOMParser produces,
// so a vault configured with role "DM" looked for `.callout-DM`, found
// nothing, and never wrapped the block in <section class="secret">. GM-only
// callouts on player-visible pages were readable by players in Foundry.

import { test } from "node:test";
import assert from "node:assert/strict";

import { calloutSelectorFor } from "../scripts/links.mjs";

test("folds a capitalised role to the class the CLI actually emits", () => {
  // The live case: Marlo Mystery is configured with roles ["public", "DM"]
  // and its pages render class="callout callout-dm".
  assert.equal(calloutSelectorFor("DM"), ".callout.callout-dm");
});

test("a lowercase role is unaffected", () => {
  assert.equal(calloutSelectorFor("dm"), ".callout.callout-dm");
});

test("mixed case folds too", () => {
  assert.equal(calloutSelectorFor("Staff"), ".callout.callout-staff");
  assert.equal(calloutSelectorFor("PaTrOn"), ".callout.callout-patron");
});

test("characters outside the class-safe set stay escaped", () => {
  // cssEscape still has to run; folding must not replace it.
  assert.equal(calloutSelectorFor("Odd.Role"), ".callout.callout-odd\\.role");
});

test("underscores and hyphens are legal in a class and are left alone", () => {
  assert.equal(calloutSelectorFor("Co_Op-Lead"), ".callout.callout-co_op-lead");
});

// ── Bases cards as content links ────────────────────────────────────────────

test("a card carries the attribute Foundry actually selects on", async () => {
  // The cards had class="content-link" and a data-uuid, and did nothing when
  // clicked. Both the click and drag handlers select `a[data-link]` — the
  // class is styling only — so the one attribute that makes an anchor behave
  // as a link was the one missing.
  const { contentLinkAttrs } = await import("../scripts/links.mjs");
  const attrs = contentLinkAttrs("JournalEntry.aaaa.JournalEntryPage.bbbb");

  assert.ok("data-link" in attrs, "data-link is what a[data-link] matches");
  assert.equal(attrs["data-link"], "", "presence, not value: createAnchor emits an empty string");
  assert.equal(attrs["data-uuid"], "JournalEntry.aaaa.JournalEntryPage.bbbb");
  assert.equal(attrs.draggable, "true", "real content links can be dragged onto the canvas");
});
