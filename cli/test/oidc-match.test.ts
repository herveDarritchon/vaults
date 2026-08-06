// Unit tests for the email/domain → role matcher used by the OIDC login
// flow. Mirrors the inline copy in auth-template.ts (see oidc-match.ts).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchOidcRole } from "../src/render/oidc-match.js";

const ROLES = ["public", "student", "instructor"]; // low → high

describe("matchOidcRole", () => {
  it("matches an exact email", () => {
    const rules = { instructor: { emails: ["prof@lmu.edu"] } };
    assert.equal(matchOidcRole("prof@lmu.edu", rules, ROLES), "instructor");
  });

  it("is case-insensitive in both directions", () => {
    const rules = { instructor: { emails: ["Prof@LMU.edu"] } };
    assert.equal(matchOidcRole("prof@lmu.edu", rules, ROLES), "instructor");
    const rules2 = { instructor: { emails: ["prof@lmu.edu"] } };
    assert.equal(matchOidcRole("PROF@LMU.EDU", rules2, ROLES), "instructor");
  });

  it("matches a domain rule", () => {
    const rules = { student: { domains: ["lion.lmu.edu"] } };
    assert.equal(matchOidcRole("someone@lion.lmu.edu", rules, ROLES), "student");
  });

  it("does not let a subdomain match a bare domain rule", () => {
    const rules = { student: { domains: ["lmu.edu"] } };
    assert.equal(matchOidcRole("me@cs.lmu.edu", rules, ROLES), null);
  });

  it("grants the highest role when several rules match", () => {
    const rules = {
      student: { domains: ["lmu.edu"] },
      instructor: { emails: ["prof@lmu.edu"] },
    };
    assert.equal(matchOidcRole("prof@lmu.edu", rules, ROLES), "instructor");
  });

  it("grants a lower role when only its rule matches", () => {
    const rules = {
      student: { domains: ["lion.lmu.edu"] },
      instructor: { emails: ["prof@lmu.edu"] },
    };
    assert.equal(matchOidcRole("kid@lion.lmu.edu", rules, ROLES), "student");
  });

  it("returns null for a role rule with empty arrays", () => {
    const rules = { instructor: { emails: [], domains: [] } };
    assert.equal(matchOidcRole("prof@lmu.edu", rules, ROLES), null);
  });

  it("returns null for an email without an @", () => {
    const rules = { instructor: { domains: ["lmu.edu"] } };
    assert.equal(matchOidcRole("not-an-email", rules, ROLES), null);
  });

  it("treats plus-addresses as distinct emails", () => {
    const rules = { instructor: { emails: ["prof@lmu.edu"] } };
    assert.equal(matchOidcRole("prof+alias@lmu.edu", rules, ROLES), null);
  });

  it("returns null when no rules are configured", () => {
    assert.equal(matchOidcRole("prof@lmu.edu", {}, ROLES), null);
  });
});
