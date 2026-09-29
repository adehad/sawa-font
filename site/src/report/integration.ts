import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration, AstroIntegrationLogger } from "astro";
import { SAWA_FONT_IDS } from "../fonts/css";
import { resolveReportDir } from "./load";

// Astro loads this integration module directly through Node, not through
// Vite's bundling, so the `import.meta.env.SAWA_REPORT_ONLY` define (mode.ts)
// never reaches it; read REPORT_ONLY from process.env here instead, the same
// way this file already reads REPORT_DIR.
function isReportOnlyBuild(): boolean {
  return process.env.REPORT_ONLY === "1";
}

/** Where the bundle's SVG layers and Fontbakery pages are served, under the site's base. */
export const BUNDLE_SEGMENT = "report-bundle";

const CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

/**
 * The files of the bundle in `dir` the site serves, as forward-slash paths
 * relative to it: every test's SVG layers and the Fontbakery HTML.
 */
export function bundleAssets(dir: string): string[] {
  if (!existsSync(path.join(dir, "manifest.json"))) {
    return [];
  }
  const assets: string[] = [];
  for (const sub of ["tests", "fontbakery"]) {
    const root = path.join(dir, sub);
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
      const extension = path.extname(entry.name);
      const wanted = sub === "tests" ? extension === ".svg" : extension === ".html";
      if (entry.isFile() && wanted) {
        const relative = path.relative(dir, path.join(entry.parentPath, entry.name));
        assets.push(relative.split(path.sep).join("/"));
      }
    }
  }
  return assets.toSorted();
}

/**
 * Removes every font directory under `<outDir>/fonts` except the Sawa
 * families: the report-only build never links to the comparison roster
 * (`Base.astro`'s @font-face rules are already scoped the same way), but
 * Astro's public dir copy ships it verbatim regardless.
 */
function pruneRosterFonts(outPath: string, logger: AstroIntegrationLogger): void {
  const fontsDir = path.join(outPath, "fonts");
  if (!existsSync(fontsDir)) {
    return;
  }
  const sawaIds: readonly string[] = SAWA_FONT_IDS;
  let pruned = 0;
  for (const entry of readdirSync(fontsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !sawaIds.includes(entry.name)) {
      rmSync(path.join(fontsDir, entry.name), { recursive: true, force: true });
      pruned += 1;
    }
  }
  if (pruned > 0) {
    logger.info(
      `report-only build: pruned ${pruned} roster font director${pruned === 1 ? "y" : "ies"} from dist/fonts`,
    );
  }
}

/**
 * Points the build at the report bundle: REPORT_DIR (default
 * ../report/current) resolved against the site root rather than the working
 * directory, exposed to pages as import.meta.env.SAWA_REPORT_DIR, with its
 * SVG layers and Fontbakery pages served under <base>/report-bundle/.
 */
export function reportBundle(): AstroIntegration {
  let dir = "";
  return {
    name: "sawa-report-bundle",
    hooks: {
      "astro:config:setup": ({ config, updateConfig }) => {
        dir = resolveReportDir(fileURLToPath(config.root), process.env.REPORT_DIR);
        updateConfig({
          vite: { define: { "import.meta.env.SAWA_REPORT_DIR": JSON.stringify(dir) } },
        });
      },
      "astro:server:setup": ({ server }) => {
        const base = server.config.base.endsWith("/")
          ? server.config.base
          : `${server.config.base}/`;
        const assets = new Set(bundleAssets(dir));
        server.middlewares.use(`${base}${BUNDLE_SEGMENT}`, (req, res, next) => {
          let relative: string;
          try {
            relative = decodeURIComponent((req.url ?? "").split("?")[0] ?? "").replace(/^\//, "");
          } catch {
            res.statusCode = 400;
            res.end();
            return;
          }
          if (!assets.has(relative)) {
            next();
            return;
          }
          res.setHeader("Content-Type", CONTENT_TYPES[path.extname(relative)] ?? "text/plain");
          res.end(readFileSync(path.join(dir, relative)));
        });
      },
      "astro:build:done": ({ dir: outDir, logger }) => {
        const outPath = fileURLToPath(outDir);
        const assets = bundleAssets(dir);
        if (assets.length === 0) {
          logger.warn(`no report bundle at ${dir}; the report page says so`);
        } else {
          const target = path.join(outPath, BUNDLE_SEGMENT);
          for (const asset of assets) {
            const destination = path.join(target, asset);
            mkdirSync(path.dirname(destination), { recursive: true });
            copyFileSync(path.join(dir, asset), destination);
          }
          logger.info(`copied ${assets.length} report files from ${dir}`);
        }
        if (isReportOnlyBuild()) {
          pruneRosterFonts(outPath, logger);
        }
      },
    },
  };
}
