// Round-trip tests for the OIDC secret split: clientSecret must never land
// in .vaults/config.json, must mirror to .env as OAUTH_CLIENT_SECRET, and
// clearing the config must remove only the managed key.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, saveConfig, type OidcConfig } from "../src/config.js";

const OIDC: OidcConfig = {
  issuer: "https://issuer.example",
  displayName: "issuer.example",
  clientId: "client-123",
  clientSecret: "shh-do-not-commit",
  authorizationEndpoint: "https://issuer.example/oauth/authorize",
  tokenEndpoint: "https://issuer.example/oauth/token",
  userinfoEndpoint: "https://issuer.example/oauth/userinfo",
  roleRules: { dm: { emails: ["gm@example.com"], domains: ["example.com"] } },
};

describe("OIDC config round-trip", () => {
  it("keeps the secret out of config.json, mirrors it to .env, and re-injects on load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-oidc-cfg-"));
    try {
      // Unmanaged line the CLI must leave alone.
      await writeFile(join(dir, ".env"), "OAUTH_CLIENT_ID=public-id\n");

      const cfg = await loadConfig(dir, {});
      cfg.roles = ["public", "dm"];
      cfg.sessionSecret = "aa".repeat(32);
      cfg.oauth = { oidc: { ...OIDC } };
      await saveConfig(dir, cfg);

      const written = await readFile(join(dir, ".vaults", "config.json"), "utf8");
      assert.ok(!written.includes("clientSecret"), "config.json must not contain clientSecret");
      assert.ok(!written.includes(OIDC.clientSecret), "config.json must not contain the secret value");
      assert.match(written, /"issuer": "https:\/\/issuer\.example"/);

      const env = await readFile(join(dir, ".env"), "utf8");
      assert.match(env, /OAUTH_CLIENT_SECRET=shh-do-not-commit/);
      assert.match(env, /OAUTH_CLIENT_ID=public-id/);

      const reloaded = await loadConfig(dir, {});
      assert.equal(reloaded.oauth?.oidc?.clientSecret, OIDC.clientSecret);
      assert.deepEqual(reloaded.oauth?.oidc?.roleRules, OIDC.roleRules);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clearing oidc removes OAUTH_CLIENT_SECRET but leaves other .env lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-oidc-cfg-"));
    try {
      await writeFile(join(dir, ".env"), "OAUTH_CLIENT_ID=public-id\n");
      const cfg = await loadConfig(dir, {});
      cfg.roles = ["public", "dm"];
      cfg.sessionSecret = "aa".repeat(32);
      cfg.oauth = { oidc: { ...OIDC } };
      await saveConfig(dir, cfg);

      const cleared = await loadConfig(dir, {});
      delete cleared.oauth!.oidc;
      await saveConfig(dir, cleared);

      const env = await readFile(join(dir, ".env"), "utf8");
      assert.doesNotMatch(env, /OAUTH_CLIENT_SECRET/);
      assert.match(env, /OAUTH_CLIENT_ID=public-id/);
      assert.match(env, /SESSION_SECRET=/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
