import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const INDEX_PATH = path.join(DIST_DIR, "index.html");
const STATIC_ROUTES = ["dvd"];

async function main() {
  await fs.access(INDEX_PATH);

  await Promise.all(
    STATIC_ROUTES.map(async (route) => {
      const routeDir = path.join(DIST_DIR, route);
      await fs.mkdir(routeDir, { recursive: true });
      await fs.copyFile(INDEX_PATH, path.join(routeDir, "index.html"));
    }),
  );

  console.log(`Copied static route indexes: ${STATIC_ROUTES.map((route) => `/${route}`).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
