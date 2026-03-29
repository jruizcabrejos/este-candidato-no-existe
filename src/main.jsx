import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import backgroundManifest from "./generated/background_manifest.json";
import "./index.css";

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
  await preloadBackgroundAtlas();

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
