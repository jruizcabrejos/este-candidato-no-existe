import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
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
  await preloadBackgroundAtlas();

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
