import React, { useEffect, useRef } from "react";

const DEFAULT_MOOD = {
  opacity: 0.32,
  blur: 5,
  scale: 1,
};

export default function PortraitField({
  manifest,
  mood = DEFAULT_MOOD,
  reducedMotion,
  paused = false,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }

    let animationFrameId = 0;
    let imageLoaded = false;
    let disposed = false;
    let pattern = null;
    const atlas = new Image();
    atlas.decoding = "async";
    atlas.src = manifest.atlasUrl;

    const resizeCanvas = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const pixelRatio = 1;

      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "medium";
    };

    const draw = (time = 0) => {
      if (disposed || !imageLoaded) {
        return;
      }

      const width = window.innerWidth;
      const height = window.innerHeight;
      const atlasWidth = manifest.atlasWidth;
      const atlasHeight = manifest.atlasHeight;
      const motionScale = paused ? 0 : 0.45;
      const offsetX = reducedMotion
        ? 0
        : -((time * manifest.speedX * 0.001 * motionScale) % atlasWidth);
      const offsetY = reducedMotion
        ? 0
        : -((time * manifest.speedY * 0.001 * motionScale) % atlasHeight);

      context.clearRect(0, 0, width, height);

      if (pattern && typeof pattern.setTransform === "function" && typeof DOMMatrix === "function") {
        pattern.setTransform(new DOMMatrix().translate(offsetX, offsetY));
        context.fillStyle = pattern;
        context.fillRect(0, 0, width, height);
      } else {
        const startX = offsetX - atlasWidth;
        const startY = offsetY - atlasHeight;
        for (let column = 0; column < 3; column += 1) {
          for (let row = 0; row < 3; row += 1) {
            context.drawImage(
              atlas,
              startX + column * atlasWidth,
              startY + row * atlasHeight,
              atlasWidth,
              atlasHeight,
            );
          }
        }
      }

      if (!reducedMotion && !paused) {
        animationFrameId = window.requestAnimationFrame(draw);
      }
    };

    atlas.onload = () => {
      imageLoaded = true;
      pattern = context.createPattern(atlas, "repeat");
      resizeCanvas();
      draw();
    };

    const handleResize = () => {
      resizeCanvas();
      draw(performance.now());
    };

    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [manifest, paused, reducedMotion]);

  return (
    <div
      className="portrait-field"
      aria-hidden="true"
      style={{
        opacity: mood.opacity,
        filter: `blur(${mood.blur}px)`,
        transform: `scale(${mood.scale})`,
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
