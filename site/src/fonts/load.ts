import type { FontsData } from "./types";

// import.meta.glob resolves the path against this module's source location
// at build time, before Vite bundles or relocates the compiled output, so
// it stays correct regardless of where the importing chunk ends up.
const modules = import.meta.glob<FontsData>("../../public/fonts/fonts.json", {
  eager: true,
  import: "default",
});

let cached: FontsData | undefined;

/** Reads public/fonts/fonts.json, built alongside the site by `sawa build fonts`. */
export function loadFontsData(): FontsData {
  if (cached) {
    return cached;
  }
  const [data] = Object.values(modules);
  if (!data) {
    throw new Error(
      "site/public/fonts/fonts.json not found: run `uv run --group build sawa build fonts` from the repo root",
    );
  }
  cached = data;
  return cached;
}
