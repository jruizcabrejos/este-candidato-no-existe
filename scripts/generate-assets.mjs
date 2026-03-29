import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output");
const FILTERED_DIR = path.join(OUTPUT_DIR, "average_faces", "filtered");
const ALBUM_EXPORT_DIR = path.join(OUTPUT_DIR, "album_export");
const PUBLIC_GENERATED_DIR = path.join(ROOT, "public", "generated");
const SRC_GENERATED_DIR = path.join(ROOT, "src", "generated");
const COMPOSITES_DIR = path.join(PUBLIC_GENERATED_DIR, "composites");
const BACKGROUND_DIR = path.join(PUBLIC_GENERATED_DIR, "background");
const MOSAIC_DIR = path.join(PUBLIC_GENERATED_DIR, "mosaic");
const PARTY_LOGOS_DIR = path.join(PUBLIC_GENERATED_DIR, "party-logos");
const REGION_SHAPES_DIR = path.join(PUBLIC_GENERATED_DIR, "region-shapes");
const STORY_MANIFEST_PATH = path.join(SRC_GENERATED_DIR, "story_manifest.json");
const BACKGROUND_MANIFEST_PATH = path.join(SRC_GENERATED_DIR, "background_manifest.json");
const MOSAIC_METADATA_PATH = path.join(MOSAIC_DIR, "tiles.json");
const MOSAIC_ATLAS_PATH = path.join(MOSAIC_DIR, "atlas.webp");
const REGION_SHAPES_SOURCE_PATH = path.join(ROOT, "gadm41_PER_1.json");
const GROUP_MANIFEST_PATH = path.join(
  OUTPUT_DIR,
  "average_faces",
  "manifests",
  "group_manifest.csv",
);
const PARTY_MANIFEST_PATH = path.join(
  ALBUM_EXPORT_DIR,
  "manifests",
  "party_manifest.csv",
);
const CANDIDATES_PATH = path.join(ALBUM_EXPORT_DIR, "candidates.json");

const TILE_WIDTH = 48;
const TILE_HEIGHT = 72;
const ATLAS_COLUMNS = 48;
const MOSAIC_ANALYSIS_SIZE = 50;
const MOSAIC_RENDER_SIZE = 20;
const MOSAIC_SAMPLE_RATIO = 0.6;
const MOSAIC_BLUR = 0.8;
const MOSAIC_BUCKET_STEP = 16;
const MOSAIC_ATLAS_COLUMNS = 48;
const SHUFFLE_SEED = 20260326;
const STORY_MANIFEST_VERSION = 4;
const MOSAIC_METADATA_VERSION = 2;
const SOURCE_FINGERPRINT_VERSION = 2;
const REGION_SHAPE_SIZE = 96;
const REGION_SHAPE_PADDING = 6;
const REGION_SHAPE_EPSILON = 0.000001;
const ABROAD_REGION_SLUG = "peruanos-residentes-en-el-extranjero";
const SEX_LABELS = {
  male: "Hombres",
  female: "Mujeres",
};
const SEX_ORDER = {
  male: 0,
  female: 1,
};
const REGION_SLUG_ALIASES = {
  lalibertad: "la-libertad",
  lima: "lima-metropolitana",
  limaprovince: "lima-provincias",
  madrededios: "madre-de-dios",
  sanmartin: "san-martin",
};

async function main() {
  await ensureInternalDatasetAvailable();

  const candidates = JSON.parse(await fs.readFile(CANDIDATES_PATH, "utf8"));
  if (!candidates.length) {
    throw new Error("No candidates were found in output/album_export/candidates.json.");
  }
  const backgroundAtlasLayout = buildBackgroundAtlasLayout(candidates.length);

  const [groupManifestRows, partyManifestRows] = await Promise.all([
    readCsv(GROUP_MANIFEST_PATH),
    readCsv(PARTY_MANIFEST_PATH),
  ]);
  const sourceFingerprint = await buildSourceFingerprint(candidates);
  const assetVersion = sourceFingerprint.slice(0, 12);

  const regionLabelMap = buildLabelMapFromCandidates(candidates, "region");
  const partyLabelMap = buildLabelMapFromCandidates(candidates, "party");
  const partyLogoSourceMap = new Map();
  for (const row of partyManifestRows) {
    if (row.party_slug && row.party) {
      partyLabelMap.set(row.party_slug, row.party);
    }
    if (row.party_slug && row.url_logo_partido) {
      partyLogoSourceMap.set(row.party_slug, row.url_logo_partido);
    }
  }

  const regionCounts = countBySlug(candidates, "region");
  const partyCounts = countBySlug(candidates, "party");
  const renderedRows = groupManifestRows.filter(
    (row) => row.blend_mode === "filtered" && row.rendered === "TRUE",
  );
  const regionRows = renderedRows
    .filter((row) => row.group_mode === "region")
    .sort((a, b) => compareRegionRows(a, b, regionLabelMap));
  const sexRows = renderedRows
    .filter((row) => row.group_mode === "sex")
    .sort((a, b) => (SEX_ORDER[a.group_key] ?? 99) - (SEX_ORDER[b.group_key] ?? 99));
  const regionSexRows = renderedRows
    .filter((row) => row.group_mode === "region_sex")
    .sort((a, b) => {
      const sexOrderDifference =
        (SEX_ORDER[a.sex_assigned] ?? 99) - (SEX_ORDER[b.sex_assigned] ?? 99);
      if (sexOrderDifference !== 0) {
        return sexOrderDifference;
      }

      return compareLabels(regionLabelMap.get(a.region_slug), regionLabelMap.get(b.region_slug));
    });
  const partyRows = renderedRows
    .filter((row) => row.group_mode === "affiliation")
    .sort((a, b) => compareLabels(partyLabelMap.get(a.group_key), partyLabelMap.get(b.group_key)));

  if (
    !(await shouldRegenerate({
      expectedSummary: {
        totalPortraits: candidates.length,
        sexCount: sexRows.length,
        regionCount: regionRows.length,
        partyCount: partyRows.length,
      },
      expectedBackgroundAtlas: backgroundAtlasLayout,
      sourceFingerprint,
    }))
  ) {
    console.log("Generated assets already match the current dataset. Skipping regeneration.");
    return;
  }

  await Promise.all([
    fs.rm(COMPOSITES_DIR, { recursive: true, force: true }),
    fs.rm(BACKGROUND_DIR, { recursive: true, force: true }),
    fs.rm(MOSAIC_DIR, { recursive: true, force: true }),
    fs.rm(REGION_SHAPES_DIR, { recursive: true, force: true }),
  ]);
  await fs.mkdir(COMPOSITES_DIR, { recursive: true });
  await fs.mkdir(BACKGROUND_DIR, { recursive: true });
  await fs.mkdir(MOSAIC_DIR, { recursive: true });
  await fs.mkdir(PARTY_LOGOS_DIR, { recursive: true });
  await fs.mkdir(REGION_SHAPES_DIR, { recursive: true });
  await fs.mkdir(SRC_GENERATED_DIR, { recursive: true });

  const heroSource = transparentAverageFacePath("all");
  const heroAssetPath = path.join(COMPOSITES_DIR, "hero.webp");
  await optimizeComposite(heroSource, heroAssetPath, 1200);

  const partyLogoAssetMap = await buildPartyLogoAssets(partyManifestRows, partyLogoSourceMap);
  const regionShapeAssetMap = await buildRegionShapeAssets();

  const sexes = await Promise.all(
    sexRows.map((row) =>
      buildCompositeEntry({
        slug: row.group_key,
        label:
          SEX_LABELS[row.group_key] ??
          titleize((row.group_label ?? row.group_key).replace(/_/g, " ")),
        sourcePath: transparentAverageFacePath("by_sex", row.group_key),
        targetPath: path.join(COMPOSITES_DIR, "sexes", `${row.group_key}.webp`),
        assetUrl: withAssetVersion(
          `/generated/composites/sexes/${row.group_key}.webp`,
          assetVersion,
        ),
        count: Number(row.discovered_count) || Number(row.eligible_count) || 0,
      }),
    ),
  );
  const sexesBySlug = new Map(sexes.map((entry) => [entry.slug, entry]));
  const regionSexRowsByKey = new Map(
    regionSexRows.map((row) => [`${row.sex_assigned}::${row.region_slug}`, row]),
  );

  const regions = await Promise.all(
    regionRows.map((row) =>
      buildCompositeEntry({
        slug: row.group_key,
        label: regionLabelMap.get(row.group_key) ?? titleize(row.group_label ?? row.group_key),
        sourcePath: transparentAverageFacePath("by_region", row.group_key),
        targetPath: path.join(COMPOSITES_DIR, "regions", `${row.group_key}.webp`),
        assetUrl: withAssetVersion(
          `/generated/composites/regions/${row.group_key}.webp`,
          assetVersion,
        ),
        count: regionCounts.get(row.group_key) ?? Number(row.discovered_count) ?? 0,
        extra: {
          shapeUrl: regionShapeAssetMap.get(row.group_key) ?? "",
        },
      }),
    ),
  );
  const regionsBySex = await Promise.all(
    sexRows.map(async (row) => {
      const overall = sexesBySlug.get(row.group_key);

      return {
        slug: row.group_key,
        label:
          SEX_LABELS[row.group_key] ??
          titleize((row.group_label ?? row.group_key).replace(/_/g, " ")),
        overall: {
          ...overall,
          percentage: roundPercentage((overall?.portraitCount ?? 0) / candidates.length),
        },
        regions: await Promise.all(
          regionRows.map((regionRow) => {
            const regionSexRow = regionSexRowsByKey.get(
              `${row.group_key}::${regionRow.group_key}`,
            );
            const regionSlug = regionSexRow?.region_slug ?? regionRow.group_key;

            return buildCompositeEntry({
              slug: regionSlug,
              label:
                regionLabelMap.get(regionRow.group_key) ??
                titleize(regionRow.group_label ?? regionRow.group_key),
              sourcePath: transparentAverageFacePath("by_region_sex", regionSlug, row.group_key),
              targetPath: path.join(
                COMPOSITES_DIR,
                "regions-by-sex",
                row.group_key,
                `${regionSlug}.webp`,
              ),
              assetUrl: withAssetVersion(
                `/generated/composites/regions-by-sex/${row.group_key}/${regionSlug}.webp`,
                assetVersion,
              ),
              count: Number(regionSexRow?.discovered_count) || 0,
              extra: {
                shapeUrl:
                  regionShapeAssetMap.get(regionSlug) ??
                  regionShapeAssetMap.get(regionRow.group_key) ??
                  "",
              },
            });
          }),
        ),
      };
    }),
  );

  const parties = await Promise.all(
    partyRows.map((row) =>
      buildCompositeEntry({
        slug: row.group_key,
        label: partyLabelMap.get(row.group_key) ?? titleize(row.group_label ?? row.group_key),
        sourcePath: transparentAverageFacePath("by_affiliation", row.group_key),
        targetPath: path.join(COMPOSITES_DIR, "parties", `${row.group_key}.webp`),
        assetUrl: withAssetVersion(
          `/generated/composites/parties/${row.group_key}.webp`,
          assetVersion,
        ),
        count: partyCounts.get(row.group_key) ?? Number(row.discovered_count) ?? 0,
        extra: {
          logoUrl: partyLogoAssetMap.get(row.group_key) ?? "",
        },
      }),
    ),
  );

  const portraitEntries = candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    party: candidate.party,
    partyLogoUrl: partyLogoAssetMap.get(slugify(candidate.party)) ?? "",
    region: candidate.region,
    absolutePath: path.join(ALBUM_EXPORT_DIR, candidate.portraitImage.replaceAll("/", path.sep)),
  }));
  const shuffledPortraits = seededShuffle([...portraitEntries], SHUFFLE_SEED);
  const atlasUrl = withAssetVersion("/generated/background/portrait-atlas.webp", assetVersion);
  const atlasOutputPath = path.join(BACKGROUND_DIR, "portrait-atlas.webp");
  const fallbackPortraitIds = await buildPortraitAtlas(
    shuffledPortraits,
    atlasOutputPath,
    backgroundAtlasLayout,
  );
  const mosaicSummary = await buildMosaicDataset(portraitEntries, assetVersion);

  const storyManifest = {
    version: STORY_MANIFEST_VERSION,
    sourceFingerprint,
    summary: {
      totalPortraits: candidates.length,
      sexCount: sexes.length,
      regionCount: regions.length,
      districtCount: regions.length,
      partyCount: parties.length,
    },
    hero: {
      label: "Peru 2026",
      assetUrl: withAssetVersion("/generated/composites/hero.webp", assetVersion),
      portraitCount: candidates.length,
    },
    sexes,
    regionsBySex,
    regions,
    parties,
    footnote: "",
  };

  const backgroundManifest = {
    assetVersion,
    sourceFingerprint,
    tileWidth: TILE_WIDTH,
    tileHeight: TILE_HEIGHT,
    columns: backgroundAtlasLayout.columns,
    rows: backgroundAtlasLayout.rows,
    atlasWidth: backgroundAtlasLayout.atlasWidth,
    atlasHeight: backgroundAtlasLayout.atlasHeight,
    atlasUrl,
    speedX: 10,
    speedY: 14,
    portraitIds: shuffledPortraits.map((portrait) => portrait.id),
    fallbackPortraitIds,
  };

  await Promise.all([
    fs.writeFile(STORY_MANIFEST_PATH, JSON.stringify(storyManifest, null, 2), "utf8"),
    fs.writeFile(
      BACKGROUND_MANIFEST_PATH,
      JSON.stringify(backgroundManifest, null, 2),
      "utf8",
    ),
  ]);

  console.log(
    `Generated story manifest with ${sexes.length} sex groups, ${regions.length} regions, ${regionsBySex.length} region-by-sex groups, ${parties.length} parties, ${candidates.length} portraits, and ${mosaicSummary.tileCount} mosaic tiles.`,
  );
}

async function buildCompositeEntry({ slug, label, sourcePath, targetPath, assetUrl, count, extra = {} }) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await optimizeComposite(sourcePath, targetPath, 700);

  return {
    slug,
    label,
    portraitCount: count,
    assetUrl,
    ...extra,
  };
}

async function optimizeComposite(sourcePath, targetPath, maxWidth) {
  await ensureExists(sourcePath);
  await sharp(sourcePath)
    .resize({
      width: maxWidth,
      height: maxWidth,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 88, alphaQuality: 100, effort: 4 })
    .toFile(targetPath);
}

function transparentAverageFacePath(...parts) {
  const pathParts = [...parts];
  const baseName = pathParts.pop();
  return path.join(FILTERED_DIR, ...pathParts, `${baseName}_transparent.png`);
}

async function buildPortraitAtlas(entries, outputPath, layout) {
  console.log(`Building portrait atlas from ${entries.length} candidate portraits...`);
  const fallbackPortraitIds = [];

  const composites = await mapLimit(entries, 12, async (entry, index) => {
    const left = (index % layout.columns) * TILE_WIDTH;
    const top = Math.floor(index / layout.columns) * TILE_HEIGHT;
    const { input, usedFallback } = await buildTileBuffer(entry);
    if (usedFallback) {
      fallbackPortraitIds.push(entry.id);
    }

    if ((index + 1) % 288 === 0 || index + 1 === entries.length) {
      console.log(`Processed ${index + 1}/${entries.length} portrait tiles...`);
    }

    return {
      input,
      left,
      top,
    };
  });

  await sharp({
    create: {
      width: layout.atlasWidth,
      height: layout.atlasHeight,
      channels: 3,
      background: "#14090c",
    },
  })
    .composite(composites)
    .webp({ quality: 72, effort: 5 })
    .toFile(outputPath);

  return fallbackPortraitIds.sort((left, right) => left.localeCompare(right));
}

async function buildMosaicDataset(entries, assetVersion) {
  const atlasRows = Math.ceil(entries.length / MOSAIC_ATLAS_COLUMNS);
  const atlasWidth = MOSAIC_ATLAS_COLUMNS * MOSAIC_RENDER_SIZE;
  const atlasHeight = atlasRows * MOSAIC_RENDER_SIZE;
  const tileEntries = [];

  console.log(`Building mosaic atlas from ${entries.length} candidate portraits...`);

  const composites = await mapLimit(entries, 12, async (entry, index) => {
    const column = index % MOSAIC_ATLAS_COLUMNS;
    const row = Math.floor(index / MOSAIC_ATLAS_COLUMNS);
    const left = column * MOSAIC_RENDER_SIZE;
    const top = row * MOSAIC_RENDER_SIZE;
    const { renderBuffer, averageColor } = await buildMosaicTile(entry);

    tileEntries[index] = {
      id: entry.id,
      name: entry.name,
      party: entry.party,
      partyLogoUrl: entry.partyLogoUrl,
      region: entry.region,
      avg_r: averageColor.r,
      avg_g: averageColor.g,
      avg_b: averageColor.b,
      luma: averageColor.luma,
      bucket: averageColor.bucket,
      x: left,
      y: top,
      width: MOSAIC_RENDER_SIZE,
      height: MOSAIC_RENDER_SIZE,
    };

    if ((index + 1) % 288 === 0 || index + 1 === entries.length) {
      console.log(`Processed ${index + 1}/${entries.length} mosaic tiles...`);
    }

    return {
      input: renderBuffer,
      left,
      top,
    };
  });

  await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 3,
      background: "#14090c",
    },
  })
    .composite(composites)
    .webp({ quality: 78, effort: 5 })
    .toFile(MOSAIC_ATLAS_PATH);

  const metadata = {
    version: MOSAIC_METADATA_VERSION,
    generatedAt: new Date().toISOString(),
    analysisSize: MOSAIC_ANALYSIS_SIZE,
    renderSize: MOSAIC_RENDER_SIZE,
    sampleRatio: MOSAIC_SAMPLE_RATIO,
    blur: MOSAIC_BLUR,
    quantizationStep: MOSAIC_BUCKET_STEP,
    atlas: {
      url: withAssetVersion("/generated/mosaic/atlas.webp", assetVersion),
      width: atlasWidth,
      height: atlasHeight,
      columns: MOSAIC_ATLAS_COLUMNS,
      rows: atlasRows,
    },
    summary: {
      tileCount: tileEntries.length,
      regionCount: new Set(entries.map((entry) => slugify(entry.region))).size,
      partyCount: new Set(entries.map((entry) => slugify(entry.party))).size,
    },
    tiles: tileEntries,
  };

  await fs.writeFile(MOSAIC_METADATA_PATH, JSON.stringify(metadata, null, 2), "utf8");

  return metadata.summary;
}

async function buildPartyLogoAssets(partyManifestRows, partyLogoSourceMap) {
  const uniqueRows = [];
  const seen = new Set();

  for (const row of partyManifestRows) {
    if (!row.party_slug || !partyLogoSourceMap.get(row.party_slug) || seen.has(row.party_slug)) {
      continue;
    }

    seen.add(row.party_slug);
    uniqueRows.push(row);
  }

  if (!uniqueRows.length) {
    return new Map();
  }

  console.log(`Fetching ${uniqueRows.length} party logos for local use...`);
  const assetMap = new Map();

  await mapLimit(uniqueRows, 6, async (row) => {
    const assetUrl = await buildPartyLogoAsset(row.party_slug, partyLogoSourceMap.get(row.party_slug));
    if (assetUrl) {
      assetMap.set(row.party_slug, assetUrl);
    }
  });

  if (!assetMap.size) {
    throw new Error("Could not fetch any party logos for the local mosaic dataset.");
  }

  return assetMap;
}

async function buildPartyLogoAsset(slug, sourceUrl) {
  if (!slug) {
    return "";
  }

  const existingAssetUrl = await findExistingPartyLogoAsset(slug);
  if (existingAssetUrl) {
    return existingAssetUrl;
  }

  if (!sourceUrl) {
    return "";
  }

  const targetPath = path.join(PARTY_LOGOS_DIR, `${slug}.webp`);

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent": "candidato2026-asset-generator/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    if (!buffer.length) {
      throw new Error("Empty image response.");
    }

    try {
      await sharp(buffer)
        .resize({
          width: 160,
          height: 160,
          fit: "contain",
          withoutEnlargement: true,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .webp({ quality: 90, effort: 4 })
        .toFile(targetPath);

      return `/generated/party-logos/${slug}.webp`;
    } catch (conversionError) {
      const rawExtension = detectImageExtension(buffer, contentType);
      if (!rawExtension) {
        throw conversionError;
      }

      const rawTargetPath = path.join(PARTY_LOGOS_DIR, `${slug}.${rawExtension}`);
      await fs.writeFile(rawTargetPath, buffer);
      return `/generated/party-logos/${slug}.${rawExtension}`;
    }
  } catch (error) {
    console.warn(`Party logo fallback for ${slug}: ${error.message}`);
    return "";
  }
}

async function findExistingPartyLogoAsset(slug) {
  const extensions = ["webp", "bmp", "png", "jpg", "jpeg", "gif", "svg", "ico"];

  for (const extension of extensions) {
    const targetPath = path.join(PARTY_LOGOS_DIR, `${slug}.${extension}`);

    try {
      await fs.access(targetPath);
      return `/generated/party-logos/${slug}.${extension}`;
    } catch {
      // Keep scanning until we find a local cached asset or exhaust the known extensions.
    }
  }

  return "";
}

async function buildRegionShapeAssets() {
  const source = JSON.parse(await fs.readFile(REGION_SHAPES_SOURCE_PATH, "utf8"));
  const assetMap = new Map();

  for (const feature of source.features ?? []) {
    const sourceSlug = slugify(feature?.properties?.NAME_1 ?? "");
    const slug = REGION_SLUG_ALIASES[sourceSlug] ?? sourceSlug;
    if (!slug || assetMap.has(slug)) {
      continue;
    }

    const svg = buildRegionShapeSvg(feature?.geometry);
    if (!svg) {
      continue;
    }

    const targetPath = path.join(REGION_SHAPES_DIR, `${slug}.svg`);
    await fs.writeFile(targetPath, svg, "utf8");
    assetMap.set(slug, `/generated/region-shapes/${slug}.svg`);
  }

  const abroadTargetPath = path.join(REGION_SHAPES_DIR, `${ABROAD_REGION_SLUG}.svg`);
  await fs.writeFile(abroadTargetPath, buildGlobeShapeSvg(), "utf8");
  assetMap.set(ABROAD_REGION_SLUG, `/generated/region-shapes/${ABROAD_REGION_SLUG}.svg`);

  return assetMap;
}

function buildRegionShapeSvg(geometry) {
  const polygons = extractPolygons(geometry);
  if (!polygons.length) {
    return "";
  }

  const points = polygons.flat(2);
  const bounds = points.reduce(
    (result, [x, y]) => ({
      minX: Math.min(result.minX, x),
      maxX: Math.max(result.maxX, x),
      minY: Math.min(result.minY, y),
      maxY: Math.max(result.maxY, y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );

  const width = Math.max(REGION_SHAPE_EPSILON, bounds.maxX - bounds.minX);
  const height = Math.max(REGION_SHAPE_EPSILON, bounds.maxY - bounds.minY);
  const scale =
    (REGION_SHAPE_SIZE - REGION_SHAPE_PADDING * 2) / Math.max(width, height);
  const offsetX = (REGION_SHAPE_SIZE - width * scale) / 2;
  const offsetY = (REGION_SHAPE_SIZE - height * scale) / 2;

  const pathData = polygons
    .map((polygon) =>
      polygon
        .map((ring) =>
          ring
            .map(([x, y], index) => {
              const px = roundPathValue((x - bounds.minX) * scale + offsetX);
              const py = roundPathValue((bounds.maxY - y) * scale + offsetY);
              return `${index === 0 ? "M" : "L"}${px} ${py}`;
            })
            .join(" "),
        )
        .join(" Z "),
    )
    .join(" Z ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${REGION_SHAPE_SIZE} ${REGION_SHAPE_SIZE}">`,
    `<path fill="#efd0a0" fill-rule="evenodd" d="${pathData} Z" />`,
    "</svg>",
  ].join("");
}

function buildGlobeShapeSvg() {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${REGION_SHAPE_SIZE} ${REGION_SHAPE_SIZE}">`,
    '<g fill="none" stroke="#efd0a0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">',
    `<circle cx="${REGION_SHAPE_SIZE / 2}" cy="${REGION_SHAPE_SIZE / 2}" r="34" />`,
    '<path d="M48 14c10 8 16 20 16 34s-6 26-16 34c-10-8-16-20-16-34s6-26 16-34Z" />',
    '<path d="M18 36c9 5 20 8 30 8s21-3 30-8" />',
    '<path d="M18 60c9-5 20-8 30-8s21 3 30 8" />',
    '<path d="M14 48h68" />',
    "</g>",
    "</svg>",
  ].join("");
}

function extractPolygons(geometry) {
  if (!geometry?.coordinates) {
    return [];
  }

  if (geometry.type === "Polygon") {
    return [geometry.coordinates];
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates;
  }

  return [];
}

function roundPathValue(value) {
  return Number(value.toFixed(2));
}

function detectImageExtension(buffer, contentType) {
  const header = buffer.subarray(0, 16);
  const headerText = buffer.subarray(0, 64).toString("utf8").trimStart();

  if (header[0] === 0xff && header[1] === 0xd8) {
    return "jpg";
  }
  if (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47
  ) {
    return "png";
  }
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
    return "gif";
  }
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return "webp";
  }
  if (header[0] === 0x42 && header[1] === 0x4d) {
    return "bmp";
  }
  if (headerText.startsWith("<svg") || headerText.startsWith("<?xml")) {
    return "svg";
  }
  if (contentType.includes("image/x-icon") || contentType.includes("image/vnd.microsoft.icon")) {
    return "ico";
  }

  return "";
}

async function buildMosaicTile(entry) {
  await ensureExists(entry.absolutePath);

  try {
    const renderBuffer = await sharp(entry.absolutePath)
      .resize(MOSAIC_RENDER_SIZE, MOSAIC_RENDER_SIZE, {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      .removeAlpha()
      .modulate({
        saturation: 0.94,
        brightness: 0.98,
      })
      .webp({ quality: 80, effort: 2 })
      .toBuffer();

    const { data, info } = await sharp(entry.absolutePath)
      .resize(MOSAIC_ANALYSIS_SIZE, MOSAIC_ANALYSIS_SIZE, {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      .removeAlpha()
      .blur(MOSAIC_BLUR)
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      renderBuffer,
      averageColor: computeAverageColor(data, info),
    };
  } catch (error) {
    console.warn(`Fallback mosaic tile generated for ${entry.id}: ${error.message}`);
    const fallback = createFallbackMosaicTile(entry.name);
    const [renderBuffer, analysisBuffer] = await Promise.all([
      fallback.clone().webp({ quality: 80, effort: 2 }).toBuffer(),
      fallback
        .clone()
        .resize(MOSAIC_ANALYSIS_SIZE, MOSAIC_ANALYSIS_SIZE, {
          fit: "cover",
        })
        .blur(MOSAIC_BLUR)
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ]);

    return {
      renderBuffer,
      averageColor: computeAverageColor(analysisBuffer.data, analysisBuffer.info),
    };
  }
}

function buildLabelMapFromCandidates(candidates, key) {
  const map = new Map();
  for (const candidate of candidates) {
    const label = candidate[key];
    if (!label) {
      continue;
    }

    const slug = slugify(label);
    if (!map.has(slug)) {
      map.set(slug, label);
    }
  }
  return map;
}

function countBySlug(candidates, key) {
  const counts = new Map();
  for (const candidate of candidates) {
    const value = candidate[key];
    if (!value) {
      continue;
    }

    const slug = slugify(value);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return counts;
}

async function readCsv(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const rows = parseCsv(source);
  const [headerRow, ...bodyRows] = rows;
  if (!headerRow) {
    return [];
  }

  return bodyRows
    .filter((row) => row.some((value) => value !== ""))
    .map((row) =>
      Object.fromEntries(headerRow.map((header, index) => [header, row[index] ?? ""])),
    );
}

function parseCsv(source) {
  const rows = [];
  let currentRow = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  if (currentValue !== "" || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function titleize(value) {
  return String(value)
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function compareLabels(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), "es");
}

function compareRegionRows(left, right, regionLabelMap) {
  if (left.group_key === ABROAD_REGION_SLUG && right.group_key !== ABROAD_REGION_SLUG) {
    return 1;
  }
  if (right.group_key === ABROAD_REGION_SLUG && left.group_key !== ABROAD_REGION_SLUG) {
    return -1;
  }

  return compareLabels(regionLabelMap.get(left.group_key), regionLabelMap.get(right.group_key));
}

function roundPercentage(value) {
  return Number((value * 100).toFixed(1));
}

function seededShuffle(values, seed) {
  const result = [...values];
  const random = mulberry32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBackgroundAtlasLayout(totalPortraits) {
  const columns = ATLAS_COLUMNS;
  const rows = Math.max(1, Math.ceil(totalPortraits / columns));

  return {
    columns,
    rows,
    atlasWidth: columns * TILE_WIDTH,
    atlasHeight: rows * TILE_HEIGHT,
  };
}

function withAssetVersion(assetUrl, assetVersion) {
  if (!assetVersion) {
    return assetUrl;
  }

  const separator = assetUrl.includes("?") ? "&" : "?";
  return `${assetUrl}${separator}v=${assetVersion}`;
}

async function ensureExists(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Missing required asset: ${filePath}`);
  }
}

async function ensureInternalDatasetAvailable() {
  const requiredInputs = [
    { path: OUTPUT_DIR, label: "output/" },
    { path: FILTERED_DIR, label: "output/average_faces/filtered/" },
    { path: ALBUM_EXPORT_DIR, label: "output/album_export/" },
    { path: CANDIDATES_PATH, label: "output/album_export/candidates.json" },
    { path: GROUP_MANIFEST_PATH, label: "output/average_faces/manifests/group_manifest.csv" },
    { path: PARTY_MANIFEST_PATH, label: "output/album_export/manifests/party_manifest.csv" },
    { path: REGION_SHAPES_SOURCE_PATH, label: "gadm41_PER_1.json" },
  ];
  const missing = [];

  for (const input of requiredInputs) {
    try {
      await fs.access(input.path);
    } catch {
      missing.push(input.label);
    }
  }

  if (!missing.length) {
    return;
  }

  throw new Error(
    [
      "Faltan los insumos internos para regenerar assets.",
      "El repo publico usa los assets ya versionados en public/generated/ y src/generated/ para npm run dev y npm run build.",
      `Para volver a ejecutar npm run generate, restaura estos insumos: ${missing.join(", ")}.`,
    ].join(" "),
  );
}

async function buildTileBuffer(entry) {
  await ensureExists(entry.absolutePath);

  try {
    const input = await sharp(entry.absolutePath)
      .resize(TILE_WIDTH, TILE_HEIGHT, {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      .removeAlpha()
      .modulate({
        saturation: 0.92,
        brightness: 0.98,
      })
      .webp({ quality: 76, effort: 2 })
      .toBuffer();

    return { input, usedFallback: false };
  } catch (error) {
    console.warn(`Fallback tile generated for ${entry.id}: ${error.message}`);
    return {
      input: await createFallbackTile(entry.name).toBuffer(),
      usedFallback: true,
    };
  }
}

function createFallbackTile(name) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${TILE_WIDTH}" height="${TILE_HEIGHT}" viewBox="0 0 ${TILE_WIDTH} ${TILE_HEIGHT}">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#2a0e15" />
          <stop offset="100%" stop-color="#5a1c22" />
        </linearGradient>
      </defs>
      <rect width="${TILE_WIDTH}" height="${TILE_HEIGHT}" rx="6" fill="url(#bg)" />
      <rect x="2" y="2" width="${TILE_WIDTH - 4}" height="${TILE_HEIGHT - 4}" rx="5" fill="none" stroke="rgba(238,220,188,0.35)" />
      <circle cx="${TILE_WIDTH / 2}" cy="${TILE_HEIGHT * 0.31}" r="${TILE_WIDTH * 0.18}" fill="rgba(246,230,207,0.82)" />
      <path d="M ${TILE_WIDTH * 0.22} ${TILE_HEIGHT * 0.84} C ${TILE_WIDTH * 0.26} ${TILE_HEIGHT * 0.61}, ${TILE_WIDTH * 0.74} ${TILE_HEIGHT * 0.61}, ${TILE_WIDTH * 0.78} ${TILE_HEIGHT * 0.84} Z" fill="rgba(246,230,207,0.72)" />
    </svg>
  `;

  return sharp(Buffer.from(svg)).webp({ quality: 80, effort: 2 });
}

function createFallbackMosaicTile(name) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${MOSAIC_RENDER_SIZE}" height="${MOSAIC_RENDER_SIZE}" viewBox="0 0 ${MOSAIC_RENDER_SIZE} ${MOSAIC_RENDER_SIZE}">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#351118" />
          <stop offset="100%" stop-color="#7f2c2d" />
        </linearGradient>
      </defs>
      <rect width="${MOSAIC_RENDER_SIZE}" height="${MOSAIC_RENDER_SIZE}" rx="4" fill="url(#bg)" />
      <rect x="1.5" y="1.5" width="${MOSAIC_RENDER_SIZE - 3}" height="${MOSAIC_RENDER_SIZE - 3}" rx="3" fill="none" stroke="rgba(255,240,214,0.24)" />
      <circle cx="${MOSAIC_RENDER_SIZE / 2}" cy="${MOSAIC_RENDER_SIZE * 0.36}" r="${MOSAIC_RENDER_SIZE * 0.18}" fill="rgba(246,230,207,0.88)" />
      <path d="M ${MOSAIC_RENDER_SIZE * 0.2} ${MOSAIC_RENDER_SIZE * 0.86} C ${MOSAIC_RENDER_SIZE * 0.26} ${MOSAIC_RENDER_SIZE * 0.62}, ${MOSAIC_RENDER_SIZE * 0.74} ${MOSAIC_RENDER_SIZE * 0.62}, ${MOSAIC_RENDER_SIZE * 0.8} ${MOSAIC_RENDER_SIZE * 0.86} Z" fill="rgba(246,230,207,0.76)" />
    </svg>
  `;

  return sharp(Buffer.from(svg));
}

function computeAverageColor(data, info) {
  const sampleWidth = Math.max(1, Math.round(info.width * MOSAIC_SAMPLE_RATIO));
  const sampleHeight = Math.max(1, Math.round(info.height * MOSAIC_SAMPLE_RATIO));
  const startX = Math.max(0, Math.floor((info.width - sampleWidth) / 2));
  const startY = Math.max(0, Math.floor((info.height - sampleHeight) / 2));
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  for (let y = startY; y < startY + sampleHeight; y += 1) {
    for (let x = startX; x < startX + sampleWidth; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      totalR += data[offset];
      totalG += data[offset + 1];
      totalB += data[offset + 2];
      count += 1;
    }
  }

  const r = Math.round(totalR / count);
  const g = Math.round(totalG / count);
  const b = Math.round(totalB / count);
  const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  return {
    r,
    g,
    b,
    luma,
    bucket: [
      quantizeChannel(r, MOSAIC_BUCKET_STEP),
      quantizeChannel(g, MOSAIC_BUCKET_STEP),
      quantizeChannel(b, MOSAIC_BUCKET_STEP),
    ].join("-"),
  };
}

function quantizeChannel(value, step) {
  return Math.max(0, Math.min(255, Math.round(value / step) * step));
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await iteratee(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

async function buildSourceFingerprint(candidates) {
  const hash = crypto.createHash("sha256");
  hash.update(`source-fingerprint:${SOURCE_FINGERPRINT_VERSION}\n`);

  const portraitPaths = candidates.map((candidate) =>
    path.join(ALBUM_EXPORT_DIR, candidate.portraitImage.replaceAll("/", path.sep)),
  );
  const filteredPaths = await listFilesRecursive(FILTERED_DIR);
  const sourcePaths = [
    CANDIDATES_PATH,
    GROUP_MANIFEST_PATH,
    PARTY_MANIFEST_PATH,
    REGION_SHAPES_SOURCE_PATH,
    FILTERED_DIR,
    ...filteredPaths,
    ...portraitPaths,
  ];
  const uniquePaths = [...new Set(sourcePaths)].sort((left, right) =>
    toPosix(path.relative(ROOT, left)).localeCompare(toPosix(path.relative(ROOT, right))),
  );

  for (const filePath of uniquePaths) {
    hash.update(await createStatFingerprint(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function listFilesRecursive(rootPath) {
  const entries = [];

  try {
    const directoryEntries = await fs.readdir(rootPath, { withFileTypes: true });
    directoryEntries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of directoryEntries) {
      const absolutePath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        entries.push(...(await listFilesRecursive(absolutePath)));
      } else if (entry.isFile()) {
        entries.push(absolutePath);
      }
    }
  } catch {
    entries.push(rootPath);
  }

  return entries;
}

async function createStatFingerprint(filePath) {
  const relativePath = toPosix(path.relative(ROOT, filePath));

  try {
    const stats = await fs.stat(filePath);
    return `${relativePath}|${stats.size}|${Math.floor(stats.mtimeMs)}`;
  } catch {
    return `${relativePath}|missing`;
  }
}

async function shouldRegenerate({
  expectedSummary,
  expectedBackgroundAtlas,
  sourceFingerprint,
}) {
  if (process.env.FORCE_GENERATE === "1") {
    return true;
  }

  const requiredPaths = [
    STORY_MANIFEST_PATH,
    BACKGROUND_MANIFEST_PATH,
    MOSAIC_METADATA_PATH,
    MOSAIC_ATLAS_PATH,
    path.join(COMPOSITES_DIR, "hero.webp"),
    path.join(COMPOSITES_DIR, "regions-by-sex"),
    path.join(BACKGROUND_DIR, "portrait-atlas.webp"),
    PARTY_LOGOS_DIR,
    REGION_SHAPES_DIR,
  ];

  try {
    await Promise.all(requiredPaths.map((filePath) => fs.access(filePath)));
  } catch {
    return true;
  }

  try {
    const [storyManifest, backgroundManifest, mosaicMetadata] = await Promise.all([
      fs.readFile(STORY_MANIFEST_PATH, "utf8").then((source) => JSON.parse(source)),
      fs.readFile(BACKGROUND_MANIFEST_PATH, "utf8").then((source) => JSON.parse(source)),
      fs.readFile(MOSAIC_METADATA_PATH, "utf8").then((source) => JSON.parse(source)),
    ]);

    const summaryMatches =
      storyManifest?.version === STORY_MANIFEST_VERSION &&
      storyManifest?.sourceFingerprint === sourceFingerprint &&
      storyManifest?.summary?.totalPortraits === expectedSummary.totalPortraits &&
      storyManifest?.summary?.sexCount === expectedSummary.sexCount &&
      storyManifest?.summary?.regionCount === expectedSummary.regionCount &&
      storyManifest?.summary?.partyCount === expectedSummary.partyCount;
    const storyStructureMatches =
      storyManifest?.hero?.assetUrl?.startsWith("/generated/composites/hero.webp?v=") &&
      Array.isArray(storyManifest?.sexes) &&
      storyManifest.sexes.length === expectedSummary.sexCount &&
      storyManifest.sexes.every((group) =>
        group?.assetUrl?.startsWith("/generated/composites/sexes/") &&
        group?.assetUrl?.includes("?v="),
      ) &&
      Array.isArray(storyManifest?.regionsBySex) &&
      storyManifest.regionsBySex.length === expectedSummary.sexCount &&
      storyManifest.regionsBySex.every(
        (group) =>
          group?.overall?.assetUrl?.startsWith("/generated/composites/sexes/") &&
          group?.overall?.assetUrl?.includes("?v=") &&
          typeof group?.overall?.percentage === "number" &&
          Array.isArray(group?.regions) &&
          group.regions.length === expectedSummary.regionCount &&
          group.regions.every((region) =>
            region?.assetUrl?.startsWith("/generated/composites/regions-by-sex/") &&
            region?.assetUrl?.includes("?v="),
          ),
      ) &&
      Array.isArray(storyManifest?.regions) &&
      storyManifest.regions.length === expectedSummary.regionCount &&
      storyManifest.footnote === "" &&
      storyManifest.regions.at(-1)?.slug === ABROAD_REGION_SLUG &&
      storyManifest.regions.every((region) => region?.assetUrl?.includes("?v=")) &&
      storyManifest.regions.every((region) => region?.shapeUrl?.startsWith("/generated/region-shapes/")) &&
      Array.isArray(storyManifest?.parties) &&
      storyManifest.parties.length === expectedSummary.partyCount &&
      storyManifest.parties.every((party) => party?.assetUrl?.includes("?v="));
    const backgroundMatches =
      Array.isArray(backgroundManifest?.portraitIds) &&
      backgroundManifest.portraitIds.length === expectedSummary.totalPortraits &&
      backgroundManifest.tileWidth === TILE_WIDTH &&
      backgroundManifest.tileHeight === TILE_HEIGHT &&
      backgroundManifest.columns === expectedBackgroundAtlas.columns &&
      backgroundManifest.rows === expectedBackgroundAtlas.rows &&
      backgroundManifest.atlasWidth === expectedBackgroundAtlas.atlasWidth &&
      backgroundManifest.atlasHeight === expectedBackgroundAtlas.atlasHeight;
    const mosaicMatches =
      mosaicMetadata?.version === MOSAIC_METADATA_VERSION &&
      Array.isArray(mosaicMetadata?.tiles) &&
      mosaicMetadata.tiles.length === expectedSummary.totalPortraits &&
      mosaicMetadata.renderSize === MOSAIC_RENDER_SIZE &&
      mosaicMetadata.analysisSize === MOSAIC_ANALYSIS_SIZE &&
      mosaicMetadata.quantizationStep === MOSAIC_BUCKET_STEP &&
      mosaicMetadata.atlas?.columns === MOSAIC_ATLAS_COLUMNS &&
      mosaicMetadata.tiles.some((tile) => tile?.partyLogoUrl?.startsWith("/generated/party-logos/"));

    return !(summaryMatches && storyStructureMatches && backgroundMatches && mosaicMatches);
  } catch {
    return true;
  }
}

function formatCount(value) {
  return new Intl.NumberFormat("es-PE").format(value);
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
