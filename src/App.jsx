import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import PortraitField from "./components/PortraitField.jsx";
import FaceCard from "./components/FaceCard.jsx";
import MosaicGeneratorSection from "./components/MosaicGeneratorSection.jsx";
import backgroundManifest from "./generated/background_manifest.json";
import storyManifest from "./generated/story_manifest.json";
import usePrefersReducedMotion from "./hooks/usePrefersReducedMotion.js";

gsap.registerPlugin(ScrollTrigger);

const BACKGROUND_MOODS = {
  question: {
    opacity: 0.32,
    blur: 5,
    scale: 1,
  },
  statement: {
    opacity: 0.36,
    blur: 4,
    scale: 0.995,
  },
  comparison: {
    opacity: 0.4,
    blur: 3.4,
    scale: 0.99,
  },
  mosaic: {
    opacity: 0.48,
    blur: 2,
    scale: 0.98,
  },
};

const percentageFormatter = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatCount(value) {
  return new Intl.NumberFormat("es-PE").format(value);
}

export default function App() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [backgroundMood, setBackgroundMood] = useState("question");
  const [mosaicBusy, setMosaicBusy] = useState(false);
  const rootRef = useRef(null);
  const questionSectionRef = useRef(null);
  const questionCopyRef = useRef(null);
  const questionFigureRef = useRef(null);
  const statementSectionRef = useRef(null);
  const regionsBySexSectionRef = useRef(null);
  const mosaicSectionRef = useRef(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const context = gsap.context(() => {
      const sections = [
        { element: questionSectionRef.current, mood: "question" },
        { element: statementSectionRef.current, mood: "statement" },
        { element: regionsBySexSectionRef.current, mood: "comparison" },
        { element: mosaicSectionRef.current, mood: "mosaic" },
      ];

      sections.forEach(({ element, mood }) => {
        if (!element) {
          return;
        }

        ScrollTrigger.create({
          trigger: element,
          start: "top center",
          end: "bottom center",
          onEnter: () => setBackgroundMood(mood),
          onEnterBack: () => setBackgroundMood(mood),
        });
      });

      if (prefersReducedMotion) {
        gsap.set(".js-reveal", {
          clearProps: "all",
        });
        return;
      }

      gsap.fromTo(
        questionFigureRef.current,
        {
          autoAlpha: 0,
          scale: 0.94,
          yPercent: 6,
          filter: "blur(18px)",
        },
        {
          autoAlpha: 1,
          scale: 1,
          yPercent: 0,
          filter: "blur(0px)",
          duration: 1.25,
          ease: "power3.out",
        },
      );

      gsap.fromTo(
        questionCopyRef.current,
        {
          autoAlpha: 0,
          y: 28,
        },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.95,
          ease: "power3.out",
        },
      );

      animateSection(statementSectionRef.current, ".story-slide-copy, .story-slide-portrait");
      animateSection(regionsBySexSectionRef.current, ".region-sex-band");
      animateSection(
        mosaicSectionRef.current,
        ".mosaic-panel, .mosaic-preview-card, .mosaic-stat-card",
      );
    }, root);

    return () => context.revert();
  }, [prefersReducedMotion]);

  const regionCount = storyManifest.summary.regionCount ?? storyManifest.summary.districtCount;
  const partyCount = storyManifest.summary.partyCount;
  const regionsBySex = getRegionsBySexGroups(storyManifest);
  return (
    <div
      ref={rootRef}
      className={`app-shell${prefersReducedMotion ? " reduced-motion" : ""}`}
    >
      <PortraitField
        manifest={backgroundManifest}
        reducedMotion={prefersReducedMotion}
        mood={BACKGROUND_MOODS[backgroundMood]}
        paused={mosaicBusy}
      />
      <div className="background-vignette" aria-hidden="true" />
      <div className="background-glow" aria-hidden="true" />

      <main className="story-shell">
        <section ref={questionSectionRef} className="story-slide story-slide-question">
          <div className="story-slide-stage">
            <div ref={questionCopyRef} className="story-slide-copy">
              <h1 className="story-slide-title">¿Conoces a este candidato?</h1>
            </div>

            <figure ref={questionFigureRef} className="story-slide-portrait story-slide-portrait-main">
              <img
                src={storyManifest.hero.assetUrl}
                alt="Rostro promedio nacional de las candidaturas al Congreso 2026"
              />
            </figure>
          </div>
        </section>

        <section ref={statementSectionRef} className="story-slide story-slide-statement js-reveal">
          <div className="story-slide-stage story-slide-stage-split">
            <div className="story-slide-copy">
              <h2 className="story-slide-title">Todos los candidatos son este candidato</h2>
              <p className="story-slide-stat">
                Hemos juntado el rostro de{" "}
                <span className="story-slide-stat-number">
                  {formatCount(storyManifest.summary.totalPortraits)}
                </span>{" "}
                candidatos de las{" "}
                <span className="story-slide-stat-number">{regionCount}</span> regiones y de los{" "}
                <span className="story-slide-stat-number">{partyCount}</span> partidos
              </p>
            </div>

            <figure className="story-slide-portrait story-slide-portrait-secondary">
              <img
                src={storyManifest.hero.assetUrl}
                alt="Rostro promedio nacional de las candidaturas al Congreso 2026"
              />
            </figure>
          </div>
        </section>

        <section
          ref={regionsBySexSectionRef}
          className="catalog-section region-sex-section"
        >
          <div className="section-shell region-sex-shell js-reveal">
            {regionsBySex.map((group) => (
              <article key={group.slug} className="region-sex-band">
                <div className="sex-callout">
                  <div className="sex-callout-face">
                    <img
                      src={group.overall.assetUrl}
                      alt={`Rostro promedio de ${group.label?.toLowerCase?.() ?? group.label}`}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <p className="sex-callout-copy">
                    {`Este es el rostro promedio de los candidatos ${
                      group.slug === "male" ? "hombres" : "mujeres"
                    } (${formatPercentage(group.overall.percentage)}% de candidatos)`}
                  </p>
                </div>

                <RegionStrip
                  items={group.regions}
                  label={`Rostros promedio por region de ${
                    group.label?.toLowerCase?.() ?? group.slug
                  }`}
                  prefersReducedMotion={prefersReducedMotion}
                  itemKeyPrefix={group.slug}
                />
              </article>
            ))}
          </div>
        </section>

        <MosaicGeneratorSection
          sectionRef={mosaicSectionRef}
          onBusyChange={setMosaicBusy}
          title="Todos tenemos un poco de cada candidato al congreso dentro de nostros"
        />
      </main>
    </div>
  );
}

function animateSection(section, itemSelector) {
  if (!section) {
    return;
  }

  const items = section.querySelectorAll(itemSelector);
  if (!items.length) {
    return;
  }

  gsap.fromTo(
    items,
    {
      opacity: 0,
      y: 36,
      scale: 0.98,
    },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.95,
      ease: "power3.out",
      stagger: {
        each: 0.12,
        from: "start",
      },
      scrollTrigger: {
        trigger: section,
        start: "top 68%",
      },
    },
  );
}

function getRegionsBySexGroups(manifest) {
  const regionShapeBySlug = new Map(
    (manifest.regions ?? []).map((region) => [region.slug, region.shapeUrl ?? ""]),
  );

  if (Array.isArray(manifest.regionsBySex) && manifest.regionsBySex.length) {
    return manifest.regionsBySex.map((group) => ({
      ...group,
      regions: (group.regions ?? []).map((region) => ({
        ...region,
        shapeUrl: region.shapeUrl || regionShapeBySlug.get(region.slug) || "",
      })),
    }));
  }

  const totalPortraits = manifest.summary?.totalPortraits || 1;

  return (manifest.sexes ?? []).map((sex) => ({
    slug: sex.slug,
    label: sex.label,
    overall: {
      ...sex,
      percentage: roundPercentage((sex.portraitCount ?? 0) / totalPortraits),
    },
    regions: (manifest.regions ?? []).map((region) => ({
      slug: region.slug,
      label: region.label,
      portraitCount: region.portraitCount,
      assetUrl: region.assetUrl,
      shapeUrl: region.shapeUrl ?? "",
    })),
  }));
}

function roundPercentage(value) {
  return Number((value * 100).toFixed(1));
}

function formatPercentage(value) {
  return percentageFormatter.format(value ?? 0);
}

function RegionStrip({ items, label, prefersReducedMotion, itemKeyPrefix }) {
  const stripRef = useRef(null);
  const stripId = useId();
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(items.length > 0);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return undefined;
    }

    function syncScrollState() {
      const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
      setCanScrollPrev(strip.scrollLeft > 4);
      setCanScrollNext(strip.scrollLeft < maxScroll - 4);
    }

    syncScrollState();
    strip.addEventListener("scroll", syncScrollState, { passive: true });

    let resizeObserver;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        syncScrollState();
      });
      resizeObserver.observe(strip);
    }

    window.addEventListener("resize", syncScrollState);

    return () => {
      strip.removeEventListener("scroll", syncScrollState);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncScrollState);
    };
  }, [items]);

  function handleStep(direction) {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }

    const step = Math.max(strip.clientWidth * 0.88, 220);
    strip.scrollBy({
      left: direction * step,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }

  return (
    <div className="region-sex-strip-shell">
      <button
        className="region-sex-strip-nav"
        type="button"
        aria-label={`Ir a los rostros anteriores de ${label}`}
        aria-controls={stripId}
        disabled={!canScrollPrev}
        onClick={() => handleStep(-1)}
      >
        <span aria-hidden="true">&lt;</span>
      </button>

      <div
        id={stripId}
        ref={stripRef}
        className="region-sex-strip"
        role="list"
        aria-label={label}
        tabIndex={0}
      >
        {items.map((item) => (
          <FaceCard
            key={`${itemKeyPrefix}-${item.slug}`}
            item={item}
            variant="strip"
            metaLabel="candidatos"
          />
        ))}
      </div>

      <button
        className="region-sex-strip-nav"
        type="button"
        aria-label={`Ir a los rostros siguientes de ${label}`}
        aria-controls={stripId}
        disabled={!canScrollNext}
        onClick={() => handleStep(1)}
      >
        <span aria-hidden="true">&gt;</span>
      </button>
    </div>
  );
}
