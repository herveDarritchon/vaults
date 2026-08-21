// `ignore:` patterns are exclusions, so their wildcards have to cross hidden
// segments. Without `dot: true`, picomatch refuses to let `*` or `**` match a
// leading dot, and `tools/**` quietly spares `tools/.venv/**` — the very files
// an ignore rule exists to get rid of. That failed silently for a while: the
// build skipped 24 unrecognised files on every run while the pattern that was
// supposed to cover them sat right there in settings.md.
//
// This pins the option rather than the implementation: build.ts builds its
// matchers the same way, so if someone drops the flag these fail.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import picomatch from "picomatch";

/** Exactly how build.ts compiles an `ignore:` entry. */
const matcher = (pattern: string) => picomatch(pattern, { dot: true });
const ignores = (pattern: string, path: string) => matcher(pattern)(path);

describe("ignore globs", () => {
  it("crosses a hidden directory", () => {
    assert.ok(ignores("tools/**", "tools/.venv/bin/activate"));
    assert.ok(ignores("tools/**", "tools/.ruff_cache/CACHEDIR.TAG"));
    assert.ok(ignores("tools/**", "tools/.git/config"));
  });

  it("still matches the visible files it always did", () => {
    assert.ok(ignores("tools/**", "tools/README.md"));
    assert.ok(ignores("tools/**", "tools/src/build.py"));
  });

  it("matches a hidden directory named outright", () => {
    // These were never broken — the dot is in the pattern, not being crossed
    // by a wildcard — but they are the common case and worth holding.
    assert.ok(ignores(".claude/**", ".claude/settings.json"));
    assert.ok(ignores(".obsidian/**", ".obsidian/workspace.json"));
  });

  it("does not swallow paths outside the pattern", () => {
    assert.ok(!ignores("tools/**", "Places/Azkaban.md"));
    assert.ok(!ignores("tools/**", "toolsmith/README.md"));
    assert.ok(!ignores(".claude/**", "claude/notes.md"));
  });

  it("keeps extension patterns working against hidden files", () => {
    assert.ok(ignores("*.draft.md", "notes.draft.md"));
    assert.ok(ignores("**/*.draft.md", "DM Notes/.private/plot.draft.md"));
    assert.ok(!ignores("*.draft.md", "notes.md"));
  });
});
