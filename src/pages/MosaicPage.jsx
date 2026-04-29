import React, { useCallback, useMemo, useRef, useState } from "react";
import MosaicGeneratorSection from "../components/MosaicGeneratorSection.jsx";

export default function MosaicPage() {
  const sourceImageUrl = useMemo(() => getQueryImageUrl(), []);
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
