import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
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

  const files = await readdir(SOURCE_DIR, { withFileTypes: true });
  await mkdir(TARGET_DIR, { recursive: true });

  for (const entry of files) {
    if (!entry.isFile()) {
      continue;
    }

    const sourcePath = path.join(SOURCE_DIR, entry.name);
    const targetPath = path.join(TARGET_DIR, entry.name);
    await copyFile(sourcePath, targetPath);
  }

  console.log(`Synced ${files.length} favicon assets into public/favicon.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
