import React from "react";
import ReactDOM from "react-dom/client";
import backgroundManifest from "./generated/background_manifest.json";
import { appRoutePath, assetUrl } from "./utils/urls.js";
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
    image.src = assetUrl(backgroundManifest.atlasUrl);
  });
}

async function bootstrap() {
  initializeGoogleAnalytics();
  setRuntimeCssAssets();
  const route = getCurrentRoute();
  if (route === "story") {
    await preloadBackgroundAtlas();
  }

  const RootComponent = await loadRootComponent(route);

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <RootComponent />
    </React.StrictMode>,
  );
}

async function loadRootComponent(route) {
  const module = route === "dvd"
    ? await import("./pages/DvdPage.jsx")
    : route === "mosaic"
      ? await import("./pages/MosaicPage.jsx")
      : await import("./App.jsx");
  return module.default;
}

function getCurrentRoute() {
  if (typeof window === "undefined") {
    return "story";
  }

  const pathname = appRoutePath();
  if (pathname === "/dvd" || pathname.startsWith("/dvd/")) {
    return "dvd";
  }
  if (pathname === "/mosaico" || pathname.startsWith("/mosaico/")) {
    return "mosaic";
  }
  return "story";
}

function setRuntimeCssAssets() {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.style.setProperty(
    "--peru-flag-url",
    `url("${assetUrl("/favicon/Flag_of_Peru.svg")}")`,
  );
}

bootstrap();
