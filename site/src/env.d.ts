/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Absolute path of the report bundle, set by the sawa-report-bundle integration. */
  readonly SAWA_REPORT_DIR: string;
}
