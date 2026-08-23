// Vault registry. Wraps the `vaults` setting (array of entries) with a
// small CRUD API.

import { SETTINGS, VAULT_DEFAULTS, get, set } from "./settings.mjs";
import { removeVaultManifest } from "./vault-manifests.mjs";
import { hexDigest } from "./util.mjs";

/** All registered vaults (a copy; mutate via update/remove). */
export function listVaults() {
  return [...(get(SETTINGS.vaults) || [])];
}

export function getVault(id) {
  return listVaults().find((v) => v.id === id) || null;
}

/** Create a new vault entry from `partial` and persist. Returns the entry. */
export async function addVault(partial) {
  const list = listVaults();
  const entry = {
    ...VAULT_DEFAULTS,
    ...partial,
    id: partial.id || await newVaultId(partial.url || ""),
    label: partial.label || deriveLabel(partial.url || ""),
    rootFolder: partial.rootFolder || deriveLabel(partial.url || ""),
  };
  list.push(entry);
  await set(SETTINGS.vaults, list);
  return entry;
}

/** Patch a vault by id and persist. Throws if no such vault. */
export async function updateVault(id, patch) {
  const list = listVaults();
  const idx = list.findIndex((v) => v.id === id);
  if (idx < 0) throw new Error(`Vault not found: ${id}`);
  list[idx] = { ...list[idx], ...patch };
  await set(SETTINGS.vaults, list);
  return list[idx];
}

/** Remove a vault entry by id. Caller is responsible for cleanup of journals/images.
 *  The per-vault sync state in vaultManifests is dropped here so the world
 *  doesn't accumulate orphan manifest entries after repeated add/remove cycles. */
export async function removeVault(id) {
  const list = listVaults().filter((v) => v.id !== id);
  await set(SETTINGS.vaults, list);
  await removeVaultManifest(id);
}

/** Pretty label derived from a URL host. */
function deriveLabel(url) {
  if (!url) return "Vault";
  try { return new URL(url).host.split(".")[0] || "Vault"; }
  catch { return "Vault"; }
}

/**
 * A vault's id, which is also the name of its cache directory under
 * `worlds/<world>/vaults-cache/`.
 *
 * Derived from the URL rather than random, for two reasons. Re-registering a
 * vault used to mint a fresh id and strand its entire cache — tens or hundreds
 * of megabytes at a path nothing referenced again, and unreachable, since
 * Foundry exposes no way to delete files. Deriving it means the same vault
 * lands on the same directory and reuses what is already downloaded.
 *
 * The label is carried in the id for the same reason a directory listing
 * should be readable: `seylon-wiki-71c13dcb` says which vault it belongs to
 * where twelve hex characters said nothing, and working out which of two
 * caches was safe to delete meant walking both over WebDAV.
 *
 * Existing vaults keep whatever id they were given — it is stored, and it also
 * appears in journal flags, so recomputing one would orphan both its cache and
 * its journals.
 */
async function newVaultId(url) {
  if (!url) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // 8 hex of SHA-256 over the URL: stable, and still short enough to sit in
  // file paths and journal-flag values without bloat.
  const digest = (await hexDigest("SHA-256", url)).slice(0, 8);
  const slug = deriveLabel(url).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `${slug}-${digest}` : digest;
}
