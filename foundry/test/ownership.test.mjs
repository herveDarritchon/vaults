// Which pages Foundry players are allowed to see.
//
// `foundry_player_role` names the highest tier players may read, and the
// comparison is inclusive: at or below it a page imports player-visible, above
// it GM-only. That reads forwards. The setting it replaced named the first
// *secret* tier and compared with a strict `<`, so a GM picking "dm" was
// really saying "everything below dm" — one step off from what they chose, in
// a dialog that could not show them the consequence.
//
// Getting the boundary wrong in the permissive direction publishes DM pages to
// players, so both sides of it are pinned here.

import test from "node:test";
import assert from "node:assert/strict";

// The levels the importer reads off CONST, which does not exist outside Foundry.
globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
const { OBSERVER, NONE } = globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS;

const ROLES = ["public", "patron", "dm"];
const vault = (playerRole) => ({ playerRole, knownRoles: ROLES });

async function levelFor(playerRole, pageRole) {
  const { pageOwnershipLevelFor } = await import("../scripts/importer.mjs");
  return pageOwnershipLevelFor(vault(playerRole), pageRole);
}

test("the named tier is one players can read, not the first they cannot", async () => {
  // The inclusive boundary. Under the old setting this exact case was GM-only,
  // which is why "dm" had to be chosen to share "patron".
  assert.equal(await levelFor("patron", "patron"), OBSERVER);
});

test("everything below the named tier is readable", async () => {
  assert.equal(await levelFor("patron", "public"), OBSERVER);
});

test("everything above it is not", async () => {
  assert.equal(await levelFor("patron", "dm"), NONE);
  assert.equal(await levelFor("public", "patron"), NONE);
  assert.equal(await levelFor("public", "dm"), NONE);
});

test("the lowest tier shares only the lowest tier", async () => {
  assert.equal(await levelFor("public", "public"), OBSERVER);
});

test("the highest tier shares everything", async () => {
  for (const role of ROLES) assert.equal(await levelFor("dm", role), OBSERVER);
});

test("unset means nothing is player-visible", async () => {
  // null, not NONE: the caller leaves ownership alone entirely, which lands at
  // Foundry's own GM-only default rather than writing a level onto every page.
  assert.equal(await levelFor("", "public"), null);
  assert.equal(await levelFor("", "dm"), null);
});

test("a role the vault does not know shares nothing", async () => {
  // A renamed or removed tier must not silently widen access.
  assert.equal(await levelFor("archivist", "public"), null);
});

test("a page with no role is treated as the lowest tier", async () => {
  // Deliberate: a deploy whose manifest predates the role field advertises
  // none, and hiding everything it published would be the more surprising
  // failure. The vault only omits a role when the page has none.
  assert.equal(await levelFor("public", undefined), OBSERVER);
  assert.equal(await levelFor("public", ""), OBSERVER);
});
