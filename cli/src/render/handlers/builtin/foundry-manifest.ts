// Built-in `foundry-manifest` code-block handler.
//
//   ```foundry-manifest
//   manifest: downloads/module.json
//   label: Marlo Download Test
//   note: v0.0.1
//   ```
//
// Renders an install link for a Foundry VTT module hosted in this vault.
// Split from `download` because the two only look alike. A download hands a
// file to a person through their browser, which already carries their session
// cookie. This hands a URL to a *machine*: Foundry's installer runs on the
// Foundry server, sees no cookie, and has nowhere to put a header — so the URL
// has to authenticate on its own, which is what /_link mints.
//
// The block names only the manifest. The zip is whatever the manifest's own
// `download` field says, so the build reads it, stages it, and checks that the
// field is relative — an absolute URL cannot be signed when the vault is
// reached over a different hostname than the one it names.

import type { CodeBlockHandler, HandlerContext } from "../types.js";
import { registerBuiltinAssets } from "../assets.js";

const MANIFEST_BLOCK_RE = /^```foundry-manifest[^\n]*\n([\s\S]*?)^```/gm;

export interface ManifestSpec {
  manifest: string;
  label: string;
  note: string;
}

export function parseManifestBlock(content: string): ManifestSpec | null {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep === -1) continue;
    out[trimmed.slice(0, sep).trim().toLowerCase()] = trimmed.slice(sep + 1).trim();
  }
  const manifest = (out["manifest"] ?? "").replace(/^\/+/, "");
  if (!manifest) return null;
  return { manifest, label: out["label"] ?? "Install in Foundry VTT", note: out["note"] ?? "" };
}

/** Manifest paths named by a page's ```foundry-manifest blocks. */
export function foundryManifestPaths(source: string): string[] {
  const paths: string[] = [];
  for (const block of source.matchAll(MANIFEST_BLOCK_RE)) {
    const spec = parseManifestBlock(block[1] ?? "");
    if (spec) paths.push(spec.manifest);
  }
  return paths;
}

/**
 * The vault path a manifest's `download` field points at, or null when it is
 * absent or absolute.
 *
 * Absolute is not merely discouraged: the middleware signs a download URL only
 * when it resolves onto the host the request arrived on, and it cannot tell
 * this vault's second hostname from anyone else's. So an absolute URL goes
 * unsigned and the install fails on its second fetch.
 */
export function manifestDownloadPath(
  manifestJson: string, siteUrl = "",
): { path: string | null; absolute: string | null } {
  try {
    const parsed = JSON.parse(manifestJson) as { download?: unknown };
    if (typeof parsed.download !== "string" || !parsed.download) return { path: null, absolute: null };
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(parsed.download)) {
      // The vault's own URL is not a foreign one. A public vault has to write
      // absolute URLs — Foundry's installer fetches `download` with no base to
      // resolve against — so the file it names is still a file this build has
      // to stage, and only a URL pointing somewhere else is a problem.
      const base = siteUrl.replace(/\/+$/, "");
      if (base && parsed.download.startsWith(base + "/")) {
        return { path: parsed.download.slice(base.length + 1), absolute: null };
      }
      return { path: null, absolute: parsed.download };
    }
    return { path: parsed.download.replace(/^\/+/, ""), absolute: null };
  } catch {
    return { path: null, absolute: null };
  }
}

function servedHref(path: string): string {
  return "/" + path.split("/").map(encodeURIComponent).join("/");
}

export const foundryManifestHandler: CodeBlockHandler = {
  codeBlock: "foundry-manifest",
  render(content: string, ctx: HandlerContext): { html: string } {
    const spec = parseManifestBlock(content);
    if (!spec) {
      return { html: '<div class="vaults-download-error">foundry-manifest: needs a <code>manifest:</code> line</div>' };
    }
    const esc = ctx.escape;
    // A single-role vault ships no middleware, so there is no /_link to mint
    // through — and nothing to mint, since the manifest is public. The button
    // copies the plain URL, which is also the better link: it does not expire,
    // so Foundry can check for updates through it. Defaults to gated, the
    // assumption that fails safely.
    const gated = ctx.render?.gated !== false;
    const href = servedHref(spec.manifest);
    return {
      html: [
        `<div class="vaults-download vaults-foundry-manifest">`,
        `<span class="vaults-download-label">${esc(spec.label)}</span>`,
        spec.note ? `<span class="vaults-download-note">${esc(spec.note)}</span>` : "",
        // Gated links are minted per click: short-lived by design, so one baked
        // in at build time would be dead before anyone read the page.
        `<button class="vaults-download-manifest" type="button"`,
        gated ? "" : ` data-direct="1"`,
        ` data-manifest="${esc(href)}">Copy install link</button>`,
        `<p class="vaults-download-hint">Paste into Foundry's <em>Install Module</em> dialog.</p>`,
        `</div>`,
      ].join(""),
    };
  },
};

const MANIFEST_STYLES = `
.vaults-foundry-manifest { display: flex; flex-direction: column; gap: .15rem; }
.vaults-download-manifest { font: inherit; font-size: .85rem; margin-top: .7rem; align-self: flex-start; padding: .35rem .8rem; border: 1px solid var(--rule, #ccc); border-radius: 4px; background: var(--bg, #fff); color: var(--fg, #222); cursor: pointer; }
.vaults-download-manifest:hover { border-color: var(--accent, #333); }
.vaults-download-hint { font-size: .8rem; color: var(--fg-muted, #666); margin: .5rem 0 0; }
`;

// Puts an install URL on the clipboard.
//
// On a gated vault that means asking the deploy to mint a short-lived one, per
// click, because it expires: a URL baked in at build time would be dead long
// before anyone pressed the button. On a public vault there is no middleware
// to ask and nothing to authenticate, so the plain URL is copied as-is.
const MANIFEST_RUNTIME = `
(function () {
  document.addEventListener("click", async function (e) {
    var btn = e.target.closest(".vaults-download-manifest");
    if (!btn) return;
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      if (btn.dataset.direct) {
        // Public vault: no middleware to ask, and nothing to authenticate.
        await navigator.clipboard.writeText(new URL(btn.dataset.manifest, location.href).href);
        btn.textContent = "Copied";
      } else {
        var res = await fetch("/_link?path=" + encodeURIComponent(btn.dataset.manifest), { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        var data = await res.json();
        await navigator.clipboard.writeText(data.url);
        btn.textContent = "Copied — expires in " + data.expiresInMinutes + " min";
      }
    } catch (err) {
      btn.textContent = "Couldn't generate a link";
    } finally {
      btn.disabled = false;
      setTimeout(function () { btn.textContent = original; }, 6000);
    }
  });
})();
`;

registerBuiltinAssets(foundryManifestHandler, {
  scripts: [{ source: "builtin/foundry-manifest.runtime.js", content: MANIFEST_RUNTIME }],
  styles: [{ source: "builtin/foundry-manifest.css", content: MANIFEST_STYLES }],
});
