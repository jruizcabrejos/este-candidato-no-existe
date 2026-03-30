const DEFAULT_MIN_CANDIDATES = 48;
const MIN_FALLBACK_CANDIDATES = 8;
const MAX_BUCKET_RADIUS = 4;
const DARK_CELL_MAX_BUCKET_RADIUS = 6;
const DARK_CELL_MIN_CANDIDATES = 96;
const MAX_RANKED_CANDIDATES = 192;
const DEFAULT_SHORTLIST_SIZE = 24;
const DARK_CELL_SHORTLIST_SIZE = 36;
const DARK_CELL_LUMA_THRESHOLD = 100;
const DARK_CELL_VARIATION_PENALTY = 24;
const IMMEDIATE_REPEAT_PENALTY = 1_000_000;
const LOCAL_REPEAT_PENALTY = 18_000;
const SOFT_USAGE_RATIO = 0.012;
const HARD_USAGE_CAP_RATIO = 0.015;
const GLOBAL_USAGE_PENALTY_AT_CAP = 36_000;
const SIMILAR_NEIGHBORHOOD_TARGET = 24;
const DARK_SIMILAR_NEIGHBORHOOD_TARGET = 40;
const SIMILAR_NEIGHBORHOOD_MAX_RADIUS = 4;
const SIMILAR_NEIGHBORHOOD_LUMA_WEIGHT = 1;
const DARK_CANDIDATE_LUMA_THRESHOLD = 92;
const NEIGHBORHOOD_DOMINANCE_BUFFER = 0;
const NEIGHBORHOOD_DOMINANCE_RANGE_FACTOR = 0.08;
const NEIGHBORHOOD_DOMINANCE_MIN_RANGE = 3;
const NEIGHBORHOOD_DOMINANCE_PENALTY_AT_CAP = GLOBAL_USAGE_PENALTY_AT_CAP;
const NEIGHBORHOOD_SATURATION_SOFT_RATIO = 0.01;
const NEIGHBORHOOD_SATURATION_MIN_RANGE = 8;
const NEIGHBORHOOD_SATURATION_PENALTY_AT_CAP = GLOBAL_USAGE_PENALTY_AT_CAP;
const TOP_COHORT_SIZE = 10;
const TOP_COHORT_START_RATIO = 0.0035;
const TOP_COHORT_START_MIN = 12;
const TOP_COHORT_RANGE_FACTOR = 0.08;
const TOP_COHORT_RANGE_MIN = 3;
const TOP_COHORT_PENALTY_AT_CAP = GLOBAL_USAGE_PENALTY_AT_CAP;
const EXTREME_LIGHT_LUMA_THRESHOLD = 230;
const EXTREME_LIGHT_CHANNEL_THRESHOLD = 228;
const EXTREME_LIGHT_SAME_ROW_PENALTY = 12_000;
const EXTREME_LIGHT_RECENT_ROW_PENALTY = 4_000;
const EXTREME_LIGHT_HISTORY_ROWS = 3;
const MIN_SELECTION_TEMPERATURE = 24;
const SELECTION_TEMPERATURE_FACTOR = 0.22;
const FIDELITY_BASELINE_CANDIDATES = 4;
const FIDELITY_NEIGHBORHOOD_LEAD_BUFFER = 3;
const FIDELITY_TOP_COHORT_LEAD_BUFFER = 3;
const FIDELITY_ESCAPE_HATCH_MULTIPLIER = 4;

export function buildTileIndex(metadata) {
  const quantizationStep = metadata.quantizationStep ?? 16;
  const tiles = metadata.tiles.map((tile) => ({
    ...tile,
    bucketValues: parseBucket(tile.bucket),
    bucketSize: 0,
    similarIds: [],
  }));
  const bucketMap = new Map();

  for (const tile of tiles) {
    const bucketTiles = bucketMap.get(tile.bucket) ?? [];
    bucketTiles.push(tile);
    bucketMap.set(tile.bucket, bucketTiles);
  }

  const tileById = new Map();
  for (const tile of tiles) {
    tileById.set(tile.id, tile);
  }

  for (const tile of tiles) {
    const bucketTiles = bucketMap.get(tile.bucket) ?? [];
    tile.bucketSize = bucketTiles.length;
    tile.similarIds = buildSimilarIds(tile, {
      bucketMap,
      quantizationStep,
      tiles,
    });
  }

  return {
    atlas: metadata.atlas,
    renderSize: metadata.renderSize,
    quantizationStep,
    tiles,
    bucketMap,
    tileById,
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
      const darkCell = isDarkCell(cell);
      const bucketKey = createBucketKey(cell, tileIndex.quantizationStep);
      const candidatePoolKey = darkCell ? `${bucketKey}|dark` : bucketKey;
      const candidatePool =
        candidatePoolCache.get(candidatePoolKey) ??
        gatherCandidatePool(bucketKey, tileIndex, { darkCell });

      if (!candidatePoolCache.has(candidatePoolKey)) {
        candidatePoolCache.set(candidatePoolKey, candidatePool);
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
        variationSeed,
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

function gatherCandidatePool(bucketKey, tileIndex, { darkCell = false } = {}) {
  const minCount = darkCell ? DARK_CELL_MIN_CANDIDATES : DEFAULT_MIN_CANDIDATES;
  const maxRadius = darkCell ? DARK_CELL_MAX_BUCKET_RADIUS : MAX_BUCKET_RADIUS;
  const neighborhoodTiles = gatherTilesFromBucketNeighborhood(bucketKey, tileIndex, {
    minCount,
    maxRadius,
  });

  if (!darkCell || neighborhoodTiles.length >= minCount) {
    return neighborhoodTiles;
  }

  return fillCandidatePoolFromBucketReference(bucketKey, neighborhoodTiles, tileIndex.tiles, minCount);
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
  variationSeed,
}) {
  if (!rankedCandidates.length) {
    return null;
  }

  const topCohortContext = getTopCohortContext(usageCounts, usagePolicy);
  const scoredCandidates = rankedCandidates
    .map((candidate) => {
      const repetition = avoidRepeat
        ? scoreRepetition(candidate.tile.id, placements, index, columns)
        : EMPTY_REPETITION_SCORE;
      const usage = scoreGlobalUsage(candidate.tile.id, usageCounts, usagePolicy);
      const neighborhoodDominance = scoreNeighborhoodDominance(
        candidate.tile,
        usageCounts,
        usagePolicy,
      );
      const neighborhoodSaturation = scoreNeighborhoodSaturation(
        candidate.tile,
        usageCounts,
        usagePolicy,
      );
      const topCohortPressure = scoreTopCohortPressure(
        candidate.tile.id,
        usageCounts,
        usagePolicy,
        topCohortContext,
      );
      const extremeLightSpread = scoreExtremeLightSpread(
        candidate.tile.id,
        extremeLightRowUsageCounts,
        row,
        cell,
      );
      const variationPenalty = scoreCandidateVariation(candidate.tile, cell, variationSeed);

      return {
        ...candidate,
        ...repetition,
        ...usage,
        repetitionPenalty: repetition.penalty,
        usagePenalty: usage.penalty,
        neighborhoodDominancePenalty: neighborhoodDominance.penalty,
        neighborhoodSaturationPenalty: neighborhoodSaturation.penalty,
        topCohortPressurePenalty: topCohortPressure,
        neighborhoodAverageUsage: neighborhoodDominance.averageSimilarUsage ?? 0,
        extremeLightSpreadPenalty: extremeLightSpread,
        variationPenalty,
        totalScore:
          candidate.baseScore +
          repetition.penalty +
          usage.penalty +
          neighborhoodDominance.penalty +
          neighborhoodSaturation.penalty +
          topCohortPressure +
          extremeLightSpread +
          variationPenalty,
      };
    })
    .sort((left, right) => left.totalScore - right.totalScore);

  const hasImmediateRepeatFreeCandidate =
    avoidRepeat && scoredCandidates.some((candidate) => !candidate.hasImmediateRepeat);
  const viableCandidates = hasImmediateRepeatFreeCandidate
    ? scoredCandidates.filter((candidate) => !candidate.hasImmediateRepeat)
    : scoredCandidates;
  const selectionPool = applyUsageCapGuard(viableCandidates);
  const shortlist = selectionPool.slice(0, getShortlistSize(cell));

  if (shortlist.length <= 1) {
    return shortlist[0]?.tile ?? null;
  }

  const rawBaseCandidate = pickLowestBaseScoreCandidate(selectionPool);
  const weightedSelection = chooseWeightedCandidate(shortlist, random);
  const baseTemperature = computeBaseSelectionTemperature(shortlist);
  const chosenCandidate = applyFidelityEscapeHatch({
    rawBaseCandidate,
    diversifiedCandidate: weightedSelection.candidate,
    temperature: weightedSelection.temperature,
    baseTemperature,
    topCohortContext,
  });

  return chosenCandidate?.tile ?? shortlist[0].tile;
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

function scoreNeighborhoodDominance(tile, usageCounts, usagePolicy) {
  const similarIds = Array.isArray(tile?.similarIds) ? tile.similarIds : [];
  const nextCount = (usageCounts.get(tile?.id) ?? 0) + 1;

  if (similarIds.length <= 1) {
    return {
      penalty: 0,
      nextCount,
    };
  }

  let similarCount = 0;
  let totalSimilarUsage = 0;

  for (const similarId of similarIds) {
    if (!similarId || similarId === tile.id) {
      continue;
    }

    totalSimilarUsage += usageCounts.get(similarId) ?? 0;
    similarCount += 1;
  }

  if (!similarCount) {
    return {
      penalty: 0,
      nextCount,
    };
  }

  const averageSimilarUsage = totalSimilarUsage / similarCount;
  const overage = nextCount - (averageSimilarUsage + NEIGHBORHOOD_DOMINANCE_BUFFER);

  if (overage <= 0) {
    return {
      penalty: 0,
      nextCount,
      averageSimilarUsage,
    };
  }

  const progress = Math.min(1, overage / usagePolicy.neighborhoodDominanceRange);
  return {
    penalty: progress * progress * NEIGHBORHOOD_DOMINANCE_PENALTY_AT_CAP,
    nextCount,
    averageSimilarUsage,
  };
}

function scoreNeighborhoodSaturation(tile, usageCounts, usagePolicy) {
  const similarIds = Array.isArray(tile?.similarIds) ? tile.similarIds : [];
  if (!similarIds.length) {
    return {
      penalty: 0,
    };
  }

  let totalNeighborhoodUsage = 0;

  for (const similarId of similarIds) {
    totalNeighborhoodUsage += usageCounts.get(similarId) ?? 0;
  }

  if (similarIds.includes(tile.id)) {
    totalNeighborhoodUsage += 1;
  }

  const averageNeighborhoodUsage = totalNeighborhoodUsage / similarIds.length;
  if (averageNeighborhoodUsage <= usagePolicy.neighborhoodSaturationSoftLimit) {
    return {
      penalty: 0,
      averageNeighborhoodUsage,
    };
  }

  const progress = Math.min(
    1,
    (averageNeighborhoodUsage - usagePolicy.neighborhoodSaturationSoftLimit) /
      usagePolicy.neighborhoodSaturationRange,
  );

  return {
    penalty: progress * progress * NEIGHBORHOOD_SATURATION_PENALTY_AT_CAP,
    averageNeighborhoodUsage,
  };
}

function scoreTopCohortPressure(tileId, usageCounts, usagePolicy, topCohortContext) {
  if (!topCohortContext.active) {
    return 0;
  }

  const nextCount = (usageCounts.get(tileId) ?? 0) + 1;
  if (nextCount <= topCohortContext.floor) {
    return 0;
  }

  const progress = Math.min(
    1,
    (nextCount - topCohortContext.floor) / usagePolicy.topCohortRange,
  );
  return progress * progress * TOP_COHORT_PENALTY_AT_CAP;
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

function gatherTilesFromBucketNeighborhood(bucketKey, tileIndex, { minCount, maxRadius }) {
  const direct = tileIndex.bucketMap.get(bucketKey);
  if (direct?.length >= minCount) {
    return dedupeTilesById(direct);
  }

  const [bucketR, bucketG, bucketB] = parseBucket(bucketKey);
  const seenBuckets = new Set();
  const pool = [];

  for (let radius = 0; radius <= maxRadius && pool.length < minCount; radius += 1) {
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

function buildSimilarIds(tile, { bucketMap, quantizationStep, tiles }) {
  const neighborhoodTarget = getSimilarNeighborhoodTarget(tile);
  const directBucketTiles = dedupeTilesById(bucketMap.get(tile.bucket) ?? []);
  const neighborhoodTiles =
    directBucketTiles.length >= neighborhoodTarget
      ? directBucketTiles
      : gatherTilesFromBucketNeighborhood(
          tile.bucket,
          {
            bucketMap,
            quantizationStep,
          },
          {
            minCount: neighborhoodTarget,
            maxRadius: SIMILAR_NEIGHBORHOOD_MAX_RADIUS,
          },
        );
  const seenIds = new Set(neighborhoodTiles.map((candidate) => candidate.id));
  const candidateTiles = [...neighborhoodTiles];

  if (seenIds.size < neighborhoodTarget) {
    const nearestTiles = rankTilesBySimilarity(
      tile,
      tiles.filter((candidate) => !seenIds.has(candidate.id)),
      SIMILAR_NEIGHBORHOOD_LUMA_WEIGHT,
    ).slice(0, neighborhoodTarget - seenIds.size);

    for (const candidate of nearestTiles) {
      seenIds.add(candidate.id);
      candidateTiles.push(candidate);
    }
  }

  return rankTilesBySimilarity(tile, candidateTiles, SIMILAR_NEIGHBORHOOD_LUMA_WEIGHT)
    .slice(0, neighborhoodTarget)
    .map((candidate) => candidate.id);
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

function isDarkCell(cell) {
  return (cell?.luma ?? Number.POSITIVE_INFINITY) <= DARK_CELL_LUMA_THRESHOLD;
}

function isDarkCandidateTile(tile) {
  return (tile?.luma ?? Number.POSITIVE_INFINITY) <= DARK_CANDIDATE_LUMA_THRESHOLD;
}

function getShortlistSize(cell) {
  return isDarkCell(cell) ? DARK_CELL_SHORTLIST_SIZE : DEFAULT_SHORTLIST_SIZE;
}

function getSimilarNeighborhoodTarget(tile) {
  return isDarkCandidateTile(tile)
    ? DARK_SIMILAR_NEIGHBORHOOD_TARGET
    : SIMILAR_NEIGHBORHOOD_TARGET;
}

function rankTilesBySimilarity(sourceTile, candidateTiles, lumaWeight) {
  return dedupeTilesById(candidateTiles)
    .map((tile) => ({
      tile,
      distance: scoreTileToTile(sourceTile, tile, lumaWeight),
    }))
    .sort((left, right) => left.distance - right.distance)
    .map((entry) => entry.tile);
}

function fillCandidatePoolFromBucketReference(bucketKey, candidateTiles, tiles, minCount) {
  const [r, g, b] = parseBucket(bucketKey);
  const bucketReference = {
    avg_r: r,
    avg_g: g,
    avg_b: b,
    luma: computeBucketLuma(r, g, b),
  };
  const seenIds = new Set(candidateTiles.map((tile) => tile.id));
  const nearestTiles = rankTilesBySimilarity(
    bucketReference,
    tiles.filter((tile) => !seenIds.has(tile.id)),
    SIMILAR_NEIGHBORHOOD_LUMA_WEIGHT,
  ).slice(0, Math.max(0, minCount - candidateTiles.length));

  return dedupeTilesById([...candidateTiles, ...nearestTiles]);
}

function computeBucketLuma(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function scoreCandidateVariation(tile, cell, variationSeed) {
  if (!isDarkCell(cell) || !isDarkCandidateTile(tile)) {
    return 0;
  }

  return seededVariationUnit(tile.id, variationSeed) * DARK_CELL_VARIATION_PENALTY;
}

function seededVariationUnit(value, variationSeed) {
  const hash = hashValueWithSeed(value, variationSeed);
  return ((hash / 0xffffffff) - 0.5) * 2;
}

function chooseWeightedCandidate(candidates, random) {
  const temperature = computeSelectionTemperature(candidates);

  let totalWeight = 0;
  const weightedCandidates = candidates.map((candidate) => {
    const weight = Math.exp(-(candidate.totalScore - (candidates[0]?.totalScore ?? 0)) / temperature);
    totalWeight += weight;
    return {
      candidate,
      weight,
    };
  });

  if (totalWeight <= 0) {
    return {
      candidate: candidates[0] ?? null,
      temperature,
    };
  }

  let threshold = random() * totalWeight;
  for (const entry of weightedCandidates) {
    threshold -= entry.weight;
    if (threshold <= 0) {
      return {
        candidate: entry.candidate,
        temperature,
      };
    }
  }

  return {
    candidate: weightedCandidates[weightedCandidates.length - 1]?.candidate ?? candidates[0] ?? null,
    temperature,
  };
}

function computeSelectionTemperature(candidates) {
  const bestTotal = candidates[0]?.totalScore ?? 0;
  const spread = (candidates[candidates.length - 1]?.totalScore ?? bestTotal) - bestTotal;
  return Math.max(
    MIN_SELECTION_TEMPERATURE,
    spread * SELECTION_TEMPERATURE_FACTOR,
  );
}

function computeBaseSelectionTemperature(candidates) {
  const closestByBase = [...candidates]
    .sort((left, right) => left.baseScore - right.baseScore)
    .slice(0, FIDELITY_BASELINE_CANDIDATES);
  const bestBase = closestByBase[0]?.baseScore ?? 0;
  const spread = (closestByBase[closestByBase.length - 1]?.baseScore ?? bestBase) - bestBase;
  return Math.max(
    MIN_SELECTION_TEMPERATURE,
    spread * SELECTION_TEMPERATURE_FACTOR,
  );
}

function pickLowestBaseScoreCandidate(candidates) {
  if (!candidates.length) {
    return null;
  }

  return candidates.reduce((best, candidate) =>
    candidate.baseScore < best.baseScore ? candidate : best,
  );
}

function applyFidelityEscapeHatch({
  rawBaseCandidate,
  diversifiedCandidate,
  temperature,
  baseTemperature,
  topCohortContext,
}) {
  if (!diversifiedCandidate) {
    return rawBaseCandidate ?? null;
  }

  if (!rawBaseCandidate || rawBaseCandidate.tile.id === diversifiedCandidate.tile.id) {
    return diversifiedCandidate;
  }

  if (rawBaseCandidate.hasImmediateRepeat) {
    return diversifiedCandidate;
  }

  if (rawBaseCandidate.exceedsUsageCap) {
    return diversifiedCandidate;
  }

  const baseScoreGap = diversifiedCandidate.baseScore - rawBaseCandidate.baseScore;
  const rawCandidateHasNeighborhoodLead =
    rawBaseCandidate.nextCount >
    (rawBaseCandidate.neighborhoodAverageUsage ?? 0) + FIDELITY_NEIGHBORHOOD_LEAD_BUFFER;
  const rawCandidateHasTopCohortLead =
    topCohortContext?.active &&
    rawBaseCandidate.nextCount > topCohortContext.floor + FIDELITY_TOP_COHORT_LEAD_BUFFER;
  const rawCandidateHasCrownPressure =
    rawCandidateHasNeighborhoodLead || rawCandidateHasTopCohortLead;
  const fidelityMultiplier = rawCandidateHasCrownPressure
    ? FIDELITY_ESCAPE_HATCH_MULTIPLIER * 2
    : FIDELITY_ESCAPE_HATCH_MULTIPLIER;
  const fidelityTemperature = Math.min(temperature, baseTemperature);

  if (baseScoreGap > fidelityTemperature * fidelityMultiplier) {
    return rawBaseCandidate;
  }

  return diversifiedCandidate;
}

function scoreTileToTile(sourceTile, candidateTile, lumaWeight) {
  const dr = sourceTile.avg_r - candidateTile.avg_r;
  const dg = sourceTile.avg_g - candidateTile.avg_g;
  const db = sourceTile.avg_b - candidateTile.avg_b;
  const dl = sourceTile.luma - candidateTile.luma;
  return dr * dr + dg * dg + db * db + lumaWeight * dl * dl;
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

function hashValueWithSeed(value, seed) {
  let hash = 2166136261 ^ ((Number(seed) || 0) >>> 0);
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

function createUsagePolicy(totalTiles) {
  const softLimit = Math.floor(totalTiles * SOFT_USAGE_RATIO);
  const hardLimit = Math.min(totalTiles, Math.floor(totalTiles * HARD_USAGE_CAP_RATIO));
  const neighborhoodSaturationSoftLimit = Math.max(
    1,
    Math.floor(totalTiles * NEIGHBORHOOD_SATURATION_SOFT_RATIO),
  );
  const topCohortStart = Math.max(
    TOP_COHORT_START_MIN,
    Math.floor(totalTiles * TOP_COHORT_START_RATIO),
  );

  return {
    softLimit,
    hardLimit,
    topCohortSize: TOP_COHORT_SIZE,
    topCohortStart,
    topCohortRange: Math.max(
      TOP_COHORT_RANGE_MIN,
      Math.ceil(softLimit * TOP_COHORT_RANGE_FACTOR),
    ),
    neighborhoodDominanceRange: Math.max(
      NEIGHBORHOOD_DOMINANCE_MIN_RANGE,
      Math.ceil(softLimit * NEIGHBORHOOD_DOMINANCE_RANGE_FACTOR),
    ),
    neighborhoodSaturationSoftLimit,
    neighborhoodSaturationRange: Math.max(
      NEIGHBORHOOD_SATURATION_MIN_RANGE,
      softLimit - neighborhoodSaturationSoftLimit,
    ),
  };
}

function getTopCohortContext(usageCounts, usagePolicy) {
  const topCounts = [];
  const cohortSize = usagePolicy.topCohortSize;

  for (const count of usageCounts.values()) {
    if (topCounts.length < cohortSize) {
      topCounts.push(count);
      topCounts.sort((left, right) => right - left);
      continue;
    }

    if (count <= topCounts[topCounts.length - 1]) {
      continue;
    }

    topCounts.push(count);
    topCounts.sort((left, right) => right - left);
    topCounts.length = cohortSize;
  }

  const floor = topCounts[cohortSize - 1] ?? 0;
  return {
    active: topCounts.length >= cohortSize && floor >= usagePolicy.topCohortStart,
    floor,
  };
}

function yieldToBrowser() {
  const requestFrame =
    typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null;

  if (!requestFrame) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    requestFrame(() => resolve());
  });
}

const EMPTY_REPETITION_SCORE = {
  penalty: 0,
  hasImmediateRepeat: false,
};
