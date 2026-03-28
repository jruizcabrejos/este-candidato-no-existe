const atlasCache = new Map();

export async function renderMosaic({
  canvas,
  atlas,
  placements,
  columns,
  rows,
  tileSize,
  onProgress,
}) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo crear el canvas final.");
  }

  const atlasImage = await loadAtlasImage(atlas.url);
  canvas.width = columns * tileSize;
  canvas.height = rows * tileSize;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const tile = placements[row * columns + column];
      if (!tile) {
        continue;
      }

      context.drawImage(
        atlasImage,
        tile.x,
        tile.y,
        tile.width,
        tile.height,
        column * tileSize,
        row * tileSize,
        tileSize,
        tileSize,
      );
    }

    onProgress?.({
      stage: "rendering",
      fraction: (row + 1) / rows,
      completed: row + 1,
      total: rows,
    });

    await yieldToBrowser();
  }
}

export async function downloadCanvasImage(canvas, format) {
  const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
  const extension = format === "jpg" ? "jpg" : "png";
  const blob = await canvasToBlob(canvas, mimeType, format === "jpg" ? 0.92 : undefined);
  const objectUrl = URL.createObjectURL(blob);

  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `mosaico-candidaturas-2026.${extension}`;
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

async function loadAtlasImage(url) {
  if (atlasCache.has(url)) {
    return atlasCache.get(url);
  }

  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      if (typeof image.decode === "function") {
        try {
          await image.decode();
        } catch {
          // Ignore decode race conditions after onload.
        }
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error("No se pudo cargar el atlas del mosaico."));
    image.src = url;
  });

  atlasCache.set(url, promise);
  return promise;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo exportar la imagen."));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
