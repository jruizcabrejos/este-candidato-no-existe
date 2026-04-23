import React from "react";
import ReactDOM from "react-dom/client";
import backgroundManifest from "./generated/background_manifest.json";
import "./index.css";

const GA_ID = import.meta.env.VITE_GA_ID;

function initializeGoogleAnalytics() {
  if (typeof window === "undefined" || typeof document === "undefined" || !GA_ID) {
    return;
  }

  if (window.__gaInitialized) {
    return;
  }

  window.__gaInitialized = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);

  window.gtag("js", new Date());
  window.gtag("config", GA_ID);
}

async function preloadBackgroundAtlas() {
  if (typeof window === "undefined" || !backgroundManifest?.atlasUrl) {
    return;
  }

  await new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "high";
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = backgroundManifest.atlasUrl;
  });
}

async function bootstrap() {
  initializeGoogleAnalytics();
  const useDvdPage = isDvdRoute();
  if (!useDvdPage) {
    await preloadBackgroundAtlas();
  }

  const RootComponent = await loadRootComponent(useDvdPage);

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <RootComponent />
    </React.StrictMode>,
  );
}

async function loadRootComponent(useDvdPage) {
  const module = useDvdPage ? await import("./pages/DvdPage.jsx") : await import("./App.jsx");
  return module.default;
}

function isDvdRoute() {
  if (typeof window === "undefined") {
    return false;
  }

  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  return pathname === "/dvd";
}

bootstrap();
