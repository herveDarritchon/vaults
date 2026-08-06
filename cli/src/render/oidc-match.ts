// Pure email-to-role matching logic for the OIDC login flow, extracted so
// tests can exercise it without spinning up a Pages Function. The shipped
// middleware in auth-template.ts duplicates this logic verbatim — it has to
// live there as plain JS since the worker can't import TS modules at
// runtime. Keep the two copies in sync (small enough that drift is easy to
// spot in review).

/**
 * Per-role rule mapping OIDC identities to a role. Matching is exact and
 * case-insensitive: no plus-address or dot folding (those are provider-
 * specific conventions, and `a+b@x` is a distinct address), and a domain
 * rule matches only the exact domain after the last `@` — `me@cs.lmu.edu`
 * does NOT match `lmu.edu`; list subdomains explicitly.
 */
export interface OidcRoleRule {
  /** Exact email addresses, lowercase. */
  emails?: string[];
  /** Exact email domains (no leading `@`), lowercase. */
  domains?: string[];
}

/**
 * Return the highest-ranked role whose rule matches the email, or null.
 * Roles are ordered low → high; iterate from highest so a visitor matching
 * several rules gets the strongest role, mirroring the Patreon tier matcher.
 */
export function matchOidcRole(
  email: string,
  roleRules: Record<string, OidcRoleRule>,
  roles: string[],
): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const lower = email.toLowerCase();
  const domain = lower.slice(at + 1);
  for (let i = roles.length - 1; i >= 0; i--) {
    const role = roles[i]!;
    const rule = roleRules[role];
    if (!rule) continue;
    if ((rule.emails ?? []).some((e) => e.toLowerCase() === lower)) return role;
    if (domain && (rule.domains ?? []).some((d) => d.toLowerCase() === domain)) return role;
  }
  return null;
}
