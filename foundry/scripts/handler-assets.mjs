// Per-vault handler-asset import. Two-layer consent: a handler author opts
// its assets into Foundry import via assets.targets.foundry.{styles,scripts} on the
// CLI side; a handler author opts each asset in, and scripts prompt in the
// per-vault settings dialog. This module fetches and injects only when both
// gates allow it.
//
// CSS lands as a <style> in <head>, scoped by `data-vault-id` so disabling
// or removing a vault can clean up exactly its rules. JS lands as a
// <script> with the same data-attribute; scripts execute on insertion (per
// HTML5 spec — element-created <script> tags don't execute, but we use
// document.createElement + body.appendChild which does fire). Re-syncing
// replaces the previous element of the same data-id, so an updated handler
// bundle takes effect without world reload.
//
// Removal: when the GM disables a toggle (or the vault is deleted), drop
// the corresponding data-attributed element. JS removal stops *future*
// script executions; anything the previous script already attached
// (event handlers, hooks) keeps running until reload. The settings-dialog
// hint flags this; we don't try to be clever about JS un-injection.
//
// Two-tier consent UX:
//   - Silent applyHandlerAssets() injects whatever the persistent toggles
//     say. Used from world ready and from settings-save (the GM's already
//     consented persistently; reload doesn't need to re-prompt).
//   - applyHandlerAssetsWithConfirm() pops a per-session prompt before
//     injecting JS. Used only from sync, so a vault that ships new code
//     between syncs gets fresh acknowledgement before it runs. The
//     per-session approval cache means back-to-back syncs in the same
//     session don't nag.
// CSS injection skips the prompt in both paths (low risk).

import { fetchTextOrNull } from "./api.mjs";
import { escapeHtml as escapeText } from "./util.mjs";

const STYLE_ATTR = "data-vault-handler-styles";
const SCRIPT_ATTR = "data-vault-handler-scripts";

/**
 * Per-session approval cache for handler-script injection. Keyed by vault
 * id; cleared on world reload.
 */
const sessionApprovedScripts = new Set();

/**
 * Inject handler assets for a vault without prompting.
 *
 * A vault's handler assets are part of the vault. They were behind two
 * per-vault checkboxes, defaulting off, and that was the wrong shape: a
 * handler's CSS is what makes its output look like anything, so a vault whose
 * author shipped assets rendered wrongly until a GM found a setting they had
 * no reason to look for. Almost every "off" was an accident rather than a
 * decision.
 *
 * What remains is the gate that matters. A handler author still has to opt in
 * per asset (`assets.targets.foundry.{styles,scripts}`), and scripts still
 * prompt once per session before running — that is the real consent, asked at
 * the moment the code would run, naming the vault it came from.
 */
export async function applyHandlerAssets(vault) {
  if (!vault?.id || !vault?.url) return;
  // Only fetch the bundles the manifest actually advertises. A vault that
  // ships no Foundry-opted handler scripts has no `_handlers.foundry.js`;
  // probing a hardcoded default just 404s (harmlessly, but noisily).
  const cssPath = vault.handlerAssetPaths?.foundryCss;
  const jsPath = vault.handlerAssetPaths?.foundryJs;

  if (cssPath) {
    const css = await fetchTextOrNull(vault, cssPath);
    injectStyle(vault.id, css);
  } else {
    removeStyle(vault.id);
  }
  if (jsPath) {
    const js = await fetchTextOrNull(vault, jsPath);
    injectScript(vault.id, js);
    // A silent inject still primes the per-session cache — if a sync
    // re-fires shortly after with the same content, no need to prompt.
    if (js) sessionApprovedScripts.add(vault.id);
  } else {
    removeScript(vault.id);
  }
}

/**
 * Sync-time variant: same as applyHandlerAssets, but pops a per-session
 * confirmation dialog before injecting JS the first time per session.
 * The persistent toggle stays "yes, I want this enabled"; this dialog
 * adds "and yes, run this specific bundle of code right now."
 *
 * @param vault   the vault to apply assets for
 * @param opts.reason  short identifier for the prompt context, surfaced
 *                     in the dialog so the GM knows why they're being asked.
 */
export async function applyHandlerAssetsWithConfirm(vault, opts = {}) {
  if (!vault?.id || !vault?.url) return;
  // Only fetch advertised bundles (see applyHandlerAssets) — no probing a
  // hardcoded default the deploy never built.
  const cssPath = vault.handlerAssetPaths?.foundryCss;
  const jsPath = vault.handlerAssetPaths?.foundryJs;

  // CSS: no prompt. At worst it restyles a journal sheet.
  if (cssPath) {
    const css = await fetchTextOrNull(vault, cssPath);
    injectStyle(vault.id, css);
  } else {
    removeStyle(vault.id);
  }

  // JS: prompt unless already approved this session. This is the consent that
  // matters — asked when the code would run, naming the vault it came from.
  if (jsPath) {
    const js = await fetchTextOrNull(vault, jsPath);
    if (!js) {
      removeScript(vault.id);
      return;
    }
    if (sessionApprovedScripts.has(vault.id)) {
      injectScript(vault.id, js);
      return;
    }
    const ok = await confirmScriptInjection(vault, opts.reason || "import", js);
    if (ok) {
      sessionApprovedScripts.add(vault.id);
      injectScript(vault.id, js);
    } else {
      removeScript(vault.id);
    }
  } else {
    removeScript(vault.id);
  }
}

async function confirmScriptInjection(vault, reason, js) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) {
    // Foundry too old; fall back to a notification + skip rather than
    // silently injecting without the per-session re-confirm.
    ui.notifications?.warn(
      `Vaults | "${vault.label}" wants to inject handler scripts but DialogV2 is unavailable; skipping.`,
    );
    return false;
  }
  const sizeKb = Math.max(1, Math.round((js?.length ?? 0) / 1024));
  const reasonLabel = reason === "ready" ? game.i18n.localize("VAULTS.HandlerAssets.ReasonReady")
    : reason === "sync"  ? game.i18n.localize("VAULTS.HandlerAssets.ReasonSync")
    : reason === "settings" ? game.i18n.localize("VAULTS.HandlerAssets.ReasonSettings")
    : game.i18n.localize("VAULTS.HandlerAssets.ReasonImport");
  const body = `
    <p>${escapeText(game.i18n.format("VAULTS.HandlerAssets.SessionPromptIntro", {
      name: vault.label, size: String(sizeKb), reason: reasonLabel,
    }))}</p>
    <p><strong>${escapeText(game.i18n.localize("VAULTS.HandlerAssets.SessionPromptWarn"))}</strong></p>
    <p class="notes">${escapeText(game.i18n.localize("VAULTS.HandlerAssets.SessionPromptDecline"))}</p>`;
  return DialogV2.confirm({
    window: { title: game.i18n.localize("VAULTS.HandlerAssets.SessionPromptTitle") },
    content: body,
    yes: { label: game.i18n.localize("VAULTS.HandlerAssets.SessionPromptAccept") },
    no:  { label: game.i18n.localize("VAULTS.HandlerAssets.SessionPromptCancel") },
  });
}

/** Idempotent: repeated calls with the same vault.id replace the element. */
export function removeHandlerAssets(vaultId) {
  removeStyle(vaultId);
  removeScript(vaultId);
}

function injectStyle(vaultId, css) {
  removeStyle(vaultId);
  if (!css) return;
  const el = document.createElement("style");
  el.setAttribute(STYLE_ATTR, vaultId);
  el.textContent = css;
  document.head.appendChild(el);
}

function removeStyle(vaultId) {
  const el = document.head.querySelector(`style[${STYLE_ATTR}="${cssEscape(vaultId)}"]`);
  if (el) el.remove();
}

function injectScript(vaultId, js) {
  removeScript(vaultId);
  if (!js) return;
  const el = document.createElement("script");
  el.setAttribute(SCRIPT_ATTR, vaultId);
  el.textContent = js;
  // Append to body, not head, so the script runs after Foundry's own
  // bootstrap chain has settled.
  document.body.appendChild(el);
}

function removeScript(vaultId) {
  const el = document.body.querySelector(`script[${SCRIPT_ATTR}="${cssEscape(vaultId)}"]`);
  if (el) el.remove();
}

/** Minimal CSS.escape polyfill for the vault-id attribute selector. */
function cssEscape(s) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\\n\r]/g, "\\$&");
}
