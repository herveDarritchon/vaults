// Build helper: the Foundry-side importer is pre-bundled at CLI build time
// (see scripts/bundle-importer.mjs) into `dist/foundry-importer.bundle.js`,
// which ships inside the npm package. At deploy time we copy that bundle to
// `_foundry/importer.js` and emit a `_foundry/version.json` sidecar carrying
// `{ version, sha256 }` so the Foundry host can detect skew before evaluating.
//
// Bundling ahead of publish (not here) means the installed CLI never runs
// esbuild on the user's machine and doesn't need the foundry/ source tree,
// which isn't part of the npm package.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_VERSION } from "./version.js";

// Sibling of this compiled file in dist/, produced by scripts/bundle-importer.mjs.
const BUNDLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "foundry-importer.bundle.js",
);

/**
 * Write `_foundry/importer.js` + `_foundry/version.json` into the deploy.
 * Called from build.ts after the variant outputs are in place — the
 * bundle is a shared root-level asset (not per-variant), since it has
 * no role-gated content.
 */
export async function writeFoundryImporter(outputDir: string): Promise<void> {
  const source = await readFile(BUNDLE_PATH, "utf8");
  const sha256 = createHash("sha256").update(source).digest("hex");
  const dir = join(outputDir, "_foundry");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "importer.js"), source);
  await writeFile(
    join(dir, "version.json"),
    JSON.stringify({ version: CLI_VERSION, sha256 }, null, 2),
  );
}
