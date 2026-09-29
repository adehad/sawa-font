// A separate port and base path from tests/e2e/config.ts: this project
// builds the site a second time, with REPORT_ONLY=1, and must not collide
// with the main e2e webServer.
export const PORT = 4324;
export const BASE_URL = `http://localhost:${PORT}`;

/** Mirrors the shape Read the Docs derives with `sawa rtd base-path`. */
export const BASE_PATH = "/en/v0.0.0/";
