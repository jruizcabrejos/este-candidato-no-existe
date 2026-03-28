import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeSourceImage,
  clearCanvas,
  drawSourcePreview,
  loadImageFromUrl,
  prepareUploadImageFile,
} from "../mosaic/imageUtils.js";
import { buildTileIndex, matchCells } from "../mosaic/matcher.js";
import { downloadCanvasImage, renderMosaic } from "../mosaic/renderer.js";
import {
  createShareCardAsset,
  downloadBlobFile,
  getShareCardFormatConfig,
  SHARE_CARD_FORMATS,
} from "../mosaic/shareCard.js";
import backgroundManifest from "../generated/background_manifest.json";

const DATASET_URL = `/generated/mosaic/tiles.json?v=${backgroundManifest.assetVersion ?? "1"}`;
const DETAIL_OPTIONS = [
  { value: 32, label: "Ligero" },
  { value: 44, label: "Medio" },
  { value: 56, label: "Fino" },
];
const EXTENDED_DETAIL_OPTIONS = [
  { value: 0, label: "Apagado" },
  { value: 72, label: "72 celdas" },
  { value: 84, label: "84 celdas" },
  { value: 96, label: "96 celdas" },
  { value: 120, label: "120 celdas" },
];
const TILE_SIZE_OPTIONS = [
  { value: 16, label: "16 px" },
  { value: 20, label: "20 px" },
  { value: 24, label: "24 px" },
];
const DEFAULT_SETTINGS = {
  detail: 56,
  extendedDetail: 72,
  tileSize: 16,
  highFidelitySource: false,
};
const DEFAULT_LUMA_WEIGHT = 0.85;
const DEFAULT_UPLOAD_MAX_DIMENSION = 1600;
const HIGH_FIDELITY_UPLOAD_MAX_DIMENSION = 2200;
const INITIAL_PROGRESS = {
  status: "idle",
  label: "Selecciona una imagen para empezar.",
  fraction: 0,
};
const COMPOSITION_PREVIEW_LIMIT = 24;
const WEBSITE_URL = "https://candidatos.incaslop.online/";
const SHARE_CARD_TITLE = "Este candidato no existe";
const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

export default function MosaicGeneratorSection({
  sectionRef: providedSectionRef = null,
  onBusyChange,
  title = "Tu foto dentro del mosaico electoral",
}) {
  const localSectionRef = useRef(null);
  const sectionRef = providedSectionRef ?? localSectionRef;
  const fileInputRef = useRef(null);
  const sourceCanvasRef = useRef(null);
  const resultCanvasRef = useRef(null);
  const resultViewportRef = useRef(null);
  const sourceUrlRef = useRef("");
  const sourceFileRef = useRef(null);
  const datasetRequestStartedRef = useRef(false);
  const dragDepthRef = useRef(0);
  const [datasetState, setDatasetState] = useState({
    status: "idle",
    data: null,
    error: "",
  });
  const [sourceUrl, setSourceUrl] = useState("");
  const [uploadState, setUploadState] = useState({
    status: "idle",
    message: "Las fotos grandes se optimizan antes de generar el mosaico.",
    meta: null,
  });
  const [showCroppedPreview, setShowCroppedPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const [resultStats, setResultStats] = useState(null);
  const [compositionBreakdown, setCompositionBreakdown] = useState([]);
  const [showAllComposition, setShowAllComposition] = useState(false);
  const [resultZoomMode, setResultZoomMode] = useState("fit");
  const [shareCardFormat, setShareCardFormat] = useState("portrait");
  const [shareCardFeedback, setShareCardFeedback] = useState({
    status: "idle",
    message: "",
  });
  const [shareCardBusyAction, setShareCardBusyAction] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isDragOver, setIsDragOver] = useState(false);

  const tileIndex = useMemo(
    () => (datasetState.data ? buildTileIndex(datasetState.data) : null),
    [datasetState.data],
  );
  const effectiveDetail = settings.extendedDetail || settings.detail;
  const effectiveUploadMaxDimension = settings.highFidelitySource
    ? HIGH_FIDELITY_UPLOAD_MAX_DIMENSION
    : DEFAULT_UPLOAD_MAX_DIMENSION;
  const shareCardSummary = useMemo(
    () => buildShareCardComposition(compositionBreakdown),
    [compositionBreakdown],
  );
  const shareCardFormatMeta = getShareCardFormatConfig(shareCardFormat);
  const isShareCardBusy = shareCardBusyAction !== "";
  const canExportShareCard =
    Boolean(resultStats) &&
    shareCardSummary.entries.length > 0 &&
    !isShareCardBusy;
  const showAdvancedSettings = Boolean(resultStats) || isGenerating;

  useEffect(() => {
    onBusyChange?.(isGenerating || uploadState.status === "processing");
  }, [isGenerating, onBusyChange, uploadState.status]);

  useEffect(() => {
    if (datasetRequestStartedRef.current) {
      return undefined;
    }
    datasetRequestStartedRef.current = true;

    const controller = new AbortController();

    async function loadDataset() {
      setDatasetState({
        status: "loading",
        data: null,
        error: "",
      });

      try {
        const response = await fetch(DATASET_URL, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("No se pudo cargar la metadata del mosaico.");
        }

        const data = await response.json();
        setDatasetState({
          status: "ready",
          data,
          error: "",
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setDatasetState({
          status: "error",
          data: null,
          error: error.message || "No se pudo cargar la metadata del mosaico.",
        });
      }
    }

    loadDataset();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) {
        URL.revokeObjectURL(sourceUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!sourceFileRef.current) {
      return undefined;
    }

    let cancelled = false;

    async function reprocessSource() {
      try {
        await prepareSelectedFile(sourceFileRef.current, {
          maxDimension: effectiveUploadMaxDimension,
          reprocessing: true,
          isCancelled: () => cancelled,
        });
      } catch {
        // Errors are handled inside prepareSelectedFile.
      }
    }

    reprocessSource();
    return () => {
      cancelled = true;
    };
  }, [effectiveUploadMaxDimension]);

  useEffect(() => {
    if (!resultViewportRef.current) {
      return;
    }

    resultViewportRef.current.scrollTop = 0;
    resultViewportRef.current.scrollLeft = 0;
  }, [resultZoomMode, resultStats]);

  const datasetSummary = tileIndex
    ? `${formatCount(tileIndex.summary.tileCount)} congresistas listos para servirte`
    : datasetState.status === "loading"
      ? "Cargando la coleccion de retratos para el mosaico."
      : datasetState.error || "Preparando la coleccion de retratos para el mosaico.";
  const canGenerate =
    Boolean(sourceUrl) &&
    uploadState.status === "ready" &&
    datasetState.status === "ready" &&
    !isGenerating;
  const generateDisabledReason = uploadState.status === "processing"
    ? "Estamos optimizando la foto para que el mosaico responda mas rapido."
    : uploadState.status === "error"
      ? ""
      : !sourceUrl
    ? "Selecciona una imagen para activar el mosaico."
    : datasetState.status === "loading"
      ? "El dataset se esta cargando."
      : datasetState.status === "error"
        ? datasetState.error
        : "";
  const visibleComposition = showAllComposition
    ? compositionBreakdown
    : compositionBreakdown.slice(0, COMPOSITION_PREVIEW_LIMIT);

  function resetMosaicViews() {
    setShowCroppedPreview(false);
    setResultStats(null);
    setCompositionBreakdown([]);
    setShowAllComposition(false);
    setResultZoomMode("fit");
    setShareCardFeedback({
      status: "idle",
      message: "",
    });
    setShareCardBusyAction("");
    setProgress(INITIAL_PROGRESS);
    clearCanvas(sourceCanvasRef.current);
    clearCanvas(resultCanvasRef.current);
    if (resultViewportRef.current) {
      resultViewportRef.current.scrollTop = 0;
      resultViewportRef.current.scrollLeft = 0;
    }
  }

  async function prepareSelectedFile(
    file,
    { maxDimension, reprocessing = false, isCancelled = () => false } = {},
  ) {
    const previousSourceUrl = sourceUrlRef.current;
    dragDepthRef.current = 0;
    setIsDragOver(false);

    setUploadState({
      status: "processing",
      message: reprocessing
        ? "Reoptimizando la foto con la nueva fidelidad."
        : "Optimizando la foto antes de generar el mosaico.",
      meta: null,
    });
    resetMosaicViews();

    try {
      const prepared = await prepareUploadImageFile(file, {
        maxDimension,
        quality: maxDimension > DEFAULT_UPLOAD_MAX_DIMENSION ? 0.92 : 0.88,
      });

      if (isCancelled()) {
        URL.revokeObjectURL(prepared.url);
        return;
      }

      if (previousSourceUrl && previousSourceUrl !== prepared.url) {
        URL.revokeObjectURL(previousSourceUrl);
      }

      sourceUrlRef.current = prepared.url;
      setSourceUrl(prepared.url);
      setUploadState({
        status: "ready",
        message: `Foto lista: ${prepared.width} x ${prepared.height}px, ${formatFileSize(prepared.size)}.`,
        meta: prepared,
      });
    } catch (error) {
      if (isCancelled()) {
        return;
      }

      sourceUrlRef.current = previousSourceUrl ?? "";
      setSourceUrl(previousSourceUrl ?? "");
      setUploadState({
        status: "error",
        message: error.message || "No se pudo preparar la imagen subida.",
        meta: null,
      });
    }
  }

  async function handleGenerate(event) {
    event?.preventDefault();

    if (!sourceUrl || !tileIndex) {
      return;
    }

    const sourceCanvas = sourceCanvasRef.current;
    const resultCanvas = resultCanvasRef.current;
    if (!sourceCanvas || !resultCanvas) {
      return;
    }

    setIsGenerating(true);
    setResultStats(null);
    setCompositionBreakdown([]);
    setShowAllComposition(false);
    setResultZoomMode("fit");
    setShareCardFeedback({
      status: "idle",
      message: "",
    });
    setShareCardBusyAction("");
    clearCanvas(resultCanvas);
    setProgress({
      status: "loading",
      label: "Preparando la imagen y ajustando la grilla.",
      fraction: 0.08,
    });

    try {
      const image = await loadImageFromUrl(sourceUrl);
      const tileSize = Number(settings.tileSize);
      const lumaWeight = DEFAULT_LUMA_WEIGHT;
      const variationSeed = createVariationSeed();
      const analysis = analyzeSourceImage(image, effectiveDetail);
      const outputWidth = analysis.columns * tileSize;
      const outputHeight = analysis.rows * tileSize;

      drawSourcePreview(sourceCanvas, image, outputWidth, outputHeight);
      setShowCroppedPreview(true);

      const placements = await matchCells({
        ...analysis,
        tileIndex,
        lumaWeight,
        variationSeed,
        avoidRepeat: true,
        onProgress: (update) => {
          setProgress({
            status: "matching",
            label: `Buscando retratos compatibles fila ${update.completed} de ${update.total}.`,
            fraction: 0.15 + update.fraction * 0.55,
          });
        },
      });

      await renderMosaic({
        canvas: resultCanvas,
        atlas: tileIndex.atlas,
        placements,
        columns: analysis.columns,
        rows: analysis.rows,
        tileSize,
        onProgress: (update) => {
          setProgress({
            status: "rendering",
            label: `Componiendo el mosaico fila ${update.completed} de ${update.total}.`,
            fraction: 0.72 + update.fraction * 0.28,
          });
        },
      });

      setResultStats({
        columns: analysis.columns,
        rows: analysis.rows,
        totalTiles: placements.length,
        uniqueTiles: new Set(placements.map((tile) => tile?.id).filter(Boolean)).size,
        outputWidth,
        outputHeight,
      });
      setCompositionBreakdown(buildCompositionBreakdown(placements));
      setProgress({
        status: "done",
        label: "Mosaico listo para descargar o compartir.",
        fraction: 1,
      });
    } catch (error) {
      setProgress({
        status: "error",
        label: error.message || "No se pudo generar el mosaico.",
        fraction: 0,
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleDownload(format = "png") {
    const canvas = resultCanvasRef.current;
    if (!canvas || !resultStats) {
      return;
    }

    try {
      await downloadCanvasImage(canvas, format);
    } catch (error) {
      setProgress({
        status: "error",
        label: error.message || "No se pudo exportar la imagen.",
        fraction: 0,
      });
    }
  }

  async function createCurrentShareCardAsset() {
    const canvas = resultCanvasRef.current;

    if (!canvas || !resultStats || shareCardSummary.entries.length === 0) {
      throw new Error("Genera el mosaico antes de exportar la tarjeta.");
    }

    return createShareCardAsset({
      mosaicCanvas: canvas,
      format: shareCardFormat,
      composition: shareCardSummary,
      stats: resultStats,
      websiteUrl: WEBSITE_URL,
    });
  }

  async function handleShareCardExport() {
    if (!canExportShareCard) {
      return;
    }

    setShareCardBusyAction("export");
    setShareCardFeedback({
      status: "loading",
      message: `Armando la tarjeta ${shareCardFormatMeta.label.toLowerCase()} en PNG.`,
    });

    try {
      const asset = await createCurrentShareCardAsset();
      downloadBlobFile(asset.blob, asset.filename);
      setShareCardFeedback({
        status: "done",
        message: `Tarjeta ${shareCardFormatMeta.label.toLowerCase()} descargada.`,
      });
    } catch (error) {
      setShareCardFeedback({
        status: "error",
        message: error.message || "No se pudo exportar la tarjeta.",
      });
    } finally {
      setShareCardBusyAction("");
    }
  }

  async function handleShareCardShare() {
    if (!canExportShareCard) {
      return;
    }

    setShareCardBusyAction("share");
    setShareCardFeedback({
      status: "loading",
      message: `Preparando la tarjeta ${shareCardFormatMeta.label.toLowerCase()} para compartir.`,
    });

    try {
      const asset = await createCurrentShareCardAsset();
      const shareSupported =
        asset.file &&
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [asset.file] });

      if (!shareSupported) {
        downloadBlobFile(asset.blob, asset.filename);
        setShareCardFeedback({
          status: "fallback",
          message:
            "Tu navegador no permite compartir archivos aqui. Descargamos la tarjeta PNG para que la publiques manualmente.",
        });
        return;
      }

      await navigator.share({
        files: [asset.file],
        title: SHARE_CARD_TITLE,
        text: `Asi se ve mi foto dentro del mosaico electoral del Congreso 2026. ${WEBSITE_URL}`,
        url: WEBSITE_URL,
      });
      setShareCardFeedback({
        status: "done",
        message: "Tarjeta compartida desde el navegador.",
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        setShareCardFeedback({
          status: "idle",
          message: "Compartir cancelado.",
        });
      } else {
        setShareCardFeedback({
          status: "error",
          message: error.message || "No se pudo compartir la tarjeta.",
        });
      }
    } finally {
      setShareCardBusyAction("");
    }
  }

  async function processSelectedFile(file) {
    if (!file) {
      return;
    }

    if (!file.type?.startsWith("image/")) {
      setUploadState({
        status: "error",
        message: "Sube una imagen PNG, JPG o WebP para armar el mosaico.",
        meta: null,
      });
      return;
    }

    sourceFileRef.current = file;
    await prepareSelectedFile(file, {
      maxDimension: effectiveUploadMaxDimension,
    });
  }

  function openFilePicker() {
    if (uploadState.status === "processing") {
      return;
    }

    fileInputRef.current?.click();
  }

  function handleSourceKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openFilePicker();
  }

  function isFileDragEvent(event) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function handleSourceDragEnter(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }

  function handleSourceDragOver(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragOver) {
      setIsDragOver(true);
    }
  }

  function handleSourceDragLeave(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }

  async function handleSourceDrop(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    await processSelectedFile(event.dataTransfer.files?.[0]);
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const input = event.target;

    (async () => {
      try {
        await processSelectedFile(file);
      } finally {
        input.value = "";
      }
    })();
  }

  function handleSettingChange(event) {
    const { name, type, checked, value } = event.target;
    setSettings((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : Number(value),
    }));
  }

  return (
    <section ref={sectionRef} className="catalog-section mosaic-section">
      <div className="section-shell mosaic-shell js-reveal">
        <header className="section-header mosaic-header">
          <h2 className="section-title">{title}</h2>
        </header>

        <div className="mosaic-layout">
          <div className="mosaic-stage">
            <div className="mosaic-preview-grid">
              <article className="mosaic-preview-card mosaic-preview-card-input">
                <div className="mosaic-preview-meta">
                  <span>Foto base</span>
                  <span>
                    {showCroppedPreview
                      ? "Recorte listo para el mosaico"
                      : uploadState.meta
                        ? `${uploadState.meta.width} x ${uploadState.meta.height}px`
                        : "Arrastra o haz click"}
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  className="mosaic-input-file"
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES}
                  tabIndex={-1}
                  onChange={handleFileChange}
                />
                <div
                  className={`mosaic-preview-frame mosaic-upload-frame${
                    isDragOver ? " is-drag-over" : ""
                  }${sourceUrl ? " has-image" : ""}`}
                  role="button"
                  tabIndex={uploadState.status === "processing" ? -1 : 0}
                  aria-label={
                    sourceUrl ? "Cambiar foto base del mosaico" : "Subir foto base del mosaico"
                  }
                  aria-disabled={uploadState.status === "processing"}
                  onClick={openFilePicker}
                  onKeyDown={handleSourceKeyDown}
                  onDragEnter={handleSourceDragEnter}
                  onDragOver={handleSourceDragOver}
                  onDragLeave={handleSourceDragLeave}
                  onDrop={handleSourceDrop}
                >
                  <canvas
                    ref={sourceCanvasRef}
                    className={`mosaic-canvas${showCroppedPreview ? " is-visible" : ""}`}
                  />
                  {!showCroppedPreview && sourceUrl ? (
                    <img
                      className="mosaic-preview-image"
                      src={sourceUrl}
                      alt="Imagen seleccionada para el mosaico"
                    />
                  ) : null}
                  {!showCroppedPreview && !sourceUrl ? (
                    <div className="mosaic-placeholder mosaic-upload-empty">
                      <div>
                        <p className="mosaic-upload-title">[+] Sube una foto</p>
                        <p className="mosaic-upload-copy">
                          Arrastrala aqui o haz click para elegir un archivo PNG, JPG o
                          WebP.
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {sourceUrl ? (
                    <span className="mosaic-upload-chip">
                      {showCroppedPreview ? "Cambiar foto" : "Arrastra otra o haz click"}
                    </span>
                  ) : null}
                  {isDragOver ? (
                    <div className="mosaic-drop-overlay" aria-hidden="true">
                      <p>Suelta la foto aqui</p>
                    </div>
                  ) : null}
                </div>
                <p className={`mosaic-hint mosaic-hint-${uploadState.status}`}>
                  {uploadState.message}
                </p>
              </article>

              <article className="mosaic-preview-card mosaic-preview-card-result">
                <div className="mosaic-preview-meta">
                  <span>Salida</span>
                  <div className="mosaic-preview-meta-actions">
                    <span>
                      {resultStats
                        ? `${resultStats.outputWidth} x ${resultStats.outputHeight}px`
                        : "Resultado del mosaico"}
                    </span>
                    {resultStats ? (
                      <div className="mosaic-zoom-controls" role="group" aria-label="Zoom del mosaico">
                        <button
                          className={`mosaic-zoom-button${
                            resultZoomMode === "fit" ? " is-active" : ""
                          }`}
                          type="button"
                          aria-pressed={resultZoomMode === "fit"}
                          onClick={() => setResultZoomMode("fit")}
                        >
                          Ajustar
                        </button>
                        <button
                          className={`mosaic-zoom-button${
                            resultZoomMode === "100" ? " is-active" : ""
                          }`}
                          type="button"
                          aria-pressed={resultZoomMode === "100"}
                          onClick={() => setResultZoomMode("100")}
                        >
                          100%
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mosaic-preview-frame">
                  <div
                    ref={resultViewportRef}
                    className={`mosaic-result-viewport${
                      resultZoomMode === "100" ? " is-full-detail" : " is-fit"
                    }${resultStats ? " is-visible" : ""}`}
                    tabIndex={resultStats ? 0 : -1}
                  >
                    <canvas
                      ref={resultCanvasRef}
                      className={`mosaic-canvas mosaic-result-canvas${
                        resultStats ? " is-visible" : ""
                      }${resultZoomMode === "100" ? " is-full-detail" : " is-fit"}`}
                    />
                  </div>
                  {!resultStats ? (
                    <div className="mosaic-placeholder">
                      <p>El mosaico final aparecera aqui cuando termine el render.</p>
                    </div>
                  ) : null}
                </div>
              </article>
            </div>

            <form className="mosaic-panel mosaic-control-panel" onSubmit={handleGenerate}>
              <div className="mosaic-panel-block">
                <p className="mosaic-panel-eyebrow">Dataset</p>
                <p className="mosaic-panel-copy">{datasetSummary}</p>
              </div>

              <div className="mosaic-progress">
                <div className="mosaic-progress-track" aria-hidden="true">
                  <span
                    className="mosaic-progress-fill"
                    style={{ transform: `scaleX(${progress.fraction})` }}
                  />
                </div>
                <p className={`mosaic-status mosaic-status-${progress.status}`}>
                  {progress.label}
                </p>
              </div>

              <div className="mosaic-actions mosaic-actions-primary">
                <button
                  className={`mosaic-button${canGenerate ? " is-ready" : ""}`}
                  type="submit"
                  disabled={!canGenerate}
                >
                  {isGenerating ? "Generando..." : "Generar mosaico"}
                </button>
                <button
                  className="mosaic-button mosaic-button-secondary"
                  type="button"
                  disabled={!resultStats}
                  onClick={() => handleDownload("png")}
                >
                  Exportar PNG
                </button>
              </div>

              {generateDisabledReason ? (
                <p className="mosaic-hint">{generateDisabledReason}</p>
              ) : null}

              {showAdvancedSettings ? (
                <details className="mosaic-advanced mosaic-advanced-postrun">
                  <summary className="mosaic-advanced-summary">Ajustes</summary>
                  <div className="mosaic-advanced-body">
                    <p className="mosaic-advanced-copy">
                      El preset inicial usa tile de 16 px, detalle fino y detalle
                      extendido de 72 celdas.
                    </p>

                    <div className="mosaic-field-grid">
                      <label className="mosaic-field">
                        <span className="mosaic-label">Detalle</span>
                        <select
                          name="detail"
                          value={settings.detail}
                          onChange={handleSettingChange}
                        >
                          {DETAIL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="mosaic-field">
                        <span className="mosaic-label">Tile final</span>
                        <select
                          name="tileSize"
                          value={settings.tileSize}
                          onChange={handleSettingChange}
                        >
                          {TILE_SIZE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="mosaic-field">
                      <span className="mosaic-label">
                        Detalle extendido <strong>{effectiveDetail}</strong>
                      </span>
                      <select
                        name="extendedDetail"
                        value={settings.extendedDetail}
                        onChange={handleSettingChange}
                      >
                        {EXTENDED_DETAIL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="mosaic-toggle">
                      <input
                        name="highFidelitySource"
                        type="checkbox"
                        checked={settings.highFidelitySource}
                        onChange={handleSettingChange}
                      />
                      <span>
                        Preparar la foto en alta fidelidad hasta{" "}
                        <strong>{HIGH_FIDELITY_UPLOAD_MAX_DIMENSION}px</strong>
                      </span>
                    </label>
                  </div>
                </details>
              ) : null}
            </form>

            {resultStats ? (
              <>
                <div className="mosaic-stat-grid">
                  <div className="mosaic-stat-card">
                    <span className="mosaic-stat-label">Total de candidatos utilizados</span>
                    <strong className="mosaic-stat-value">
                      {formatCount(resultStats.uniqueTiles)}
                    </strong>
                  </div>
                  <div className="mosaic-stat-card">
                    <span className="mosaic-stat-label">Total de piezas del mosaico</span>
                    <strong className="mosaic-stat-value">
                      {formatCount(resultStats.totalTiles)}
                    </strong>
                  </div>
                  <div className="mosaic-stat-card">
                    <span className="mosaic-stat-label">Resolucion</span>
                    <strong className="mosaic-stat-value">
                      {`${resultStats.outputWidth} x ${resultStats.outputHeight}`}
                    </strong>
                  </div>
                </div>

                <section className="share-card-panel">
                  <div className="share-card-header">
                    <div>
                      <p className="mosaic-panel-eyebrow">Tarjeta social</p>
                      <p className="share-card-summary">
                        Exporta una tarjeta lista para publicar con las estadisticas del
                        mosaico.
                      </p>
                    </div>
                    <p className="share-card-meta">
                      {shareCardFormatMeta.width} x {shareCardFormatMeta.height}px PNG
                    </p>
                  </div>

                  <div className="share-card-controls">
                    <div
                      className="share-card-format-group"
                      role="group"
                      aria-label="Formato de la tarjeta para compartir"
                    >
                      {SHARE_CARD_FORMATS.map((option) => (
                        <button
                          key={option.value}
                          className={`share-card-format-button${
                            shareCardFormat === option.value ? " is-active" : ""
                          }`}
                          type="button"
                          aria-pressed={shareCardFormat === option.value}
                          disabled={isShareCardBusy}
                          onClick={() => {
                            setShareCardFormat(option.value);
                            setShareCardFeedback({
                              status: "idle",
                              message: "",
                            });
                          }}
                        >
                          <span
                            className={`share-card-format-icon share-card-format-icon-${option.value}`}
                            aria-hidden="true"
                          />
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className="mosaic-actions share-card-actions">
                      <button
                        className="mosaic-button"
                        type="button"
                        disabled={!canExportShareCard}
                        onClick={handleShareCardExport}
                      >
                        {shareCardBusyAction === "export" ? "Preparando..." : "Exportar tarjeta"}
                      </button>
                      <button
                        className="mosaic-button mosaic-button-secondary"
                        type="button"
                        disabled={!canExportShareCard}
                        onClick={handleShareCardShare}
                      >
                        {shareCardBusyAction === "share" ? "Preparando..." : "Compartir tarjeta"}
                      </button>
                    </div>
                  </div>

                  <p className={`share-card-feedback share-card-feedback-${shareCardFeedback.status}`}>
                    {shareCardFeedback.message ||
                      "La tarjeta incluye el top 10, Otros, tus cifras y el enlace https://candidatos.incaslop.online/."}
                  </p>
                </section>
              </>
            ) : null}

            {compositionBreakdown.length ? (
              <section className="composition-panel">
                <div className="composition-header">
                  <div>
                    <p className="mosaic-panel-eyebrow">De que candidaturas esta hecho</p>
                    <p className="composition-summary">
                      {formatCount(compositionBreakdown.length)} candidaturas participan en tu
                      mosaico.
                    </p>
                  </div>
                  {compositionBreakdown.length > COMPOSITION_PREVIEW_LIMIT ? (
                    <button
                      className="mosaic-button mosaic-button-secondary composition-toggle"
                      type="button"
                      onClick={() => setShowAllComposition((current) => !current)}
                    >
                      {showAllComposition ? "Ver menos" : "Ver todas"}
                    </button>
                  ) : null}
                </div>

                <div className="composition-list" role="list">
                  {visibleComposition.map((item) => (
                    <article key={item.id} className="composition-item" role="listitem">
                      <div className="composition-identity">
                        <CandidatePortrait atlas={tileIndex?.atlas} item={item} />
                        <div className="composition-copy">
                          <strong className="composition-name">{item.name}</strong>
                          <span className="composition-party">{item.party}</span>
                          <span className="composition-region">Region: {item.region}</span>
                        </div>
                      </div>
                      <div className="composition-metrics">
                        <strong className="composition-percent">
                          {formatPercent(item.percentage)}%
                        </strong>
                        <span className="composition-count">
                          {formatCount(item.count)} apariciones
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatCount(value) {
  return new Intl.NumberFormat("es-PE").format(value);
}

function formatFileSize(value) {
  if (!value) {
    return "0 KB";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.round(value / 1024)} KB`;
}

function buildCompositionBreakdown(placements) {
  const counts = new Map();

  for (const tile of placements) {
    if (!tile) {
      continue;
    }

    const current = counts.get(tile.id) ?? {
      id: tile.id,
      name: tile.name,
      party: tile.party,
      region: tile.region,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      count: 0,
    };

    current.count += 1;
    counts.set(tile.id, current);
  }

  const total = placements.length || 1;

  return [...counts.values()]
    .map((entry) => ({
      ...entry,
      percentage: (entry.count / total) * 100,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "es"));
}

function buildShareCardComposition(breakdown) {
  const topEntries = breakdown.slice(0, 10);
  const othersPercentage = breakdown
    .slice(10)
    .reduce((total, entry) => total + entry.percentage, 0);
  const entries = [...topEntries];

  if (othersPercentage > 0.0001) {
    entries.push({
      id: "others",
      isOthers: true,
      name: "Otros",
      percentage: othersPercentage,
    });
  }

  return {
    entries,
    othersPercentage,
    topEntries,
  };
}

function formatPercent(value) {
  return new Intl.NumberFormat("es-PE", {
    minimumFractionDigits: value >= 10 ? 1 : 2,
    maximumFractionDigits: value >= 10 ? 1 : 2,
  }).format(value);
}

function createVariationSeed() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }

  return Math.floor(Math.random() * 4294967296);
}

function CandidatePortrait({ atlas, item }) {
  if (!atlas?.url || item.x === undefined || item.y === undefined) {
    return (
      <div
        className="composition-candidate-portrait composition-candidate-portrait-placeholder"
        aria-hidden="true"
      />
    );
  }

  const scale = 40 / item.width;

  return (
    <div
      className="composition-candidate-portrait"
      aria-hidden="true"
      style={{
        backgroundImage: `url(${atlas.url})`,
        backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
        backgroundPosition: `${-item.x * scale}px ${-item.y * scale}px`,
      }}
    />
  );
}
