const SHARE_CARD_CONFIG = {
  portrait: {
    label: "Vertical",
    width: 1080,
    height: 1350,
    filename: "mosaico-candidaturas-2026-share-portrait.png",
  },
  square: {
    label: "Cuadrado",
    width: 1080,
    height: 1080,
    filename: "mosaico-candidaturas-2026-share-square.png",
  },
};

const PERCENT_FORMATTER = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const COUNT_FORMATTER = new Intl.NumberFormat("es-PE");
const FOOTER_LOGO_URL = "/favicon/logo.png";

let footerLogoPromise = null;

export const SHARE_CARD_FORMATS = Object.entries(SHARE_CARD_CONFIG).map(([value, config]) => ({
  value,
  ...config,
}));

export function getShareCardFormatConfig(format) {
  return SHARE_CARD_CONFIG[format] ?? SHARE_CARD_CONFIG.portrait;
}

export async function createShareCardAsset({
  mosaicCanvas,
  format = "portrait",
  composition,
  stats,
  websiteUrl,
}) {
  if (!mosaicCanvas) {
    throw new Error("No hay un mosaico renderizado para exportar.");
  }

  if (!composition?.entries?.length) {
    throw new Error("No hay composicion suficiente para armar la tarjeta.");
  }

  const config = getShareCardFormatConfig(format);
  const canvas = document.createElement("canvas");
  canvas.width = config.width;
  canvas.height = config.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo crear la tarjeta para compartir.");
  }

  drawBackdrop(context, canvas.width, canvas.height);
  const footerLogo = await loadFooterLogo();

  if (format === "square") {
    drawSquareCard(context, {
      mosaicCanvas,
      composition,
      stats,
      websiteUrl,
      footerLogo,
      width: canvas.width,
      height: canvas.height,
    });
  } else {
    drawPortraitCard(context, {
      mosaicCanvas,
      composition,
      stats,
      websiteUrl,
      footerLogo,
      width: canvas.width,
      height: canvas.height,
    });
  }

  const blob = await canvasToBlob(canvas, "image/png");
  const file = typeof File === "function"
    ? new File([blob], config.filename, { type: "image/png" })
    : null;

  return {
    blob,
    canvas,
    file,
    filename: config.filename,
    format,
    width: config.width,
    height: config.height,
  };
}

export function downloadBlobFile(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function drawPortraitCard(
  context,
  { mosaicCanvas, composition, stats, websiteUrl, footerLogo, width, height },
) {
  const padding = 72;
  const contentWidth = width - padding * 2;
  const mosaicRect = {
    x: padding,
    y: 192,
    width: contentWidth,
    height: 414,
    radius: 34,
  };
  const rankingRect = {
    x: padding,
    y: 638,
    width: contentWidth,
    height: 432,
    radius: 30,
  };
  const statRectHeight = 98;
  const statGap = 20;
  const statWidth = (contentWidth - statGap) / 2;
  const statY = 1088;
  const footerRect = {
    x: padding,
    y: 1212,
    width: contentWidth,
    height: height - 1212 - padding,
    radius: 26,
  };

  drawHeader(context, {
    eyebrow: "Este candidato no existe",
    title: "Tu foto con los candidatos 2026",
    subtitle: "",
    x: padding,
    y: 82,
    width: contentWidth,
    maxTitleWidth: 780,
    maxTitleLines: 1,
    titleSize: 40,
    titleLineHeight: 44,
    subtitleSize: 18,
    subtitleLineHeight: 22,
    maxSubtitleLines: 1,
    subtitleGap: 6,
  });

  drawFramedMosaic(context, mosaicCanvas, mosaicRect);
  drawRankingPanel(context, rankingRect, composition, {
    title: "Candidatos más frecuentes",
    rowHeight: 42,
    titleSize: 30,
    headerFontSize: 15,
    nameFontSize: 24,
    metaFontSize: 15,
    percentageFontSize: 23,
    rankFontSize: 16,
    showMeta: true,
    metaWidthRatio: 0.27,
    metaShiftX: 2,
    maxRows: 7,
    reserveOthersRow: true,
  });

  drawStatCard(context, {
    x: padding,
    y: statY,
    width: statWidth,
    height: statRectHeight,
    label: "Total de candidatos utilizados",
    value: COUNT_FORMATTER.format(stats?.uniqueTiles ?? 0),
  });
  drawStatCard(context, {
    x: padding + statWidth + statGap,
    y: statY,
    width: statWidth,
    height: statRectHeight,
    label: "Total de imagenes utilizadas",
    value: COUNT_FORMATTER.format(stats?.totalTiles ?? 0),
  });

  drawFooter(context, footerRect, websiteUrl, {
    logo: footerLogo,
  });
}

function drawSquareCard(
  context,
  { mosaicCanvas, composition, stats, websiteUrl, footerLogo, width, height },
) {
  const padding = 56;
  const headerWidth = width - padding * 2;
  const mosaicRect = {
    x: padding,
    y: 180,
    width: 438,
    height: 688,
    radius: 32,
  };
  const sideRect = {
    x: 528,
    y: 180,
    width: width - 528 - padding,
    height: 688,
    radius: 30,
  };
  const footerRect = {
    x: padding,
    y: 904,
    width: width - padding * 2,
    height: height - 904 - padding,
    radius: 24,
  };

  drawHeader(context, {
    eyebrow: "Este candidato no existe",
    title: "Tu foto con los candidatos 2026",
    subtitle: "",
    x: padding,
    y: 74,
    width: headerWidth,
    maxTitleWidth: 860,
    maxTitleLines: 1,
    titleSize: 34,
    titleLineHeight: 38,
    subtitleSize: 18,
    subtitleLineHeight: 22,
    maxSubtitleLines: 1,
    subtitleGap: 6,
  });

  drawFramedMosaic(context, mosaicCanvas, mosaicRect);
  drawRankingPanel(context, sideRect, composition, {
    title: "Candidatos más frecuentes",
    rowHeight: 30,
    titleSize: 24,
    titleLineHeight: 28,
    headerGap: 10,
    listGap: 14,
    headerFontSize: 11,
    nameFontSize: 16,
    metaFontSize: 12,
    percentageFontSize: 17,
    rankFontSize: 13,
    showMeta: true,
    metaWidthRatio: 0.31,
    metaShiftX: -8,
    footerStats: [
      {
        label: "Total de candidatos utilizados",
        value: COUNT_FORMATTER.format(stats?.uniqueTiles ?? 0),
      },
      {
        label: "Total de imagenes utilizadas",
        value: COUNT_FORMATTER.format(stats?.totalTiles ?? 0),
      },
    ],
  });
  drawFooter(context, footerRect, websiteUrl, {
    eyebrow: "Publicalo y explora mas en",
    logo: footerLogo,
  });
}

function drawBackdrop(context, width, height) {
  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#22080d");
  background.addColorStop(0.52, "#120509");
  background.addColorStop(1, "#090304");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const glowLeft = context.createRadialGradient(
    width * 0.18,
    height * 0.16,
    0,
    width * 0.18,
    height * 0.16,
    width * 0.44,
  );
  glowLeft.addColorStop(0, "rgba(201, 141, 71, 0.18)");
  glowLeft.addColorStop(1, "rgba(201, 141, 71, 0)");
  context.fillStyle = glowLeft;
  context.fillRect(0, 0, width, height);

  const glowRight = context.createRadialGradient(
    width * 0.84,
    height * 0.12,
    0,
    width * 0.84,
    height * 0.12,
    width * 0.34,
  );
  glowRight.addColorStop(0, "rgba(163, 53, 44, 0.18)");
  glowRight.addColorStop(1, "rgba(163, 53, 44, 0)");
  context.fillStyle = glowRight;
  context.fillRect(0, 0, width, height);
}

function drawHeader(
  context,
  {
    eyebrow,
    title,
    subtitle,
    x,
    y,
    width,
    maxTitleWidth,
    eyebrowSize = 20,
    eyebrowGap = 14,
    titleSize = 52,
    titleLineHeight = 56,
    maxTitleLines = 2,
    subtitleSize = 24,
    subtitleLineHeight = 30,
    maxSubtitleLines = 2,
    subtitleGap = 10,
  },
) {
  context.save();
  context.textBaseline = "top";

  context.fillStyle = "rgba(239, 208, 160, 0.95)";
  context.font = `700 ${eyebrowSize}px "Source Sans 3", sans-serif`;
  context.fillText(eyebrow.toUpperCase(), x, y);

  const titleY = y + eyebrowSize + eyebrowGap;
  context.fillStyle = "#f6eee1";
  context.font = `700 ${titleSize}px "Cinzel", serif`;
  const titleLines = wrapText(
    context,
    title,
    Math.min(maxTitleWidth ?? width, width),
    maxTitleLines,
  );
  titleLines.forEach((line, index) => {
    context.fillText(line, x, titleY + index * titleLineHeight);
  });

  const subtitleY = titleY + titleLines.length * titleLineHeight + subtitleGap;
  context.fillStyle = "rgba(246, 238, 225, 0.78)";
  context.font = `400 ${subtitleSize}px "Source Sans 3", sans-serif`;
  const subtitleLines = wrapText(context, subtitle, width, maxSubtitleLines);
  subtitleLines.forEach((line, index) => {
    context.fillText(line, x, subtitleY + index * subtitleLineHeight);
  });

  context.restore();
}

function drawFramedMosaic(context, mosaicCanvas, rect) {
  fillPanel(context, rect, {
    fill: "rgba(16, 6, 9, 0.92)",
    stroke: "rgba(239, 208, 160, 0.18)",
  });

  const imageInset = 18;
  const imageRect = {
    x: rect.x + imageInset,
    y: rect.y + imageInset,
    width: rect.width - imageInset * 2,
    height: rect.height - imageInset * 2,
    radius: Math.max(rect.radius - 10, 18),
  };

  context.save();
  roundedRectPath(context, imageRect.x, imageRect.y, imageRect.width, imageRect.height, imageRect.radius);
  context.clip();
  context.fillStyle = "rgba(8, 2, 4, 0.9)";
  context.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  drawContainedImage(context, mosaicCanvas, imageRect);
  context.restore();
}

function drawRankingPanel(context, rect, composition, options) {
  fillPanel(context, rect, {
    fill: "rgba(19, 7, 11, 0.84)",
    stroke: "rgba(239, 208, 160, 0.16)",
  });

  const horizontalPadding = 30;
  const contentX = rect.x + horizontalPadding;
  const contentWidth = rect.width - horizontalPadding * 2;
  const titleY = rect.y + (options.topPadding ?? 24);
  const titleLineHeight = options.titleLineHeight ?? Math.round(options.titleSize * 1.12);
  const titleMaxWidth = Math.min(options.titleMaxWidth ?? contentWidth, contentWidth);
  const headerFontSize = options.headerFontSize ?? 14;
  const headerLineHeight = options.headerLineHeight ?? Math.round(headerFontSize * 1.2);
  const footerStats = options.footerStats ?? [];
  const statsHeight = footerStats.length ? 108 : 0;
  const footerGap = footerStats.length ? 20 : 0;
  const headerGap = options.headerGap ?? 12;
  const listGap = options.listGap ?? 16;
  const rankWidth = 48;
  const percentageWidth = 116;
  const columnGap = 12;
  const metaWidth = options.showMeta
    ? Math.min(Math.max(contentWidth * (options.metaWidthRatio ?? 0.28), 98), 220)
    : 0;
  const nameX = contentX + rankWidth;
  const metaShiftX = options.metaShiftX ?? 0;
  const metaX =
    nameX +
    (contentWidth - rankWidth - percentageWidth - metaWidth - columnGap * 2) +
    columnGap +
    metaShiftX;
  const nameWidth = options.showMeta
    ? contentWidth - rankWidth - percentageWidth - metaWidth - columnGap * 2 + metaShiftX
    : contentWidth - rankWidth - percentageWidth;

  context.save();
  context.textBaseline = "top";
  context.fillStyle = "#f6eee1";
  context.font = `700 ${options.titleSize}px "Cinzel", serif`;
  const titleLines = wrapText(
    context,
    options.title,
    titleMaxWidth,
    options.titleMaxLines ?? 2,
  );
  titleLines.forEach((line, index) => {
    context.fillText(line, contentX, titleY + index * titleLineHeight);
  });

  const headerY = titleY + titleLines.length * titleLineHeight + headerGap;
  const listStartY = headerY + headerLineHeight + listGap;
  const listAvailableHeight = rect.height - (listStartY - rect.y) - statsHeight - footerGap - 24;

  context.fillStyle = "rgba(246, 238, 225, 0.62)";
  context.font = `600 ${headerFontSize}px "Source Sans 3", sans-serif`;
  if (options.showMeta) {
    context.textAlign = "left";
    context.fillText("Region / partido", metaX, headerY);
  }
  context.textAlign = "right";
  context.fillText("Participacion", rect.x + rect.width - horizontalPadding, headerY);
  context.textAlign = "left";
  context.textBaseline = "middle";

  const maxRows = Math.min(
    options.maxRows ?? Number.POSITIVE_INFINITY,
    composition.entries.length,
    Math.floor(listAvailableHeight / options.rowHeight),
  );
  const visibleEntries = getVisibleRankingEntries(composition, maxRows, options);

  for (let index = 0; index < visibleEntries.length; index += 1) {
    const item = visibleEntries[index];
    const rowTop = listStartY + index * options.rowHeight;
    const rowCenterY = rowTop + options.rowHeight / 2 - 1;
    const percentageX = rect.x + rect.width - horizontalPadding;

    context.fillStyle = index % 2 === 0
      ? "rgba(255, 244, 225, 0.035)"
      : "rgba(255, 244, 225, 0.02)";
    roundedRectPath(context, contentX - 12, rowTop + 1, contentWidth + 12, options.rowHeight - 4, 16);
    context.fill();

    context.fillStyle = item.isOthers ? "rgba(239, 208, 160, 0.76)" : "rgba(239, 208, 160, 0.88)";
    context.font = `700 ${options.rankFontSize}px "Source Sans 3", sans-serif`;
    const rankLabel = item.isOthers ? "OTR" : String(index + 1).padStart(2, "0");
    context.fillText(rankLabel, contentX, rowCenterY);

    context.fillStyle = "#f6eee1";
    context.font = `${item.isOthers ? "700" : "600"} ${options.nameFontSize}px "Source Sans 3", sans-serif`;
    context.fillText(truncateText(context, item.name, nameWidth), nameX, rowCenterY);

    if (options.showMeta) {
      context.fillStyle = item.isOthers
        ? "rgba(246, 238, 225, 0.42)"
        : "rgba(246, 238, 225, 0.58)";
      context.font = `600 ${options.metaFontSize ?? 12}px "Source Sans 3", sans-serif`;
      context.fillText(
        truncateText(
          context,
          item.isOthers ? "Resto del mosaico" : `${item.region} / ${item.party}`,
          metaWidth,
        ),
        metaX,
        rowCenterY,
      );
    }

    context.fillStyle = "rgba(239, 208, 160, 0.94)";
    context.font = `700 ${options.percentageFontSize}px "Source Sans 3", sans-serif`;
    context.textAlign = "right";
    context.fillText(`${PERCENT_FORMATTER.format(item.percentage)}%`, percentageX, rowCenterY);
    context.textAlign = "left";
  }

  if (footerStats.length) {
    const statsY = rect.y + rect.height - statsHeight - 24;
    const gap = 14;
    const statWidth = (contentWidth - gap) / footerStats.length;

    footerStats.forEach((stat, index) => {
      drawStatCard(context, {
        x: contentX + index * (statWidth + gap),
        y: statsY,
        width: statWidth,
        height: statsHeight,
        label: stat.label,
        value: stat.value,
        compact: true,
      });
    });
  }

  context.restore();
}

function getVisibleRankingEntries(composition, maxRows, options) {
  const entries = composition.entries ?? [];
  if (!entries.length || maxRows <= 0) {
    return [];
  }

  if (!options.reserveOthersRow || entries.length <= maxRows) {
    return entries.slice(0, maxRows);
  }

  const othersEntry = entries.find((entry) => entry.isOthers);
  if (!othersEntry) {
    return entries.slice(0, maxRows);
  }

  const topEntries = (composition.topEntries ?? entries.filter((entry) => !entry.isOthers)).slice(
    0,
    Math.max(0, maxRows - 1),
  );

  return [...topEntries, othersEntry];
}

function drawStatCard(context, { x, y, width, height, label, value, compact = false }) {
  fillPanel(context, { x, y, width, height, radius: compact ? 22 : 24 }, {
    fill: compact ? "rgba(255, 244, 225, 0.045)" : "rgba(255, 244, 225, 0.04)",
    stroke: "rgba(239, 208, 160, 0.14)",
  });

  context.save();
  context.textBaseline = "top";
  context.fillStyle = "rgba(246, 238, 225, 0.7)";
  context.font = `700 ${compact ? 13 : 16}px "Source Sans 3", sans-serif`;
  drawWrappedText(context, label, {
    x: x + 22,
    y: y + 18,
    maxWidth: width - 44,
    lineHeight: compact ? 16 : 18,
    maxLines: compact ? 3 : 2,
  });

  context.fillStyle = "#f6eee1";
  context.font = `700 ${compact ? 30 : 40}px "Cinzel", serif`;
  context.fillText(value, x + 22, y + (compact ? 52 : 46));
  context.restore();
}

function drawFooter(context, rect, websiteUrl, options = {}) {
  fillPanel(context, rect, {
    fill: "rgba(255, 244, 225, 0.04)",
    stroke: "rgba(239, 208, 160, 0.12)",
  });

  const linkFontSize = options.linkFontSize ?? 26;
  const linkY = rect.y + 30;
  const iconSize = options.logo ? Math.min(30, rect.height - 26) : 0;
  const iconX = rect.x + 24;
  const iconY = linkY - 1;
  const linkX = options.logo ? iconX + iconSize + 12 : rect.x + 24;

  context.save();
  context.textBaseline = "top";
  context.fillStyle = "rgba(239, 208, 160, 0.82)";
  context.font = '700 16px "Source Sans 3", sans-serif';
  context.fillText((options.eyebrow ?? "Explora mas en").toUpperCase(), rect.x + 24, rect.y + 10);

  if (options.logo) {
    context.save();
    roundedRectPath(context, iconX, iconY, iconSize, iconSize, 9);
    context.clip();
    context.drawImage(options.logo, iconX, iconY, iconSize, iconSize);
    context.restore();

    context.strokeStyle = "rgba(239, 208, 160, 0.18)";
    context.lineWidth = 1.5;
    roundedRectPath(context, iconX, iconY, iconSize, iconSize, 9);
    context.stroke();
  }

  context.fillStyle = "#f6eee1";
  context.font = `700 ${linkFontSize}px "Source Sans 3", sans-serif`;
  context.fillText(websiteUrl, linkX, linkY);
  context.restore();
}

async function loadFooterLogo() {
  if (!footerLogoPromise) {
    footerLogoPromise = loadImageAsset(FOOTER_LOGO_URL).catch(() => null);
  }

  return footerLogoPromise;
}

function loadImageAsset(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`No se pudo cargar el asset ${url}.`));
    image.src = url;
  });
}

function fillPanel(context, rect, { fill, stroke }) {
  context.save();
  roundedRectPath(context, rect.x, rect.y, rect.width, rect.height, rect.radius);
  context.fillStyle = fill;
  context.fill();

  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.stroke();
  }

  context.restore();
}

function drawContainedImage(context, image, rect) {
  const sourceWidth = image.width || image.videoWidth;
  const sourceHeight = image.height || image.videoHeight;

  if (!sourceWidth || !sourceHeight) {
    return;
  }

  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = rect.x + (rect.width - drawWidth) / 2;
  const drawY = rect.y + (rect.height - drawHeight) / 2;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function drawWrappedText(context, text, options) {
  const lines = wrapText(context, text, options.maxWidth, options.maxLines);

  lines.forEach((line, index) => {
    context.fillText(line, options.x, options.y + index * options.lineHeight);
  });
}

function wrapText(context, text, maxWidth, maxLines = Number.POSITIVE_INFINITY) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (!current) {
      lines.push(truncateText(context, word, maxWidth));
    } else {
      lines.push(current);
      current = word;
    }

    if (lines.length === maxLines) {
      lines[lines.length - 1] = truncateText(
        context,
        `${lines[lines.length - 1]} ${current}`.trim(),
        maxWidth,
      );
      return lines;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  return lines;
}

function truncateText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  const ellipsis = "...";
  let trimmed = text;

  while (trimmed.length > 1 && context.measureText(`${trimmed}${ellipsis}`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }

  return `${trimmed.trimEnd()}${ellipsis}`;
}

function roundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo exportar la tarjeta."));
        return;
      }

      resolve(blob);
    }, type);
  });
}
