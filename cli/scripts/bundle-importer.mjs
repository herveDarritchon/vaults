// Build-time step: bundle the Foundry-side importer into a single ESM file
// shipped inside the npm package at `dist/foundry-importer.bundle.js`. Run
// after `tsc` (see the `build` script). Bundling here rather than at runtime
// means the published CLI never invokes esbuild on the user's machine and
// doesn't need the sibling `foundry/` source tree, which isn't part of the
// package. At deploy time src/foundry-importer.ts just copies this bundle to
// `_foundry/importer.js`.

import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // cli/scripts
const entry = resolve(here, "..", "..", "foundry", "scripts", "importer-entry.mjs");
const outfile = resolve(here, "..", "dist", "foundry-importer.bundle.js");

await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // Foundry globals are present at runtime; esbuild treats them as externals
  // automatically because they're not imported. No need to mark any explicitly.
  minify: false,
  sourcemap: false,
  legalComments: "none",
});
console.log(`bundled foundry importer → ${outfile}`);
