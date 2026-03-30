import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { buildTileIndex, matchCells } from "../src/mosaic/matcher.js";

const EXAMPLES_DIR = "ejemplos";
const DETAIL = 84;
const LUMA_WEIGHT = 0.85;
const SEEDS = [101, 202, 303, 404, 505];

async function main() {
  const rootDir = process.cwd();
  const examplesDir = path.join(rootDir, EXAMPLES_DIR);
  const metadata = JSON.parse(
    await fs.readFile(path.join(rootDir, "public/generated/mosaic/tiles.json"), "utf8"),
  );
  const tileIndex = buildTileIndex(metadata);
  const imageFiles = await listRootExampleImages(examplesDir);

  console.log(
    `Benchmarking ${imageFiles.length} root-level example images from ${EXAMPLES_DIR}/ with seeds ${SEEDS.join(", ")}.`,
  );

  const globalTop10Hits = new Map();

  for (const imageFile of imageFiles) {
    const imagePath = path.join(examplesDir, imageFile);
    const { columns, rows, cells } = await analyzeImage(imagePath);
    const perSeed = [];

    for (const seed of SEEDS) {
      const placements = await matchCells({
        cells,
        columns,
        rows,
        tileIndex,
        lumaWeight: LUMA_WEIGHT,
        variationSeed: seed,
        avoidRepeat: true,
      });
      const summary = summarizePlacements(placements, seed);
      perSeed.push({
        seed,
        uniqueTiles: summary.uniqueTiles,
        top1Percentage: summary.top10[0]?.percentage ?? 0,
        top10: summary.top10,
      });

      for (const entry of summary.top10) {
        globalTop10Hits.set(entry.id, (globalTop10Hits.get(entry.id) ?? 0) + 1);
      }
    }

    const top10Sets = perSeed.map((run) => run.top10.map((entry) => entry.id));
    const top10Union = new Set(top10Sets.flat());

    console.log(`IMAGE ${imageFile}`);
    console.log(
      JSON.stringify(
        {
          grid: `${columns}x${rows}`,
          uniqueTilesRange: [
            Math.min(...perSeed.map((run) => run.uniqueTiles)),
            Math.max(...perSeed.map((run) => run.uniqueTiles)),
          ],
          top1PercentageRange: [
            roundToTwo(Math.min(...perSeed.map((run) => run.top1Percentage))),
            roundToTwo(Math.max(...perSeed.map((run) => run.top1Percentage))),
          ],
          top10UnionAcrossSeeds: top10Union.size,
          avgPairwiseTop10Overlap: roundToTwo(computeAveragePairwiseOverlap(top10Sets)),
          seedRuns: perSeed.map((run) => ({
            seed: run.seed,
            uniqueTiles: run.uniqueTiles,
            top1: run.top10[0]
              ? {
                  id: run.top10[0].id,
                  name: run.top10[0].name,
                  percentage: roundToTwo(run.top10[0].percentage),
                }
              : null,
            top10Ids: run.top10.map((entry) => entry.id),
          })),
        },
        null,
        2,
      ),
    );
  }

  const globalLeaderboard = [...globalTop10Hits.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
    .slice(0, 20)
    .map(([id, hits]) => ({ id, hits }));

  console.log("GLOBAL_TOP10_LEADERBOARD");
  console.log(JSON.stringify(globalLeaderboard, null, 2));
}

async function listRootExampleImages(examplesDir) {
  const entries = await fs.readdir(examplesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function analyzeImage(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not determine dimensions for ${path.basename(imagePath)}.`);
  }

  const { columns, rows } = calculateGrid(metadata.width, metadata.height, DETAIL);
  const { data, info } = await sharp(imagePath)
    .resize(columns, rows, { fit: "cover", position: "centre" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cells = new Array(info.width * info.height);

  for (let index = 0; index < cells.length; index += 1) {
    const offset = index * info.channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    cells[index] = {
      r,
      g,
      b,
      luma: Math.round(0.299 * r + 0.587 * g + 0.114 * b),
    };
  }

  return {
    columns,
    rows,
    cells,
  };
}

function calculateGrid(width, height, longSideCells) {
  const aspectRatio = width / height;

  if (aspectRatio >= 1) {
    return {
      columns: longSideCells,
      rows: Math.max(1, Math.round(longSideCells / aspectRatio)),
    };
  }

  return {
    columns: Math.max(1, Math.round(longSideCells * aspectRatio)),
    rows: longSideCells,
  };
}

function summarizePlacements(placements, variationSeed) {
  const counts = new Map();

  for (const tile of placements) {
    if (!tile?.id) {
      continue;
    }

    const current = counts.get(tile.id) ?? {
      id: tile.id,
      name: tile.name,
      count: 0,
    };
    current.count += 1;
    counts.set(tile.id, current);
  }

  const totalTiles = placements.length || 1;
  const top10 = [...counts.values()]
    .map((entry) => ({
      ...entry,
      percentage: (entry.count / totalTiles) * 100,
    }))
    .sort((left, right) => compareCompositionEntries(left, right, variationSeed))
    .slice(0, 10);

  return {
    uniqueTiles: counts.size,
    top10,
  };
}

function compareCompositionEntries(left, right, variationSeed) {
  const countDiff = right.count - left.count;
  if (countDiff !== 0) {
    return countDiff;
  }

  const leftTieScore = scoreCompositionTie(left.id, variationSeed);
  const rightTieScore = scoreCompositionTie(right.id, variationSeed);
  return leftTieScore - rightTieScore || left.name.localeCompare(right.name, "es");
}

function scoreCompositionTie(value, variationSeed) {
  let hash = 2166136261 ^ ((Number(variationSeed) || 0) >>> 0);
  const text = String(value ?? "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function computeAveragePairwiseOverlap(top10Sets) {
  if (top10Sets.length <= 1) {
    return top10Sets[0]?.length ?? 0;
  }

  let overlapTotal = 0;
  let pairCount = 0;

  for (let leftIndex = 0; leftIndex < top10Sets.length; leftIndex += 1) {
    const leftSet = new Set(top10Sets[leftIndex]);
    for (let rightIndex = leftIndex + 1; rightIndex < top10Sets.length; rightIndex += 1) {
      let overlap = 0;
      for (const id of top10Sets[rightIndex]) {
        if (leftSet.has(id)) {
          overlap += 1;
        }
      }
      overlapTotal += overlap;
      pairCount += 1;
    }
  }

  return overlapTotal / Math.max(1, pairCount);
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

await main();
