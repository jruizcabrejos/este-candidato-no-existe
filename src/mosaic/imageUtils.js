export async function loadImageFromUrl(url) {
  const image = new Image();
  image.decoding = "async";

  const loaded = new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
  });

  image.src = url;
  await loaded;

  if (typeof image.decode === "function") {
    try {
      await image.decode();
    } catch {
      // Some browsers may reject decode even after load; onload is enough here.
    }
  }

  return image;
}

export async function prepareUploadImageFile(file, options = {}) {
  const {
    maxDimension = 1600,
    mimeType = "image/jpeg",
    quality = 0.88,
  } = options;

  const source = await loadSourceBitmap(file);
  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d");

  if (!context) {
    cleanupSourceBitmap(source);
    throw new Error("No se pudo preparar la imagen seleccionada.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  const blob = await canvasToBlob(canvas, mimeType, quality);
  cleanupSourceBitmap(source);

  return {
    url: URL.createObjectURL(blob),
    width: targetWidth,
    height: targetHeight,
    size: blob.size,
    type: blob.type,
  };
}

export function analyzeSourceImage(image, longSideCells) {
  const { columns, rows } = calculateGridDimensions(image, longSideCells);
  const canvas = createCanvas(columns, rows);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("No se pudo crear el canvas de analisis.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  drawImageCover(context, image, columns, rows);

  const { data } = context.getImageData(0, 0, columns, rows);
  const cells = new Array(columns * rows);

  for (let index = 0; index < cells.length; index += 1) {
    const offset = index * 4;
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

export function drawSourcePreview(canvas, image, width, height) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo crear el canvas de previsualizacion.");
  }

  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  drawImageCover(context, image, width, height);
}

export function clearCanvas(canvas) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
}

function calculateGridDimensions(image, longSideCells) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const aspectRatio = sourceWidth / sourceHeight;

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

function drawImageCover(context, image, width, height) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = Math.round((sourceWidth - sw) / 2);
  } else {
    sh = sourceWidth / targetRatio;
    sy = Math.round((sourceHeight - sh) / 2);
  }

  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadSourceBitmap(file) {
  if ("createImageBitmap" in window) {
    try {
      return await window.createImageBitmap(file);
    } catch {
      // Fall back to the Image element path below.
    }
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromUrl(objectUrl);
    Object.defineProperty(image, "__objectUrl", {
      configurable: true,
      value: objectUrl,
    });
    return image;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function cleanupSourceBitmap(source) {
  if (typeof source.close === "function") {
    source.close();
  }

  if (source.__objectUrl) {
    URL.revokeObjectURL(source.__objectUrl);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo optimizar la imagen subida."));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}
