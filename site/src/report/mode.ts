/**
 * True during the Read the Docs report-only build (REPORT_ONLY=1,
 * SAWA_PLAN.md §8.3): only the report page and the root redirect build, for
 * both locales. Backed by a Vite `define` (see astro.config.mjs) rather than
 * `process.env` directly, so this also works when bundled into client code.
 */
export function isReportOnly(): boolean {
  return import.meta.env.SAWA_REPORT_ONLY;
}
