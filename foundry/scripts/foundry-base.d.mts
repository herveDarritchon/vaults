// Type surface for the parts of foundry-base.mjs that the CLI's tests import.
//
// Same reason as foundry/test/foundry-base.test.d.mts: the Foundry module is
// plain .mjs and the CLI typechecks its tests, so crossing that boundary needs
// a declaration. Only what the CLI actually reads is declared — an import of
// anything else fails loudly here rather than silently typing as `any`.

/** Document type to compendium pack name fragment. */
export declare const PACK_KEY: Record<string, string>;

/** Page types Foundry itself ships. */
export declare const CORE_PAGE_TYPES: string[];

/** Read `foundry.journal` as a JournalEntryPage overlay; null when opted out. */
export declare function journalPageSpec(
  fm: Record<string, unknown> | undefined,
): { type: string; overlay: Record<string, unknown>; dropsBody: boolean } | null;
