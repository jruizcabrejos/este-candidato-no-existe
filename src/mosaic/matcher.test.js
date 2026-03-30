import assert from "node:assert/strict";
import test from "node:test";

import { buildTileIndex, matchCells } from "./matcher.js";

const DEFAULT_COLUMNS = 40;
const DEFAULT_ROWS = 40;
const DEFAULT_LUMA_WEIGHT = 0.85;
const DEFAULT_VARIATION_SEED = 12345;

test("rotates sparse bright singleton buckets across similar bright candidates", async () => {
  const tileIndex = buildTileIndex(buildMetadata(createSparseBrightTiles()));
  const brightCore = getTileFromIndex(tileIndex, "bright-core");

  assert.equal(brightCore.bucketSize, 1);
  assert.equal(brightCore.similarIds.length, 24);

  const placements = await runMatcher({
    tileIndex,
    cellRgb: [232, 213, 201],
  });
  const counts = countPlacements(placements);
  const sortedCounts = [...counts.values()].sort((left, right) => left - right);

  assert.ok(counts.size >= 14);
  assert.ok(counts.get("bright-core") > 0);
  assert.ok(sortedCounts.at(-1) - sortedCounts[0] <= 64);
  assert.ok(counts.get("bright-core") <= 120);
});

test("rotates sparse dark singleton buckets across similar dark candidates", async () => {
  const tileIndex = buildTileIndex(buildMetadata(createSparseDarkTiles()));
  const darkCore = getTileFromIndex(tileIndex, "dark-core");

  assert.equal(darkCore.bucketSize, 1);
  assert.equal(darkCore.similarIds.length, 24);

  const placements = await runMatcher({
    tileIndex,
    cellRgb: [77, 60, 50],
  });
  const counts = countPlacements(placements);
  const sortedCounts = [...counts.values()].sort((left, right) => left - right);

  assert.ok(counts.size >= 14);
  assert.ok(counts.get("dark-core") > 0);
  assert.ok(sortedCounts.at(-1) - sortedCounts[0] <= 72);
  assert.ok(counts.get("dark-core") <= 130);
});

test("spreads dense mid-tone buckets across the wider shortlist so the top 10 stay flatter", async () => {
  const tileIndex = buildTileIndex(buildMetadata(createDenseMidToneTiles()));
  const anchor = getTileFromIndex(tileIndex, "mid-1");

  assert.equal(anchor.bucketSize, 20);
  assert.equal(anchor.similarIds.length, 20);

  const placements = await runMatcher({
    tileIndex,
    cellRgb: [144, 112, 96],
  });
  const counts = countPlacements(placements);
  const sortedCounts = [...counts.values()].sort((left, right) => left - right);
  const topTenCounts = [...counts.values()].sort((left, right) => right - left).slice(0, 10);

  assert.equal(counts.size, 20);
  assert.ok(sortedCounts.at(-1) <= 90);
  assert.ok(sortedCounts.at(-1) - sortedCounts[0] <= 20);
  assert.ok(topTenCounts[0] - topTenCounts.at(-1) <= 10);
});

test("keeps the best raw match inside the leading pack when balance pressure spreads the crown", async () => {
  const tileIndex = buildTileIndex(buildMetadata(createFidelityEscapeTiles()));
  const cells = [
    ...Array.from({ length: DEFAULT_COLUMNS * DEFAULT_ROWS - 1 }, () => createCell([150, 118, 102])),
    createCell([144, 112, 96]),
  ];

  const placements = await matchCells({
    cells,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    tileIndex,
    lumaWeight: DEFAULT_LUMA_WEIGHT,
    variationSeed: 98765,
    avoidRepeat: false,
  });
  const counts = countPlacements(placements);
  const heavyAlternatives = [...counts.entries()].filter(
    ([id, count]) => id !== "core" && count >= 100,
  );
  const topCount = Math.max(...counts.values());

  assert.ok(counts.get("core") >= topCount - 2);
  assert.ok(counts.get("core") >= 120);
  assert.ok(heavyAlternatives.length >= 4);
});

test("holds the hard usage cap at 1.5% when a broad dark neighborhood has enough substitutes", async () => {
  const tileIndex = buildTileIndex(buildMetadata(createBroadDarkCapTiles(80)));
  const anchor = getTileFromIndex(tileIndex, "cap-dark-1");
  const placements = await runMatcher({
    tileIndex,
    cellRgb: [96, 78, 60],
  });
  const counts = countPlacements(placements);
  const hardLimit = Math.floor((DEFAULT_COLUMNS * DEFAULT_ROWS) * 0.015);

  assert.equal(anchor.similarIds.length, 40);
  assert.ok(Math.max(...counts.values()) <= hardLimit);
  assert.ok(counts.size >= 67);
});

test("widens dark top-10 rotation across seeds when about 40 similar dark candidates are available", async () => {
  const tileIndex = buildTileIndex(buildMetadata(createDarkDiversityTiles()));
  const anchor = getTileFromIndex(tileIndex, "dark-rot-1");
  const seeds = [101, 202, 303, 404, 505];
  const topTenUnion = new Set();
  const topTens = [];

  assert.equal(anchor.similarIds.length, 40);

  for (const seed of seeds) {
    const placements = await runMatcher({
      tileIndex,
      cellRgb: [96, 78, 60],
      variationSeed: seed,
    });
    const topTenIds = buildTopTenIds(placements, seed);
    topTens.push(topTenIds);
    for (const id of topTenIds) {
      topTenUnion.add(id);
    }
  }

  const pairCount = (topTens.length * (topTens.length - 1)) / 2;
  const averageOverlap = computePairwiseOverlap(topTens) / Math.max(1, pairCount);

  assert.ok(topTenUnion.size >= 18);
  assert.ok(averageOverlap <= 7.5);
});

async function runMatcher({
  tileIndex,
  cellRgb,
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  avoidRepeat = true,
  variationSeed = DEFAULT_VARIATION_SEED,
}) {
  const cells = Array.from({ length: columns * rows }, () => createCell(cellRgb));
  return matchCells({
    cells,
    columns,
    rows,
    tileIndex,
    lumaWeight: DEFAULT_LUMA_WEIGHT,
    variationSeed,
    avoidRepeat,
  });
}

function buildMetadata(tiles) {
  return {
    quantizationStep: 16,
    atlas: { url: "", width: 0, height: 0 },
    renderSize: 16,
    summary: { tileCount: tiles.length },
    tiles,
  };
}

function createSparseBrightTiles() {
  return [
    createTile("bright-core", [232, 213, 201]),
    createTile("bright-1", [230, 208, 194]),
    createTile("bright-2", [228, 209, 192]),
    createTile("bright-3", [239, 206, 193]),
    createTile("bright-4", [228, 198, 205]),
    createTile("bright-5", [224, 200, 192]),
    createTile("bright-6", [216, 208, 192]),
    createTile("bright-7", [227, 203, 184]),
    createTile("bright-8", [236, 196, 192]),
    createTile("bright-9", [220, 192, 192]),
    createTile("bright-10", [214, 202, 186]),
    createTile("bright-11", [210, 190, 180]),
    createTile("dark-1", [80, 60, 50]),
    createTile("dark-2", [96, 80, 64]),
    createTile("mix-1", [200, 180, 170]),
    createTile("mix-2", [190, 170, 160]),
    createTile("mix-3", [180, 160, 150]),
    createTile("mix-4", [170, 150, 140]),
    createTile("mix-5", [160, 140, 130]),
    createTile("mix-6", [150, 130, 120]),
    createTile("mix-7", [140, 120, 110]),
    createTile("mix-8", [130, 110, 100]),
    createTile("mix-9", [120, 100, 90]),
    createTile("mix-10", [110, 90, 80]),
  ];
}

function createSparseDarkTiles() {
  return [
    createTile("dark-core", [77, 60, 50]),
    createTile("dark-1", [91, 67, 54]),
    createTile("dark-2", [92, 72, 61]),
    createTile("dark-3", [98, 74, 55]),
    createTile("dark-4", [96, 78, 59]),
    createTile("dark-5", [99, 75, 58]),
    createTile("dark-6", [102, 73, 54]),
    createTile("dark-7", [107, 73, 61]),
    createTile("dark-8", [117, 71, 52]),
    createTile("dark-9", [104, 80, 80]),
    createTile("dark-10", [112, 80, 64]),
    createTile("dark-11", [120, 88, 70]),
    createTile("bright-1", [220, 205, 192]),
    createTile("bright-2", [232, 213, 201]),
    createTile("mix-1", [130, 100, 80]),
    createTile("mix-2", [140, 108, 88]),
    createTile("mix-3", [150, 116, 96]),
    createTile("mix-4", [160, 124, 104]),
    createTile("mix-5", [170, 132, 112]),
    createTile("mix-6", [180, 140, 120]),
    createTile("mix-7", [190, 148, 128]),
    createTile("mix-8", [200, 156, 136]),
    createTile("mix-9", [210, 164, 144]),
    createTile("mix-10", [220, 172, 152]),
  ];
}

function createDenseMidToneTiles() {
  return [
    createTile("mid-1", [137, 105, 89]),
    createTile("mid-2", [138, 106, 90]),
    createTile("mid-3", [139, 107, 91]),
    createTile("mid-4", [140, 108, 92]),
    createTile("mid-5", [141, 109, 93]),
    createTile("mid-6", [142, 110, 94]),
    createTile("mid-7", [143, 111, 95]),
    createTile("mid-8", [144, 112, 96]),
    createTile("mid-9", [145, 113, 97]),
    createTile("mid-10", [146, 114, 98]),
    createTile("mid-11", [147, 115, 99]),
    createTile("mid-12", [148, 116, 100]),
    createTile("mid-13", [149, 117, 101]),
    createTile("mid-14", [150, 118, 102]),
    createTile("mid-15", [151, 119, 103]),
    createTile("mid-16", [138, 118, 95]),
    createTile("mid-17", [140, 116, 97]),
    createTile("mid-18", [142, 114, 99]),
    createTile("mid-19", [146, 110, 93]),
    createTile("mid-20", [148, 108, 91]),
  ];
}

function createFidelityEscapeTiles() {
  return [
    createTile("core", [144, 112, 96]),
    createTile("alt-1", [255, 220, 200]),
    createTile("alt-2", [245, 210, 190]),
    createTile("alt-3", [235, 200, 180]),
    createTile("alt-4", [225, 190, 170]),
    createTile("alt-5", [40, 24, 20]),
    createTile("alt-6", [50, 34, 28]),
    createTile("alt-7", [60, 44, 36]),
    createTile("alt-8", [70, 54, 44]),
    createTile("alt-9", [215, 180, 160]),
    createTile("alt-10", [80, 64, 52]),
    createTile("alt-11", [205, 170, 150]),
  ];
}

function createBroadDarkCapTiles(count) {
  return Array.from({ length: count }, (_, index) => {
    const r = 78 + (index % 10) * 3;
    const g = 58 + (Math.floor(index / 10) % 8) * 3;
    const b = 46 + (Math.floor(index / 20) % 4) * 5 + (index % 2);
    return createTile(`cap-dark-${index + 1}`, [r, g, b]);
  });
}

function createDarkDiversityTiles() {
  const darkTiles = Array.from({ length: 40 }, (_, index) => {
    const ring = Math.floor(index / 10);
    const step = index % 10;
    const r = 82 + step * 3 + ring;
    const g = 60 + ring * 4 + (step % 5) * 3;
    const b = 48 + ring * 4 + ((step + ring) % 5) * 3;
    return createTile(`dark-rot-${index + 1}`, [r, g, b]);
  });
  const supportTiles = [
    createTile("support-1", [118, 92, 78]),
    createTile("support-2", [122, 96, 80]),
    createTile("support-3", [126, 100, 84]),
    createTile("support-4", [130, 104, 88]),
    createTile("support-5", [134, 108, 92]),
    createTile("support-6", [138, 112, 96]),
    createTile("support-7", [142, 116, 100]),
    createTile("support-8", [146, 120, 104]),
  ];

  return [...darkTiles, ...supportTiles];
}

function createTile(id, [r, g, b]) {
  return {
    id,
    name: id,
    party: "Party",
    region: "Region",
    bucket: `${quantizeChannel(r)}-${quantizeChannel(g)}-${quantizeChannel(b)}`,
    avg_r: r,
    avg_g: g,
    avg_b: b,
    luma: computeLuma(r, g, b),
    x: 0,
    y: 0,
    width: 16,
    height: 16,
  };
}

function createCell([r, g, b]) {
  return {
    r,
    g,
    b,
    luma: computeLuma(r, g, b),
  };
}

function getTileFromIndex(tileIndex, tileId) {
  const tile = tileIndex.tiles.find((entry) => entry.id === tileId);
  assert.ok(tile, `Expected tile ${tileId} to exist in the test index.`);
  return tile;
}

function countPlacements(placements) {
  const counts = new Map();

  for (const tile of placements) {
    assert.ok(tile?.id, "Expected each placement to resolve to a tile.");
    counts.set(tile.id, (counts.get(tile.id) ?? 0) + 1);
  }

  return counts;
}

function buildTopTenIds(placements, variationSeed) {
  return [...countPlacements(placements).entries()]
    .sort((left, right) => {
      const countDiff = right[1] - left[1];
      if (countDiff !== 0) {
        return countDiff;
      }

      const leftTieScore = scoreCompositionTie(left[0], variationSeed);
      const rightTieScore = scoreCompositionTie(right[0], variationSeed);
      return leftTieScore - rightTieScore || left[0].localeCompare(right[0], "en");
    })
    .slice(0, 10)
    .map(([id]) => id);
}

function computePairwiseOverlap(topTens) {
  let totalOverlap = 0;

  for (let leftIndex = 0; leftIndex < topTens.length; leftIndex += 1) {
    const leftSet = new Set(topTens[leftIndex]);
    for (let rightIndex = leftIndex + 1; rightIndex < topTens.length; rightIndex += 1) {
      let overlap = 0;
      for (const id of topTens[rightIndex]) {
        if (leftSet.has(id)) {
          overlap += 1;
        }
      }
      totalOverlap += overlap;
    }
  }

  return totalOverlap;
}

function computeLuma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function quantizeChannel(value, step = 16) {
  return Math.max(0, Math.min(255, Math.round(value / step) * step));
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
