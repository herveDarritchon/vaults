import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, type OidcConfig } from "../config.js";
import { readDotEnv } from "../dotenv.js";
import { runMigrations } from "../migrate/run.js";
import type { OidcRoleRule } from "../render/oidc-match.js";

// `vaults preview` serves on this port, so a single registered redirect URI
// covers local login testing. (Unlike Patreon there is no CLI-side OAuth
// dance; the URI below is only ever hit by a browser during preview.)
const PREVIEW_REDIRECT_URI = "http://localhost:4173/auth/oidc/callback";

interface DiscoveryDoc {
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

/**
 * `vaults oidc configure` — point the vault at any standards-compliant OIDC
 * issuer. Endpoints are resolved from the issuer's discovery document here,
 * at configure time, and baked into config so the deployed middleware never
 * fetches discovery. Role access is granted by per-role email/domain rules.
 */
export async function oidcConfigure(vaultPath: string): Promise<void> {
  await runMigrations(vaultPath);
  const cfg = await loadConfig(vaultPath, {});
  const existing = cfg.oauth?.oidc;
  const dotEnv = await readDotEnv(vaultPath);

  if (!stdin.isTTY) {
    throw new Error("vaults oidc configure must be run interactively (need to prompt for issuer/credentials).");
  }

  console.log("OIDC sign-in setup");
  console.log("=".repeat(50));
  console.log("");
  console.log("Register an OAuth client with your identity provider and add these");
  console.log("redirect URIs:");
  console.log("  1. Your deploy URL + /auth/oidc/callback");
  console.log("     e.g.  https://your-vault.pages.dev/auth/oidc/callback");
  console.log(`  2. ${PREVIEW_REDIRECT_URI}   (for \`vaults preview\` testing)`);
  console.log("");
  if (existing) {
    console.log("Updating existing OIDC configuration. Press Enter to keep current values.");
    console.log("");
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const issuer = ((await rl.question(
      `Issuer URL${existing ? ` [${existing.issuer}]` : " (e.g. https://accounts.google.com)"}: `,
    )).trim() || existing?.issuer || "").replace(/\/+$/, "");
    if (!issuer) throw new Error("Issuer URL is required.");

    let endpoints = await discoverEndpoints(issuer);
    if (endpoints) {
      console.log("  Discovery OK:");
      console.log(`    authorize: ${endpoints.authorizationEndpoint}`);
      console.log(`    token:     ${endpoints.tokenEndpoint}`);
      console.log(`    userinfo:  ${endpoints.userinfoEndpoint}`);
      if (endpoints.scopesSupported && !endpoints.scopesSupported.includes("email")) {
        console.log("  WARNING: discovery doesn't list the 'email' scope; sign-in may fail to return an email.");
      }
      if (endpoints.pkceMethods && !endpoints.pkceMethods.includes("S256")) {
        console.log("  WARNING: discovery doesn't list PKCE S256; most servers ignore the extra params, but sign-in may fail on strict ones.");
      }
    } else {
      console.log(`  Couldn't fetch ${issuer}/.well-known/openid-configuration — enter endpoints manually.`);
      const authorizationEndpoint = (await rl.question(
        `  Authorization endpoint${existing ? ` [${existing.authorizationEndpoint}]` : ""}: `,
      )).trim() || existing?.authorizationEndpoint || "";
      const tokenEndpoint = (await rl.question(
        `  Token endpoint${existing ? ` [${existing.tokenEndpoint}]` : ""}: `,
      )).trim() || existing?.tokenEndpoint || "";
      const userinfoEndpoint = (await rl.question(
        `  Userinfo endpoint${existing ? ` [${existing.userinfoEndpoint}]` : ""}: `,
      )).trim() || existing?.userinfoEndpoint || "";
      if (!authorizationEndpoint || !tokenEndpoint || !userinfoEndpoint) {
        throw new Error("All three endpoints are required when discovery is unavailable.");
      }
      endpoints = { authorizationEndpoint, tokenEndpoint, userinfoEndpoint };
    }

    const defaultDisplay = existing?.displayName || new URL(issuer).host;
    const displayName = (await rl.question(
      `Display name for the login button [${defaultDisplay}]: `,
    )).trim() || defaultDisplay;

    // Prompt defaults come from config, then the vault's .env — the user may
    // have dropped OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET there already.
    const defaultClientId = existing?.clientId || dotEnv["OAUTH_CLIENT_ID"] || "";
    const clientId = (await rl.question(
      `Client ID${defaultClientId ? ` [${maskMid(defaultClientId)}]` : ""}: `,
    )).trim() || defaultClientId;
    if (!clientId) throw new Error("Client ID is required.");

    const defaultSecret = existing?.clientSecret || dotEnv["OAUTH_CLIENT_SECRET"] || "";
    const clientSecret = (await rl.question(
      `Client secret${defaultSecret ? " [keep existing]" : ""}: `,
    )).trim() || defaultSecret;
    if (!clientSecret) throw new Error("Client secret is required.");

    // Per-role access rules. Entries are comma-separated; anything with an
    // '@' past position 0 is an email, everything else ('@lmu.edu' or
    // 'lmu.edu') is a domain. Matching is exact: subdomains are not implied.
    const protectedRoles = cfg.roles.slice(1);
    const newRules: Record<string, OidcRoleRule> = { ...(existing?.roleRules ?? {}) };
    if (protectedRoles.length > 0) {
      console.log("");
      console.log("Grant roles by email and/or domain (comma-separated, e.g.");
      console.log("'dean@lmu.edu, lion.lmu.edu'). Enter keeps the current rule, 'none'");
      console.log("clears it (password-only). Exact matches only; list subdomains explicitly.");
      for (const role of protectedRoles) {
        const current = newRules[role];
        const currentDesc = current ? describeRule(current) : "";
        const ans = (await rl.question(
          `  ${role}${currentDesc ? ` [${currentDesc}]` : " (Enter to skip)"}: `,
        )).trim();
        if (ans === "" && current) continue;
        if (ans === "" || ans.toLowerCase() === "none") { delete newRules[role]; continue; }
        const rule = parseRule(ans);
        if (!rule) { console.log("    (skipped — no valid entries)"); continue; }
        newRules[role] = rule;
      }
    }

    const oidc: OidcConfig = {
      issuer,
      displayName,
      clientId,
      clientSecret,
      ...endpoints,
      ...(Object.keys(newRules).length > 0 ? { roleRules: newRules } : {}),
    };
    cfg.oauth = { ...(cfg.oauth ?? {}), oidc };
    await saveConfig(vaultPath, cfg);

    console.log("");
    console.log("Saved OIDC configuration.");
    if (Object.keys(newRules).length > 0) {
      console.log("Role rules:");
      for (const [role, rule] of Object.entries(newRules)) {
        console.log(`  ${role.padEnd(16)} → ${describeRule(rule)}`);
      }
    } else {
      console.log("No role rules yet — the sign-in button won't be offered until a role has one.");
    }
    console.log("Run `vaults push` to upload the client secret to Cloudflare.");
  } finally {
    rl.close();
  }
}

async function discoverEndpoints(issuer: string): Promise<{
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  scopesSupported?: string[];
  pkceMethods?: string[];
} | null> {
  try {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const doc = await res.json() as DiscoveryDoc;
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) return null;
    return {
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      userinfoEndpoint: doc.userinfo_endpoint,
      ...(doc.scopes_supported ? { scopesSupported: doc.scopes_supported } : {}),
      ...(doc.code_challenge_methods_supported ? { pkceMethods: doc.code_challenge_methods_supported } : {}),
    };
  } catch {
    return null;
  }
}

/** "a@b.com, lmu.edu, @x.org" → { emails: ["a@b.com"], domains: ["lmu.edu", "x.org"] } */
function parseRule(input: string): OidcRoleRule | null {
  const emails: string[] = [];
  const domains: string[] = [];
  for (const raw of input.split(",")) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry.startsWith("@")) domains.push(entry.slice(1));
    else if (entry.includes("@")) emails.push(entry);
    else domains.push(entry);
  }
  if (emails.length === 0 && domains.length === 0) return null;
  return {
    ...(emails.length > 0 ? { emails } : {}),
    ...(domains.length > 0 ? { domains } : {}),
  };
}

function describeRule(rule: OidcRoleRule): string {
  return [...(rule.emails ?? []), ...(rule.domains ?? []).map((d) => "@" + d)].join(", ");
}

export async function oidcStatus(vaultPath: string): Promise<void> {
  await runMigrations(vaultPath);
  const cfg = await loadConfig(vaultPath, {});
  const oidc = cfg.oauth?.oidc;
  if (!oidc) {
    console.log("OIDC: not configured. Run `vaults oidc configure` to enable.");
    return;
  }
  console.log("OIDC: configured");
  console.log(`  issuer:       ${oidc.issuer}`);
  console.log(`  display name: ${oidc.displayName}`);
  console.log(`  client ID:    ${maskMid(oidc.clientId)}`);
  console.log(`  authorize:    ${oidc.authorizationEndpoint}`);
  console.log(`  token:        ${oidc.tokenEndpoint}`);
  console.log(`  userinfo:     ${oidc.userinfoEndpoint}`);
  console.log("  role rules:");
  const rules = oidc.roleRules ?? {};
  if (Object.keys(rules).length === 0) {
    console.log("    (none) — the sign-in button won't be offered.");
    return;
  }
  for (const role of cfg.roles) {
    const rule = rules[role];
    if (rule) console.log(`    ${role.padEnd(16)} → ${describeRule(rule)}`);
  }
  for (const role of Object.keys(rules).filter((r) => !cfg.roles.includes(r))) {
    console.log(`    ${role.padEnd(16)} → ${describeRule(rules[role]!)} (role no longer exists)`);
  }
}

export async function oidcClear(vaultPath: string): Promise<void> {
  await runMigrations(vaultPath);
  const cfg = await loadConfig(vaultPath, {});
  if (!cfg.oauth?.oidc) {
    console.log("No OIDC configuration to clear.");
    return;
  }
  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const ans = (await rl.question(
        "Remove the OIDC block (issuer, client credentials, all role rules)? [y/N] ",
      )).trim().toLowerCase();
      if (ans !== "y" && ans !== "yes") { console.log("Cancelled."); return; }
    } finally { rl.close(); }
  }
  delete cfg.oauth.oidc;
  if (cfg.oauth && Object.keys(cfg.oauth).length === 0) delete cfg.oauth;
  await saveConfig(vaultPath, cfg);
  console.log("Removed OIDC configuration. Run `vaults push --rotate-secret` if you also want");
  console.log("to invalidate any sessions that were issued via the OIDC path.");
}

/** Show the first 4 + last 4 chars of a long secret-ish identifier. */
function maskMid(s: string): string {
  if (s.length <= 12) return "***";
  return s.slice(0, 4) + "…" + s.slice(-4);
}
