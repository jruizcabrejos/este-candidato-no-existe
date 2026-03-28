const DEFAULT_MIN_CANDIDATES = 48;
const MIN_FALLBACK_CANDIDATES = 8;
const MAX_BUCKET_RADIUS = 4;
const MAX_RANKED_CANDIDATES = 48;
const RANDOM_SHORTLIST_SIZE = 8;
const IMMEDIATE_REPEAT_PENALTY = 1_000_000;
const LOCAL_REPEAT_PENALTY = 18_000;
const SOFT_USAGE_RATIO = 0.016;
const HARD_USAGE_CAP_RATIO = 0.02;
const GLOBAL_USAGE_PENALTY_AT_CAP = 36_000;
const EXTREME_LIGHT_LUMA_THRESHOLD = 230;
const EXTREME_LIGHT_CHANNEL_THRESHOLD = 228;
const EXTREME_LIGHT_SAME_ROW_PENALTY = 12_000;
const EXTREME_LIGHT_RECENT_ROW_PENALTY = 4_000;
const EXTREME_LIGHT_HISTORY_ROWS = 3;
const MIN_SELECTION_TEMPERATURE = 24;
const SELECTION_TEMPERATURE_FACTOR = 0.22;

export function buildTileIndex(metadata) {
  const quantizationStep = metadata.quantizationStep ?? 16;
  const tiles = metadata.tiles.map((tile) => ({
    ...tile,
    bucketValues: parseBucket(tile.bucket),
  }));
  const bucketMap = new Map();

  for (const tile of tiles) {
    const bucketTiles = bucketMap.get(tile.bucket) ?? [];
    bucketTiles.push(tile);
    bucketMap.set(tile.bucket, bucketTiles);
  }

  return {
    atlas: metadata.atlas,
    renderSize: metadata.renderSize,
    quantizationStep,
    tiles,
    bucketMap,
    summary: metadata.summary,
  };
}

export async function matchCells({
  cells,
  columns,
  rows,
  tileIndex,
  lumaWeight,
  variationSeed = 0,
  avoidRepeat,
  onProgress,
}) {
  const placements = new Array(cells.length);
  const candidatePoolCache = new Map();
  const usageCounts = new Map();
  const extremeLightRowUsageCounts = Array.from({ length: rows }, () => new Map());
  const usagePolicy = createUsagePolicy(cells.length);
  const random = createSeededRandom(variationSeed);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const cell = cells[index];
      const bucketKey = createBucketKey(cell, tileIndex.quantizationStep);
      const candidatePool =
        candidatePoolCache.get(bucketKey) ??
        gatherCandidatePool(bucketKey, tileIndex);

      if (!candidatePoolCache.has(bucketKey)) {
        candidatePoolCache.set(bucketKey, candidatePool);
      }

      const rankedCandidates = rankCandidatesForCell({
        candidatePool,
        cell,
        lumaWeight,
        tileIndex,
      });
      const chosenTile = chooseTile({
        rankedCandidates,
        placements,
        usageCounts,
        extremeLightRowUsageCounts,
        usagePolicy,
        index,
        row,
        columns,
        cell,
        avoidRepeat,
        random,
      });

      placements[index] = chosenTile;
      if (chosenTile?.id) {
        usageCounts.set(chosenTile.id, (usageCounts.get(chosenTile.id) ?? 0) + 1);
        if (isExtremeLightCell(cell)) {
          extremeLightRowUsageCounts[row].set(
            chosenTile.id,
            (extremeLightRowUsageCounts[row].get(chosenTile.id) ?? 0) + 1,
          );
        }
      }
    }

    onProgress?.({
      stage: "matching",
      fraction: (row + 1) / rows,
      completed: row + 1,
      total: rows,
    });

    await yieldToBrowser();
  }

  return placements;
}

function rankCandidatesForCell({ candidatePool, cell, lumaWeight, tileIndex }) {
  const effectivePool =
    candidatePool.length >= MIN_FALLBACK_CANDIDATES
      ? candidatePool
      : tileIndex.tiles;
  const uniqueTiles = dedupeTilesById(effectivePool);
  const ranked = uniqueTiles
    .map((tile) => ({
      tile,
      baseScore: scoreTile(cell, tile, lumaWeight),
    }))
    .sort((left, right) => left.baseScore - right.baseScore);

  return ranked.slice(0, MAX_RANKED_CANDIDATES);
}

function gatherCandidatePool(bucketKey, tileIndex) {
  const direct = tileIndex.bucketMap.get(bucketKey);
  if (direct?.length >= DEFAULT_MIN_CANDIDATES) {
    return dedupeTilesById(direct);
  }

  const [bucketR, bucketG, bucketB] = parseBucket(bucketKey);
  const seenBuckets = new Set();
  const pool = [];

  for (let radius = 0; radius <= MAX_BUCKET_RADIUS && pool.length < DEFAULT_MIN_CANDIDATES; radius += 1) {
    for (let deltaR = -radius; deltaR <= radius; deltaR += 1) {
      for (let deltaG = -radius; deltaG <= radius; deltaG += 1) {
        for (let deltaB = -radius; deltaB <= radius; deltaB += 1) {
          const neighborKey = [
            quantizeChannel(bucketR + deltaR * tileIndex.quantizationStep, tileIndex.quantizationStep),
            quantizeChannel(bucketG + deltaG * tileIndex.quantizationStep, tileIndex.quantizationStep),
            quantizeChannel(bucketB + deltaB * tileIndex.quantizationStep, tileIndex.quantizationStep),
          ].join("-");

          if (seenBuckets.has(neighborKey)) {
            continue;
          }

          seenBuckets.add(neighborKey);
          const bucketTiles = tileIndex.bucketMap.get(neighborKey);
          if (!bucketTiles?.length) {
            continue;
          }

          pool.push(...bucketTiles);
        }
      }
    }
  }

  return dedupeTilesById(pool);
}

function chooseTile({
  rankedCandidates,
  placements,
  usageCounts,
  extremeLightRowUsageCounts,
  usagePolicy,
  index,
  row,
  columns,
  cell,
  avoidRepeat,
  random,
}) {
  if (!rankedCandidates.length) {
    return null;
  }

  const scoredCandidates = rankedCandidates
    .map((candidate) => {
      const repetition = avoidRepeat
        ? scoreRepetition(candidate.tile.id, placements, index, columns)
        : EMPTY_REPETITION_SCORE;
      const usage = scoreGlobalUsage(candidate.tile.id, usageCounts, usagePolicy);
      const extremeLightSpread = scoreExtremeLightSpread(
        candidate.tile.id,
        extremeLightRowUsageCounts,
        row,
        cell,
      );

      return {
        ...candidate,
        ...repetition,
        ...usage,
        extremeLightSpreadPenalty: extremeLightSpread,
        totalScore: candidate.baseScore + repetition.penalty + usage.penalty + extremeLightSpread,
      };
    })
    .sort((left, right) => left.totalScore - right.totalScore);

  const hasImmediateRepeatFreeCandidate =
    avoidRepeat && scoredCandidates.some((candidate) => !candidate.hasImmediateRepeat);
  const viableCandidates = hasImmediateRepeatFreeCandidate
    ? scoredCandidates.filter((candidate) => !candidate.hasImmediateRepeat)
    : scoredCandidates;
  const selectionPool = applyUsageCapGuard(viableCandidates);
  const shortlist = selectionPool.slice(0, RANDOM_SHORTLIST_SIZE);

  if (shortlist.length <= 1) {
    return shortlist[0]?.tile ?? null;
  }

  return chooseWeightedCandidate(shortlist, random)?.tile ?? shortlist[0].tile;
}

function scoreTile(cell, tile, lumaWeight) {
  const dr = cell.r - tile.avg_r;
  const dg = cell.g - tile.avg_g;
  const db = cell.b - tile.avg_b;
  const dl = cell.luma - tile.luma;
  return dr * dr + dg * dg + db * db + lumaWeight * dl * dl;
}

function scoreRepetition(tileId, placements, index, columns) {
  const column = index % columns;
  const immediateNeighbors = [
    column > 0 ? index - 1 : -1,
    index - columns,
    column > 0 ? index - columns - 1 : -1,
    column < columns - 1 ? index - columns + 1 : -1,
  ];
  let penalty = 0;
  let hasImmediateRepeat = false;

  for (const neighborIndex of immediateNeighbors) {
    if (neighborIndex < 0) {
      continue;
    }

    if (placements[neighborIndex]?.id === tileId) {
      penalty += IMMEDIATE_REPEAT_PENALTY;
      hasImmediateRepeat = true;
    }
  }

  const localNeighbors = [
    column > 1 ? index - 2 : -1,
    column > 1 ? index - columns - 2 : -1,
    column < columns - 2 ? index - columns + 2 : -1,
    index - columns * 2,
    column > 0 ? index - columns * 2 - 1 : -1,
    column < columns - 1 ? index - columns * 2 + 1 : -1,
  ];

  for (const neighborIndex of localNeighbors) {
    if (neighborIndex < 0) {
      continue;
    }

    if (placements[neighborIndex]?.id === tileId) {
      penalty += LOCAL_REPEAT_PENALTY;
    }
  }

  return {
    penalty,
    hasImmediateRepeat,
  };
}

function scoreGlobalUsage(tileId, usageCounts, usagePolicy) {
  const nextCount = (usageCounts.get(tileId) ?? 0) + 1;
  if (nextCount <= usagePolicy.softLimit) {
    return {
      penalty: 0,
      exceedsUsageCap: false,
      nextCount,
    };
  }

  const usageRange = Math.max(1, usagePolicy.hardLimit - usagePolicy.softLimit);
  const progress = Math.min(1, (nextCount - usagePolicy.softLimit) / usageRange);

  return {
    penalty: progress * progress * GLOBAL_USAGE_PENALTY_AT_CAP,
    exceedsUsageCap: nextCount > usagePolicy.hardLimit,
    nextCount,
  };
}

function scoreExtremeLightSpread(tileId, extremeLightRowUsageCounts, row, cell) {
  if (!isExtremeLightCell(cell)) {
    return 0;
  }

  let penalty = (extremeLightRowUsageCounts[row].get(tileId) ?? 0) * EXTREME_LIGHT_SAME_ROW_PENALTY;

  for (
    let previousRow = Math.max(0, row - EXTREME_LIGHT_HISTORY_ROWS);
    previousRow < row;
    previousRow += 1
  ) {
    penalty +=
      (extremeLightRowUsageCounts[previousRow].get(tileId) ?? 0) * EXTREME_LIGHT_RECENT_ROW_PENALTY;
  }

  return penalty;
}

function createBucketKey(cell, quantizationStep) {
  return [
    quantizeChannel(cell.r, quantizationStep),
    quantizeChannel(cell.g, quantizationStep),
    quantizeChannel(cell.b, quantizationStep),
  ].join("-");
}

function parseBucket(bucket) {
  return String(bucket)
    .split("-")
    .map((value) => Number.parseInt(value, 10) || 0);
}

function quantizeChannel(value, step) {
  return Math.max(0, Math.min(255, Math.round(value / step) * step));
}

function dedupeTilesById(tiles) {
  if (!tiles.length) {
    return tiles;
  }

  const seen = new Set();
  const uniqueTiles = [];

  for (const tile of tiles) {
    if (!tile?.id || seen.has(tile.id)) {
      continue;
    }

    seen.add(tile.id);
    uniqueTiles.push(tile);
  }

  return uniqueTiles;
}

function applyUsageCapGuard(candidates) {
  if (!candidates.some((candidate) => candidate.exceedsUsageCap)) {
    return candidates;
  }

  const underCapCandidates = candidates.filter((candidate) => !candidate.exceedsUsageCap);
  return underCapCandidates.length ? underCapCandidates : candidates;
}

function isExtremeLightCell(cell) {
  return (
    cell.luma >= EXTREME_LIGHT_LUMA_THRESHOLD &&
    cell.r >= EXTREME_LIGHT_CHANNEL_THRESHOLD &&
    cell.g >= EXTREME_LIGHT_CHANNEL_THRESHOLD &&
    cell.b >= EXTREME_LIGHT_CHANNEL_THRESHOLD
  );
}

function chooseWeightedCandidate(candidates, random) {
  const bestTotal = candidates[0]?.totalScore ?? 0;
  const spread = (candidates[candidates.length - 1]?.totalScore ?? bestTotal) - bestTotal;
  const temperature = Math.max(
    MIN_SELECTION_TEMPERATURE,
    spread * SELECTION_TEMPERATURE_FACTOR,
  );

  let totalWeight = 0;
  const weightedCandidates = candidates.map((candidate) => {
    const weight = Math.exp(-(candidate.totalScore - bestTotal) / temperature);
    totalWeight += weight;
    return {
      candidate,
      weight,
    };
  });

  if (totalWeight <= 0) {
    return candidates[0] ?? null;
  }

  let threshold = random() * totalWeight;
  for (const entry of weightedCandidates) {
    threshold -= entry.weight;
    if (threshold <= 0) {
      return entry.candidate;
    }
  }

  return weightedCandidates[weightedCandidates.length - 1]?.candidate ?? candidates[0] ?? null;
}

function createSeededRandom(seed) {
  let state = (Number(seed) || 0) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createUsagePolicy(totalTiles) {
  const softLimit = Math.max(1, Math.floor(totalTiles * SOFT_USAGE_RATIO));
  const hardLimit = Math.min(
    totalTiles,
    Math.max(1, Math.floor(totalTiles * HARD_USAGE_CAP_RATIO)),
  );

  return {
    softLimit,
    hardLimit,
  };
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

const EMPTY_REPETITION_SCORE = {
  penalty: 0,
  hasImmediateRepeat: false,
};
