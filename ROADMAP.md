# Roadmap

Where vaults goes next, and the reasoning behind each call so future-you does not re-derive it. Nothing here is committed to. Ordered roughly by how much each blocks the rest.

## Recently landed

Sync writes into compendium packs rather than world documents, so it never touches what someone is running a game with and can always overwrite its own output. A vault picks its shape with `foundry.package`: `adventure` compiles to one Adventure document whose links are world UUIDs, so importing it makes every reference resolve to the imported copy; `compendium` produces browsable packs whose links name those packs; `none` ships no integration at all. Both shapes are written through one target interface, and `vaults build --module` compiles whichever the vault asked for, so a synced vault and an installed module agree.

vfmc is gone. `vaults build --module` replaced it, sharing the renderer, the id scheme and the reading of `foundry.base`, and closing all eight gaps recorded against it. Parity was checked first: 699 of 699 WANDS documents byte-identical.

`foundry.player_role` replaced the module's `dmRole` and reads forwards. It names the highest role players may read, inclusive, and lives in the vault because which pages are player-facing is a fact about the content rather than a preference of whoever synced it. `default_role` folded into `default_frontmatter`. Handler assets import by default, gated by a per-session prompt before any script runs instead of a checkbox nobody found.

Two leaks closed. `/_batch` served the caller's variant while ownership came from the page's role, so players received DM renderings of public pages. Vault packs were readable by every player, because an unconfigured world pack defaults to `PLAYER: OBSERVER` and a compendium index is not filtered per document.

Requires Foundry v14, whose Import All preserves document ownership.

## 1. A changed `foundry.base` is silently ignored

Repointing a page's `base` at a different scene does nothing, and neither a normal sync nor a Force Sync says so. The document has to be deleted by hand first.

`applyInstance` only consults `base` on the create path. That is deliberate, since re-cloning would discard walls, tokens and lighting a GM added, and would fire the moment they installed a module outranking the current rung. But the line sits inconsistently: `forceFull` already reasserts vault authority over folder placement, so it reasserts where a document lives but not what it is.

Proposed: stamp the authored spec list as `flags.vaults.baseSpec` on create, a string compare rather than a comparison of resolved sources (resolving every sync means a scene download to learn nothing changed); warn on a normal sync when it differs; rebuild on Force Sync behind a confirm naming what is lost. Still do not re-clone because a higher-priority package appeared, since the author asked for nothing and nothing should change under the GM.

## 2. Customising the journal side of a page

Today a page becomes a `text` JournalEntryPage and that is the whole story. `foundry.journal` is a boolean that says whether to make one at all. Foundry has more to offer: `title.show` and `title.level`, `category`, and page *types*.

**The types are mostly not core.** Foundry v14 ships four (`text`, `image`, `pdf`, `video`); dnd5e adds five (`class`, `map`, `rule`, `spells`, `subclass`). So the interesting ones, a Map Location page with clickable notes and a Spell List, are system-provided and only exist in a dnd5e world. That is the same availability problem `foundry.base` priority lists solve, and it probably wants the same answer rather than a new one.

The natural shape is the idiom the vault already uses. `foundry.data` deep-merges into the instantiated document, so `foundry.journal` becomes an overlay onto the JournalEntryPage, with `false` still meaning "do not make one":

```yaml
foundry:
  journal:
    type: spells
    title: { show: false }
    system: { type: class, grouping: level }
```

Open questions, in the order they bite:

- **Where does the page body go for a non-text type?** A `text` page puts the rendered HTML in `text.content`. An `image`, `video` or `pdf` page's content *is* its `src`, and the prose has nowhere to live. Either the markdown becomes a caption, or declaring such a type means the article is dropped and the author should be told so.
- **What happens in a world without the type?** A vault declaring `type: map` in a non-dnd5e world produces a page Foundry cannot construct. Degrading to `text` is probably right, with a warning, and matches how a `foundry.base` rung degrades.
- **How much of this belongs in `default_frontmatter`?** Setting `type: rule` on a whole `Rules/**` folder is one rule; setting it per page is thirty.
- **The compiler has to agree.** `vaults build --module` writes the same pages, so whatever shape this takes has to compile as well as sync, or the two diverge again.

## 3. Separating vaults from Foundry

Vaults is increasingly used for things with nothing to do with TTRPGs, and those deploys should not carry a Foundry payload. `foundry.package: none` handles the deploy side already.

What remains is the built-ins: `statblock`, `battlemap` and `dice` are hardcoded rather than bundled-but-disableable handlers. **Do not build a plugin system for this.** The handler registry already is one, with user-authored handlers, browser JS and CSS, and Foundry opt-in. A general plugin API earns its keep when a third party wants to write one, and today the third party is us.

## 4. Decoupling roles from passwords

`vaults role add` prompts for a password, so a site authenticating only through OIDC or Patreon still renders a password form and a role picker it does not want. Stop conflating the two: **roles say what content is tagged, authenticators say how a visitor proves one.** Per-role password hashes become one optional authenticator beside `oidc` and `patreon`, and the login page renders only the methods a deploy actually has.

**Keep the total order.** Roles are a ladder, and that is what makes "higher tiers see lower content" free. A set model needs one variant per reachable role combination, which explodes. Decouple authentication only.

## 5. Obsidian plugin

Straightforward, and real quality of life: plugins have Node access, so a ribbon button for build/preview/push and a settings pane for roles is small work.

Be honest that it does not touch the barrier that actually stops people. Needing a Cloudflare account, an API token and wrangler is a hosting problem. Removing it means the managed platform, and a plugin that publishes to *that* is the real product. Sequence it that way.

## 6. Composing an adventure from other creators' content

Publish an adventure using someone else's maps, scenes and ambience where **the vault contains none of it**. Each reader gets what their own subscriptions entitle them to, and licensing stays between them and the creator. Ship a pointer and a diff, never a pixel.

Most of this works. Creators ship real Foundry modules with compendium packs, so their content is addressable by ordinary UUID, and the `foundry.base` priority list is the "use it if the reader owns it" mechanism. `@moulinette/<pack_ref>/<filepath>` covers assets and documents from a reader's own Moulinette library.

Known about that integration:

- **Composing a scene from Moulinette assets beats cloning a Moulinette document.** An asset rung is a file path and survives re-exports; a document rung carries a whole scene built for one Foundry generation.
- **Prefer a compendium rung above a Moulinette rung.** Foundry migrates compendium packs on load, which is exactly the step a raw import skips.
- **Re-releases fragment a pack across `pack_ref`s**, so a reference can go stale even though the reader still owns the content.
- **Moulinette is on borrowed time against v15.** Its `file-manager.ts` reaches for the global `FilePicker`, deprecated in v13 and slated for removal. Not ours to fix, but it dates this integration, and a documented `resolveAsset(creator, pack, file)` would remove the last internal dependency. Worth asking them rather than reverse engineering a minified bundle forever.

## 7. One Foundry generation per vault

Not built, and not needed while v14 is the only target, but the decision is made: supporting several means deploying a separate copy of the vault per generation, not branching inside pages.

This separates two things the Moulinette work conflated. A `foundry.base` priority list is for **content availability**, meaning does this reader own that pack. We also used it for **version compatibility**, and those are independent axes, so every rung became a guess about two variables and the combinations multiply past what anyone can test. Declared instead, probably as a setting, it gives one honest answer up front, and the generation-skew warning gets a better question to ask: does this pack match what the vault was built for, rather than does it match this world.

## 8. Consolidate the Foundry mapping

Much of the original motivation was vfmc duplicating id derivation and wikilink rewriting with different hash seeds. That is gone with vfmc, and `PACK_KEY` and the target interface are shared now.

What remains is that roughly 900 lines of `foundry/scripts/` touch no Foundry global: `sync.mjs`, `links.mjs`, `api.mjs`, `ids.mjs`, `util.mjs`. The target shape is a pure planner emitting document intents with a per-environment executor. Worth doing when something needs it, not for its own sake. Blockers if revisited: `links.mjs` uses DOM and needs a shim in Node, and any change to the id scheme forces a `forceFull` re-sync and orphans documents in existing worlds.

## 9. Vaults as decentralised distribution

Vaults already has most of what a content marketplace sells: entitlement checking, per-user access, a client that pulls content into Foundry, auth for that client, and multiple creators in one world. Structurally it is *better* for entitlement than a client-side gate, because a non-subscriber is not filtered by a module they could patch. The premium files are simply not in the variant the server returns.

Missing: **cross-vault addressing** (the hard part is identity, since vault ids derive from the URL and a creator changing domains breaks every reference, so settle a stable creator id early), **dependency declaration**, and **a catalogue**. The catalogue is the real gap and it is not technical. Search across creators is Moulinette's actual product, and building an index recentralises exactly the part that matters.

So: aim to be the publishing substrate something else indexes over, rather than the storefront.

## Smaller open items

- `compendiumSource` is create-only, so existing documents never gain the provenance trail. Decide whether heal-on-update is wanted.
- `vaults preview` renders pages containing only base code as raw base code rather than the rendered view.
- Foundry-side coverage is partial. The pure helpers are tested, but anything touching Foundry globals (`Document.create`, `FilePicker`, `game.scenes`) needs a mock layer, so `instance.mjs`'s create and update paths and `media.mjs` are verified only against a live world.
- Cloudflare Pages caps a deploy at 20,000 files. Fine for a rules vault, a real constraint for an asset library.
