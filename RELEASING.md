# Releasing Vaults

How to cut a release for the `@wizzlethorpe/vaults` CLI and the Vaults Foundry
module. Both ship under a **single shared version** (`v0.14.0`, `v0.15.0`, …)
so a `vX.Y.Z` tag pins the exact behavior of CLI + Foundry together.

The landing site (a vault content directory) is **not** version-coupled. It
deploys independently with `cd landing && vaults push`.

## Prerequisites

Tooling on `PATH`:

- `jq`, `pnpm`, `npm`, `gh`, and (for the Foundry release) `zip` and `curl`.

Credentials, checked before running:

| Channel | Required? | How to check |
|---|---|---|
| CLI → npm | Yes | `npm whoami` (must return your npm username) |
| Foundry → GitHub release | Yes | `gh auth login` / `gh auth status` |
| Foundry → FoundryVTT registry | Optional | `FOUNDRY_RELEASE_TOKEN` (or `FOUNDRY_API_TOKEN`) in `foundry/.env` |

Notes:

- Without the Foundry registry token the release still ships — it just creates
  the GitHub release and skips publishing to Foundry's in-app browser.
- The working tree must be clean (`git status --porcelain` empty). Commit or
  stash first.
- A broken build will not be caught by CI — there is none. The release script
  itself runs `pnpm typecheck && pnpm test` before shipping, and that is the
  only gate.

## Release the CLI + Foundry together

From the monorepo root:

```bash
./release.sh <X.Y.Z>
```

or run interactively to pick a major/minor/patch bump:

```bash
./release.sh
```

Optional flags (any position): `--skip-cli`, `--skip-foundry`.

### What it does

1. **Gates** — checks tools, clean tree, semver argument, then runs
   `pnpm typecheck && pnpm test`. Aborts on any failure.
2. **Bump** — sets `cli/package.json` and `foundry/module.json` to `<X.Y.Z>`,
   makes a single `Release vX.Y.Z` commit and an annotated `vX.Y.Z` tag.
3. **Push** — pushes `main` and the tag to `origin` *before* the subproject
   pipelines, so the GitHub release points at the exact commit.
4. **CLI** — `pnpm --filter @wizzlethorpe/vaults run build && publish`.
   The build is `tsc` (→ `dist/`) plus `scripts/bundle-importer.mjs`, which
   re-bundles the Foundry sync code into `dist/foundry-importer.bundle.js`
   (shipped to deploys as `_foundry/importer.js`). `prepublishOnly` rebuilds
   once more so the bundle is fresh.
5. **Foundry** — calls `foundry/release.sh <X.Y.Z>` (see below), then commits
   + pushes the `/latest/` URL reset it leaves behind.

### After it finishes

The script prints the npm and GitHub URLs. Optionally, deploy the landing site:

```bash
cd landing && vaults push
```

## The Foundry release (`foundry/release.sh`)

Normally run through the root script, but available standalone in
`foundry/`. It:

1. Rewrites `module.json` with **versioned** URLs
   (`/releases/download/vX.Y.Z/…`) so Foundry's registry doesn't serve stale,
   cached manifests.
2. Zips `module.json` + `scripts/ styles/ lang/` (+ LICENSE/README) into
   `module.zip`.
3. Creates/recreates the GitHub release `vX.Y.Z` with `module.zip` and
   `module.json` as assets.
4. Publishes to the FoundryVTT Package Registry if a token is present.
5. **Resets** the repo's `module.json` back to `/releases/latest/` URLs so dev
   installs float on the latest release.

Note: a changed importer bundle changes its SHA-256, so the GM sees a trust
prompt on the next sync (`trustedImporterHash`). Expect one per release.

## Reminder

- `CONTRIBUTING.md` asks contributors **not** to bump version numbers in PRs —
  only the maintainer does that, at release time.
- Don't hand-edit `cli/package.json` or `foundry/module.json` versions outside
  a release; the root script keeps them in lockstep.
