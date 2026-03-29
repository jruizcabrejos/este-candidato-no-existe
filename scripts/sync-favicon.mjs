import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "favicon");
const TARGET_DIR = path.join(ROOT, "public", "favicon");

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(SOURCE_DIR))) {
    console.log("No local favicon source directory found. Skipping favicon sync.");
    return;
  }

  await mkdir(TARGET_DIR, { recursive: true });
  await cp(SOURCE_DIR, TARGET_DIR, { recursive: true, force: true });

  const files = await readdir(SOURCE_DIR);
  console.log(`Synced ${files.length} favicon assets into public/favicon.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
