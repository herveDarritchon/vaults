# Roadmap

Working notes on where vaults goes next. Nothing here is committed to; it is the reasoning behind each decision so that future-you does not have to re-derive it. Items are roughly ordered by how much they block other work.

## In flight

Landing page documentation gaps. An audit against the built CLI surface found ten features with no coverage on vaults.wizzlethorpe.com: OIDC SSO, math (KaTeX), the `battlemap` and `gallery` handlers, `vfmc`, page transclusion, video embeds, `foundry.link`, `foundry.folder`, and `vaults migrate`. Plus a stale handler count on `Features/Handlers.md` and a cover-image bug that ships a broken `og:image` on `Features/Statblocks.md`. Being handled separately.

## 1. Separating vaults from Foundry

The problem: vaults is increasingly used for things that have nothing to do with TTRPGs (language documentation, research group sites, course sites), and those deploys still ship a Foundry importer bundle they will never use.

The split is mostly real already. The renderer is Foundry-agnostic. What is actually Foundry-specific is `cli/src/foundry-importer.ts` (writes `_foundry/importer.js` into every deploy), the `foundry.*` frontmatter handling in `build.ts`, and the `/_batch` endpoints in the middleware.

**Do not build a plugin system for this.** Two cheaper moves get nearly all of it:

1. A settings flag that skips the Foundry payload entirely: no `_foundry/`, no `_batch` routes, no `foundry.*` processing. That is the actual complaint.
2. The handler registry **is** the plugin system, and it already supports user-authored handlers with browser JS, CSS, and Foundry opt-in. Make the TTRPG-flavored built-ins (`statblock`, `battlemap`, `dice`) bundled-but-disableable handlers rather than hardcoded ones. Do not stand up a second extension mechanism next to the one that already ships.

A general plugin API earns its keep when a third party wants to write one. Today the third party is us.

## 2. Decoupling roles from passwords

The current model treats a role as a credential. `vaults role add` prompts for a password, and `Features/Patreon login.md` states the rule outright: "Roles always have a password gate," with OAuth as an additive overlay. For a site that should authenticate only through OIDC or Patreon, there is no way to turn the password form and role picker off.

The fix is to stop conflating the two. **Roles say what content is tagged. Authenticators say how a visitor proves one.**

```
roles: [public, student, staff]
auth:
  password: { student: <hash> }           # optional, per role, possibly empty
  oidc:     { staff: { domain: lmu.edu } }
  patreon:  { patron: <tierId> }
```

The login page then renders only the methods that actually exist. No password entries means no password form and no role picker.

**Keep the total order.** Roles are currently a ladder, and for teaching and research the tempting model is a set (student, staff, collaborator are not obviously ranked). But variants are generated per role, and the ladder is what makes "higher tiers see lower content" free. A set model needs one variant per reachable role *combination*, which explodes. Decouple the authentication side only, leave the content model as a ladder.

## 3. Obsidian plugin

Worth doing, but be honest about which problem it solves.

Obsidian plugins have Node access, so wrapping the CLI is straightforward: a ribbon button and commands for build/preview/push, a settings pane for role config. Real quality-of-life, small effort.

It does **not** touch the barrier that actually stops people. Needing a Cloudflare account, an API token, and wrangler is a hosting problem, not a plugin problem. Removing it means the managed platform that `CLAUDE.md` already anticipates, and a plugin that publishes to that service is the real product. Sequence it that way rather than expecting a plugin to fix it.

Practical note: `sharp` (native binary) and `wrangler` are the two dependencies that make bundling awkward. `image_quality: 0` already skips sharp at runtime, so a degraded no-compression path is close to free if needed.

## 4. Foundry versioning and the module build

Two separate items, and one is further along than it looks.

### The module build already exists

`foundry-compiler/` (`vfmc`) compiles a vault into a distributable module with LevelDB compendium packs, and `WANDS/` is the working instance. The roadmap item is not "build this," it is **promote it**: document it on landing, add it to `CLAUDE.md`, fold it in as `vaults foundry build` instead of a separate binary, and stop requiring hand-authored `flags.vfmc.packs`.

The real work underneath is that **vfmc and the live sync are two different content models.** vfmc compiles `Compendium/<folder>/` pages carrying `foundry.base` into compendium documents. The sync module compiles every page into JournalEntries. Making "compile the whole vault, journals included, into a module" work is the actual feature.

### Roles in a distributed module

A distributed module is a file on the player's disk. There is no runtime gate and nothing to redact. A `dm`-tier page must simply not be present in a module handed to players.

The only sane model is compile-per-variant: `vfmc --role <name>` produces the module for that tier, and pages at or above the module's `dmRole` cutoff get GM-only ownership. Anything cleverer leaks.

### v13 / v14

Three distinct problems that want different answers.

- **Sync-side** differences are code-level (document schema, ApplicationV1 vs V2). One module, capability checks in `foundry/scripts/`. Do not ship two modules for this.
- **Content-side** is the genuinely version-bound part. A compiled pack's LevelDB and document schema are tied to a version, and dnd5e schema drift between 13 and 14 is the real hazard. Make the target an explicit input (`vfmc --foundry-version 13`), emit the matching `compatibility` block, run the matching `@foundryvtt/foundryvtt-cli`, and produce separately-named artifacts.
- **Enforcement** is only ever `compatibility.minimum` / `maximum` in `module.json`, the one thing Foundry actually honors. The vaults module currently declares `{minimum: 13, verified: 14}` with no maximum while WANDS declares `{minimum: 14}`. Set `maximum` when we mean it.

### Consolidate the mapping first

The vault-to-Foundry mapping currently exists in three places: `cli/src/foundry-importer.ts` bundles an importer into every deploy, `foundry/scripts/` runs in the live world, `foundry-compiler/src/` compiles offline. Id derivation and wikilink-to-`@UUID` rewriting are independently implemented in both `foundry-compiler/src/index.ts` and `foundry/scripts/links.mjs`, with different hash seeds.

Pull that mapping into one shared package all three import **before** adding a version matrix on top, or the matrix gets maintained twice.

### Client-side module builder

The idea: a bundled handler that renders a "Download Foundry module" button on the deployed wiki, building a module in the visitor's browser out of the content their role gives them.

**The role story is the strongest part of this, and it is free.** The builder runs inside the deployed site, behind the existing middleware. `/_batch` and `/_batch-images` already return role-scoped rendered bodies and binaries, and `readRole()` already accepts a session cookie, an `Authorization: Bearer` header, or `?_token=`. A public visitor building a module gets the public variant; the DM gets everything. No new gating logic, no new trust boundary. The `_batch` API was built for the Foundry module's incremental sync, and this is the same read path with a different consumer.

**The wall is LevelDB.** Foundry v11+ compendium packs are LevelDB directories, and `@foundryvtt/foundryvtt-cli` writes them through `classic-level`, a native Node binding. It does not run in a browser. Hand-writing a LevelDB log and MANIFEST in JS is technically possible (the write-ahead log format is simple enough that a few hundred lines would do it) but it is exactly the kind of thing that breaks silently on a Foundry upgrade.

**So do not build a module in the browser. Build a payload, and let a bootstrapper do the Foundry-specific work at install time.** The zip contains:

```
module.json          # id, title, version, compatibility, esmodules: ["install.mjs"]
content/*.json       # documents as plain data, built in the browser
install.mjs          # creates the packs and populates them via Foundry's own APIs
assets/              # images and audio pulled from the deploy
```

On first launch the bootstrapper creates the compendium(s) and bulk-creates the folders and documents. Foundry writes its own LevelDB, which is the whole point.

**Deferring to install time also solves versioning, which is the reason to prefer this shape.** Everything version-sensitive happens inside the target Foundry:

- `foundry.base: Compendium.dnd5e.monsters.Actor.…` needs `fromUuid()` and an installed dnd5e. The browser cannot resolve it; the bootstrapper can, and that is where it belongs.
- Document schema shape is decided by the running version rather than baked into the artifact.
- v13 vs v14 branching is a runtime `if`, not a build matrix.

Shape of the authoring surface, if it stays a handler:

````
```foundry-module
id: mossfoot
name: Mossfoot Campaign
system: dnd5e
include: ["NPCs/**", "Lore/**"]
packs:
  - { folder: NPCs, label: Mossfoot NPCs, type: Actor }
```
````

Click flow: read `_manifest.json` for the current variant, `POST /_batch` for page bodies and `/_batch-images` for assets, transform to document data in the browser, zip (store-only, no dependency needed), hand it over with a blob download.

**Honest problems:**

- **Asset size.** Zipping a few hundred MB of maps in a tab will not work. Either stream to disk via the File System Access API where available, or offer an assets-excluded mode where `install.mjs` fetches from the deploy at install time using a `?_token=` bearer.
- **A fourth mapping implementation.** This makes the consolidation above mandatory rather than nice-to-have. The upside: a browser-side mapper must be pure data-in/data-out with no Foundry globals and no Node, which is exactly the shape the shared package needs anyway. Build the shared package for this and the other three fall out.
- **Handler may be the wrong shape.** Handlers are per-page render transforms; a module builder is a site-wide capability. A settings toggle that adds a sidebar entry is probably more correct, with the fenced block reserved for "download just this section."
- **Trust.** The zip carries an esmodule that runs in the installer's world. Same trust as any module install, but the two-layer consent model already used for handler assets in Foundry is the precedent to follow.

**Cheaper alternative worth weighing first.** Build the module at `vaults push` time instead. The CLI already has every page, already runs the Node LevelDB tooling, and already knows the variants. Emit one zip per role variant, serve `/_foundry/module.json` and `/_foundry/module.zip` through the existing gate, and let people install by pasting a manifest URL. Because `readRole()` honors `?_token=`, Foundry's own server-side manifest fetch authenticates correctly with `https://vault.example.com/_foundry/module.json?_token=…`, and the token comes from the `/connect` flow that already exists for the sync module.

That gets most of the benefit with no browser zip, no memory ceiling, no fourth mapper, and reuse of vfmc. The browser builder is the better answer only if the goal is specifically that a *visitor* can take content away without the vault owner pre-baking a variant for them. Decide which of those two we actually want before building either.

## Smaller open items

- `vaults preview` renders pages that contain only base code as raw base code rather than the rendered view.
- No Foundry-side test harness. The CLI tests run end-to-end through `buildSite` against a tmpdir vault, but `instance.mjs`, `links.mjs`, `media.mjs`, and `ids.mjs` are unreachable from there, so every Foundry-side fix has shipped without a regression test. The pure helpers (`subdocId`, `ensureEmbeddedIds`, `isCacheable`, the regex predicates) are straightforward `node --test` fodder; the parts touching Foundry globals (`Document.create`, `FilePicker`, `game.scenes`) need a mock layer.
- No `sitemap.xml` or `robots.txt`. Irrelevant for private campaign vaults, but the course and research sites want to be indexed.
