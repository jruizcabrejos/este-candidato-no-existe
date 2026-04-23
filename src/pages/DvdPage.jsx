import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dvdManifest from "../generated/dvd_manifest.json";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion.js";

const PRELOAD_AHEAD = 5;
const REDUCED_MOTION_CYCLE_MS = 1800;
const DEFAULT_FACE_ASPECT_RATIO = 1.42;

export default function DvdPage() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const faces = useMemo(() => (Array.isArray(dvdManifest.faces) ? dvdManifest.faces : []), []);
  const [currentIndex, setCurrentIndex] = useState(() =>
    faces.length ? Math.floor(Math.random() * faces.length) : 0,
  );
  const [faceWidth, setFaceWidth] = useState(160);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const animationFrameRef = useRef(0);
  const preloadCacheRef = useRef(new Map());
  const indexRef = useRef(currentIndex);
  const motionRef = useRef({
    initialized: false,
    x: 0,
    y: 0,
    width: 160,
    height: Math.round(160 * DEFAULT_FACE_ASPECT_RATIO),
    vx: 150,
    vy: 120,
    lastTime: 0,
  });

  const currentFace = faces[currentIndex % Math.max(1, faces.length)] ?? null;

  useEffect(() => {
    indexRef.current = currentIndex;
  }, [currentIndex]);

  const placeImage = useCallback(() => {
    const image = imageRef.current;
    if (!image) {
      return;
    }

    const motion = motionRef.current;
    image.style.transform = `translate3d(${Math.round(motion.x)}px, ${Math.round(
      motion.y,
    )}px, 0)`;
  }, []);

  const syncMeasurement = useCallback(
    ({ center = false } = {}) => {
      const viewportWidth = window.innerWidth || 1;
      const viewportHeight = window.innerHeight || 1;
      const image = imageRef.current;
      const nextFaceWidth = getDvdFaceWidth(viewportWidth, viewportHeight);
      const naturalWidth = image?.naturalWidth || 1;
      const naturalHeight = image?.naturalHeight || naturalWidth * DEFAULT_FACE_ASPECT_RATIO;
      const aspectRatio = naturalWidth ? naturalHeight / naturalWidth : DEFAULT_FACE_ASPECT_RATIO;
      const nextFaceHeight = Math.max(1, Math.round(nextFaceWidth * aspectRatio));
      const maxX = Math.max(0, viewportWidth - nextFaceWidth);
      const maxY = Math.max(0, viewportHeight - nextFaceHeight);
      const motion = motionRef.current;

      setFaceWidth(nextFaceWidth);
      motion.width = nextFaceWidth;
      motion.height = nextFaceHeight;

      if (!motion.initialized) {
        const velocity = getInitialVelocity(viewportWidth, viewportHeight);
        motion.x = Math.random() * maxX;
        motion.y = Math.random() * maxY;
        motion.vx = velocity.vx;
        motion.vy = velocity.vy;
        motion.initialized = true;
      }

      if (center) {
        motion.x = maxX / 2;
        motion.y = maxY / 2;
      } else {
        motion.x = clamp(motion.x, 0, maxX);
        motion.y = clamp(motion.y, 0, maxY);
      }

      placeImage();
    },
    [placeImage],
  );

  const advanceFace = useCallback(() => {
    if (faces.length < 2) {
      return;
    }

    setCurrentIndex((current) => (current + 1) % faces.length);
  }, [faces.length]);

  useEffect(() => {
    if (!faces.length) {
      return undefined;
    }

    for (let offset = 0; offset <= PRELOAD_AHEAD; offset += 1) {
      const face = faces[(currentIndex + offset) % faces.length];
      if (!face?.assetUrl || preloadCacheRef.current.has(face.assetUrl)) {
        continue;
      }

      const image = new Image();
      image.decoding = "async";
      image.src = face.assetUrl;
      preloadCacheRef.current.set(face.assetUrl, image);
    }

    return undefined;
  }, [currentIndex, faces]);

  useEffect(() => {
    const handleResize = () => {
      syncMeasurement({ center: prefersReducedMotion });
    };

    syncMeasurement({ center: prefersReducedMotion });
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [prefersReducedMotion, syncMeasurement]);

  useEffect(() => {
    window.cancelAnimationFrame(animationFrameRef.current);

    if (!faces.length) {
      return undefined;
    }

    if (prefersReducedMotion) {
      syncMeasurement({ center: true });
      const intervalId = window.setInterval(advanceFace, REDUCED_MOTION_CYCLE_MS);
      return () => window.clearInterval(intervalId);
    }

    motionRef.current.lastTime = performance.now();

    function tick(time) {
      const motion = motionRef.current;
      const viewportWidth = window.innerWidth || 1;
      const viewportHeight = window.innerHeight || 1;
      const maxX = Math.max(0, viewportWidth - motion.width);
      const maxY = Math.max(0, viewportHeight - motion.height);
      const deltaSeconds = Math.min(0.05, Math.max(0.001, (time - motion.lastTime) / 1000));
      let bounced = false;

      motion.lastTime = time;
      motion.x += motion.vx * deltaSeconds;
      motion.y += motion.vy * deltaSeconds;

      if (maxX > 0 && motion.x <= 0) {
        motion.x = 0;
        motion.vx = Math.abs(motion.vx);
        bounced = true;
      } else if (maxX > 0 && motion.x >= maxX) {
        motion.x = maxX;
        motion.vx = -Math.abs(motion.vx);
        bounced = true;
      }

      if (maxY > 0 && motion.y <= 0) {
        motion.y = 0;
        motion.vy = Math.abs(motion.vy);
        bounced = true;
      } else if (maxY > 0 && motion.y >= maxY) {
        motion.y = maxY;
        motion.vy = -Math.abs(motion.vy);
        bounced = true;
      }

      if (bounced) {
        advanceFace();
      }

      placeImage();
      animationFrameRef.current = window.requestAnimationFrame(tick);
    }

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(animationFrameRef.current);
  }, [advanceFace, faces.length, placeImage, prefersReducedMotion, syncMeasurement]);

  return (
    <main ref={stageRef} className="dvd-page" aria-label="Average candidate face animation">
      {currentFace ? (
        <img
          ref={imageRef}
          className="dvd-face"
          src={currentFace.assetUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
          fetchPriority="high"
          draggable="false"
          style={{ width: `${faceWidth}px` }}
          onLoad={() => syncMeasurement({ center: prefersReducedMotion })}
        />
      ) : null}
    </main>
  );
}

function getDvdFaceWidth(viewportWidth, viewportHeight) {
  const shortestSide = Math.max(1, Math.min(viewportWidth, viewportHeight));
  const phoneLikeViewport = viewportWidth <= 720 || viewportHeight > viewportWidth * 1.2;

  if (phoneLikeViewport) {
    const phoneBase = Math.min(300, Math.floor(shortestSide / 4));
    return Math.min(shortestSide * 0.72, Math.max(128, Math.ceil(phoneBase * 1.5)));
  }

  return Math.max(96, Math.min(160, Math.floor(shortestSide / 4)));
}

function getInitialVelocity(viewportWidth, viewportHeight) {
  const phoneLikeViewport = viewportWidth <= 720 || viewportHeight > viewportWidth * 1.2;
  const speedX = phoneLikeViewport ? randomBetween(110, 190) : randomBetween(100, 200);
  const speedY = phoneLikeViewport ? randomBetween(90, 160) : randomBetween(75, 150);

  return {
    vx: randomSign() * speedX,
    vy: randomSign() * speedY,
  };
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomSign() {
  return Math.random() < 0.5 ? -1 : 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
