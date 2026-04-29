import React, { useCallback, useMemo, useRef, useState } from "react";
import MosaicGeneratorSection from "../components/MosaicGeneratorSection.jsx";
import { appRoutePath } from "../utils/urls.js";

const MOSAIC_ROUTE_PREFIX = "/mosaico/";

export default function MosaicPage() {
  const sourceImageUrl = useMemo(() => getSourceImageUrl(), []);
  const [status, setStatus] = useState({
    status: sourceImageUrl ? "loading" : "idle",
    message: sourceImageUrl ? "Preparando la imagen remota." : "",
  });
  const lastPostedStatusRef = useRef("");

  const handleStatusChange = useCallback((nextStatus) => {
    setStatus(nextStatus);

    if (typeof document !== "undefined") {
      document.body.dataset.mosaicStatus = nextStatus.status;
    }

    if (
      typeof window === "undefined" ||
      window.parent === window ||
      nextStatus.status === lastPostedStatusRef.current
    ) {
      return;
    }

    if (nextStatus.status === "ready" || nextStatus.status === "error") {
      lastPostedStatusRef.current = nextStatus.status;
      window.parent.postMessage(
        {
          type: `mosaic:${nextStatus.status}`,
          status: nextStatus.status,
          message: nextStatus.message,
        },
        "*",
      );
    }
  }, []);

  return (
    <main
      className={`mosaic-standalone-page mosaic-standalone-page-${status.status}`}
      data-mosaic-status={status.status}
      aria-label="Generador de mosaicos"
    >
      <MosaicGeneratorSection
        autoGenerate={Boolean(sourceImageUrl)}
        onStatusChange={handleStatusChange}
        sourceImageUrl={sourceImageUrl}
        title="Mosaico de candidaturas"
      />
    </main>
  );
}

function getSourceImageUrl() {
  return getQueryImageUrl() || getPathImageUrl();
}

function getQueryImageUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const search = window.location.search || "";
  if (!search.startsWith("?") || search.length <= 1) {
    return "";
  }

  const params = new URLSearchParams(search);
  const namedValue = params.get("image") || params.get("url");
  if (namedValue) {
    return namedValue.trim();
  }

  const bareValue = search.slice(1).trim();
  if (!bareValue || bareValue.includes("=")) {
    return "";
  }

  try {
    return decodeURIComponent(bareValue.replace(/\+/g, "%20")).trim();
  } catch {
    return bareValue;
  }
}

function getPathImageUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  const pathname = appRoutePath();
  if (!pathname.startsWith(MOSAIC_ROUTE_PREFIX)) {
    return "";
  }

  const rawValue = pathname.slice(MOSAIC_ROUTE_PREFIX.length).trim();
  if (!rawValue) {
    return "";
  }

  return decodeRouteImageUrl(rawValue);
}

function decodeRouteImageUrl(value) {
  const normalizedValue = value.replace(/^\/+/, "");
  let decodedValue = normalizedValue;

  try {
    decodedValue = decodeURIComponent(normalizedValue);
  } catch {
    decodedValue = normalizedValue;
  }

  return decodedValue
    .replace(/^([a-z][a-z0-9+.-]*:)\/(?!\/)/i, "$1//")
    .trim();
}
