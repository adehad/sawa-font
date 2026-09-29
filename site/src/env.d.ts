/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Absolute path of the report bundle, set by the sawa-report-bundle integration. */
  readonly SAWA_REPORT_DIR: string;
  /** REPORT_ONLY=1, inlined at build time (astro.config.mjs). */
  readonly SAWA_REPORT_ONLY: boolean;
}
