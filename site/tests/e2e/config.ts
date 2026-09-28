export const PORT = 4322;
export const BASE_URL = `http://localhost:${PORT}`;

/** Matches astro.config.mjs's own fallback so both agree at build and at test time. */
export const BASE_PATH = process.env.BASE_PATH ?? "/sawa-font/";
