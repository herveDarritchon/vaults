// Regression tests for `foundry.sync: false`.
//
// The flag keeps a page out of Foundry without hiding it from the wiki, so
// the CLI's only job is to forward it verbatim on the page's manifest meta
// row — the Foundry module does the filtering. These build end-to-end via
// buildSite() so a regression in the meta-collection path is caught.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; out: string; }

async function setupVault(files: Record<string, string>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-fsf-"));
  const out = join(dir, "_out");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return { dir, out };
}

async function build(v: Vault): Promise<void> {
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await buildSite({
      vaultPath: v.dir,
      outputDir: v.out,
      vaultName: "Test",
      imageQuality: 0,
      maxFileBytes: 1 << 30,
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

interface ManifestFile { path: string; meta?: { foundry?: Record<string, unknown> } }

async function metaFor(v: Vault, bodyPath: string): Promise<ManifestFile["meta"]> {
  const raw = await readFile(join(v.out, "_manifest.json"), "utf8");
  const manifest = JSON.parse(raw) as { files: ManifestFile[] };
  const row = manifest.files.find((f) => f.path === bodyPath);
  assert.ok(row, `no manifest row for ${bodyPath}`);
  return row.meta;
}

describe("foundry.sync", () => {
  it("forwards sync: false onto the page's manifest meta", async () => {
    const v = await setupVault({
      "Notes.md": "---\nfoundry:\n  sync: false\n---\n# Notes\n\nWiki-only.\n",
    });
    try {
      await build(v);
      const meta = await metaFor(v, "Notes.body.html");
      assert.equal(meta?.foundry?.sync, false);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("still renders the page to the wiki", async () => {
    const v = await setupVault({
      "Notes.md": "---\nfoundry:\n  sync: false\n---\n# Notes\n\nWiki-only.\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Notes.body.html"), "utf8");
      assert.match(html, /Wiki-only\./);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("omits the key entirely when unset, so existing pages are untouched", async () => {
    const v = await setupVault({
      "Plain.md": "# Plain\n",
      "Actor.md": "---\nfoundry:\n  base: Actor:npc\n---\n# Actor\n",
    });
    try {
      await build(v);
      assert.equal((await metaFor(v, "Plain.body.html"))?.foundry, undefined);
      const actor = await metaFor(v, "Actor.body.html");
      assert.equal(actor?.foundry?.base, "Actor:npc");
      assert.ok(!("sync" in (actor?.foundry ?? {})), "sync should not be synthesised");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("coexists with base, so an instantiating page can still opt out", async () => {
    const v = await setupVault({
      "Scene.md": "---\nfoundry:\n  base: Scene\n  sync: false\n---\n# Scene\n",
    });
    try {
      await build(v);
      const meta = await metaFor(v, "Scene.body.html");
      assert.equal(meta?.foundry?.base, "Scene");
      assert.equal(meta?.foundry?.sync, false);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("ignores a non-boolean sync value", async () => {
    const v = await setupVault({
      "Bad.md": "---\nfoundry:\n  sync: \"nope\"\n---\n# Bad\n",
    });
    try {
      await build(v);
      const meta = await metaFor(v, "Bad.body.html");
      assert.ok(!("sync" in (meta?.foundry ?? {})), "string sync should be dropped");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });
});
