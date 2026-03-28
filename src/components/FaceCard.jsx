import React from "react";

const countFormatter = new Intl.NumberFormat("es-PE");

export default function FaceCard({
  item,
  variant = "default",
  showShape = true,
  metaLabel = "retratos",
}) {
  const className = [
    "face-card",
    variant === "compact" ? "face-card-compact" : "",
    variant === "strip" ? "face-card-strip" : "",
    item.shapeUrl ? "face-card-with-shape" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <figure className={className}>
      <div className="face-card-media">
        <img
          src={item.assetUrl}
          alt={`Rostro promedio de ${item.label}`}
          loading="lazy"
          decoding="async"
        />
      </div>
      <figcaption className="face-card-copy">
        <div className="face-card-heading">
          <p className="face-card-title">{item.label}</p>
          {showShape && item.shapeUrl ? (
            <img
              className="face-card-shape"
              src={item.shapeUrl}
              alt=""
              loading="lazy"
              decoding="async"
              aria-hidden="true"
            />
          ) : null}
        </div>
        <p className="face-card-meta">
          {countFormatter.format(item.portraitCount)} {metaLabel}
        </p>
      </figcaption>
    </figure>
  );
}
