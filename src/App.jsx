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

const SOURCE_CODE_URL = "https://github.com/jruizcabrejos/este-candidato-no-existe";
const INCASLOP_URL = "https://incaslop.online/";
const INCASLOP_INSTAGRAM_URL = "https://www.instagram.com/incaslop/";

function formatCount(value) {
  return new Intl.NumberFormat("es-PE").format(value);
}

export default function App() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [backgroundMood, setBackgroundMood] = useState("question");
  const [mosaicBusy, setMosaicBusy] = useState(false);
  const [questionFaceSeed] = useState(() => createQuestionFaceSeed());
  const [questionFaceIndex, setQuestionFaceIndex] = useState(0);
  const [activeDrawer, setActiveDrawer] = useState(null);
  const rootRef = useRef(null);
  const questionSectionRef = useRef(null);
  const questionCopyRef = useRef(null);
  const questionFigureRef = useRef(null);
  const statementSectionRef = useRef(null);
  const drawerSectionRef = useRef(null);
  const mosaicSectionRef = useRef(null);
  const drawerPanelId = useId();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const context = gsap.context(() => {
      const sections = [
        { element: questionSectionRef.current, mood: "question" },
        { element: statementSectionRef.current, mood: "statement" },
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
      animateSection(
        mosaicSectionRef.current,
        ".mosaic-panel, .mosaic-preview-card, .composition-panel",
      );
    }, root);

    return () => context.revert();
  }, [prefersReducedMotion]);

  const regionCount = storyManifest.summary.regionCount ?? storyManifest.summary.districtCount;
  const partyCount = storyManifest.summary.partyCount;
  const regionsBySex = getRegionsBySexGroups(storyManifest);
  const partiesBySex = getPartiesBySexGroups(storyManifest);
  const questionFaces = getQuestionFaces(regionsBySex, partiesBySex, questionFaceSeed);

  useEffect(() => {
    setQuestionFaceIndex(0);
  }, [questionFaces.length]);

  useEffect(() => {
    if (prefersReducedMotion || questionFaces.length < 2) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setQuestionFaceIndex((current) => (current + 1) % questionFaces.length);
    }, 2400);

    return () => window.clearInterval(intervalId);
  }, [prefersReducedMotion, questionFaces.length]);

  useEffect(() => {
    if (!activeDrawer || !drawerSectionRef.current) {
      return undefined;
    }

    const trigger = ScrollTrigger.create({
      trigger: drawerSectionRef.current,
      start: "top center",
      end: "bottom center",
      onEnter: () => setBackgroundMood("comparison"),
      onEnterBack: () => setBackgroundMood("comparison"),
    });

    ScrollTrigger.refresh();
    return () => trigger.kill();
  }, [activeDrawer]);

  useEffect(() => {
    if (!activeDrawer || !drawerSectionRef.current) {
      return;
    }

    drawerSectionRef.current.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [activeDrawer, prefersReducedMotion]);

  useEffect(() => {
    if (!activeDrawer || prefersReducedMotion || !drawerSectionRef.current) {
      return undefined;
    }

    const selector = activeDrawer === "regions" ? ".region-sex-band" : ".party-band";
    const items = drawerSectionRef.current.querySelectorAll(selector);
    if (!items.length) {
      return undefined;
    }

    const animation = gsap.fromTo(
      items,
      {
        autoAlpha: 0,
        y: 28,
        scale: 0.98,
      },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.72,
        ease: "power3.out",
        stagger: 0.08,
      },
    );

    return () => animation.kill();
  }, [activeDrawer, prefersReducedMotion]);

  function handleDrawerToggle(nextDrawer) {
    setActiveDrawer((current) => (current === nextDrawer ? null : nextDrawer));
  }

  function handleQuestionScrollCueClick() {
    statementSectionRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }

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
          <div className="story-slide-stage story-slide-stage-question">
            <div className="story-slide-question-content">
              <div ref={questionCopyRef} className="story-slide-copy">
                <h1 className="story-slide-title">{"\u00BFConoces a este candidato?"}</h1>
              </div>

              <figure
                ref={questionFigureRef}
                className="story-slide-portrait story-slide-portrait-main story-slide-question-portrait"
              >
                <div className="question-face-window" aria-live="off">
                  <div
                    className={`question-face-track${
                      prefersReducedMotion ? " question-face-track-static" : ""
                    }`}
                  >
                    {getQuestionFaceFrames(questionFaces, questionFaceIndex).map((frame) => (
                      <div
                        key={frame.renderKey}
                        className={`question-face-slide question-face-slide-${frame.slot}`}
                        aria-hidden={frame.slot !== "center"}
                      >
                        <img
                          src={frame.assetUrl}
                          alt={frame.slot === "center" ? frame.alt : ""}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </figure>
            </div>

            <button
              className="story-slide-scroll-cue"
              type="button"
              aria-label="Ir a la siguiente seccion"
              onClick={handleQuestionScrollCueClick}
            >
              <span className="story-slide-scroll-cue-line" />
              <span className="story-slide-scroll-cue-arrow">↓</span>
            </button>
          </div>
        </section>

        <section ref={statementSectionRef} className="story-slide story-slide-statement js-reveal">
          <div className="story-slide-stage story-slide-stage-split story-slide-stage-ghosted">
            <img
              className="story-slide-background-face"
              src={storyManifest.hero.assetUrl}
              alt=""
              aria-hidden="true"
            />
            <div className="story-slide-copy">
              <h2 className="story-slide-title">Todos los candidatos son este candidato</h2>
              <p className="story-slide-stat">
                Hemos juntado el rostro de{" "}
                <span className="story-slide-stat-number">
                  {formatCount(storyManifest.summary.totalPortraits)}
                </span>{" "}
                candidatos a diputados en las elecciones generales de Peru de 2026:{" "}
                <button
                  className={`story-slide-stat-button${
                    activeDrawer === "regions" ? " is-active" : ""
                  }`}
                  type="button"
                  aria-expanded={activeDrawer === "regions"}
                  aria-controls={drawerPanelId}
                  onClick={() => handleDrawerToggle("regions")}
                >
                  {regionCount} regiones
                </button>{" "}
                y{" "}
                <button
                  className={`story-slide-stat-button${
                    activeDrawer === "parties" ? " is-active" : ""
                  }`}
                  type="button"
                  aria-expanded={activeDrawer === "parties"}
                  aria-controls={drawerPanelId}
                  onClick={() => handleDrawerToggle("parties")}
                >
                  {partyCount} partidos
                </button>
              </p>
            </div>

            <div className="story-slide-portrait-block">
              <figure className="story-slide-portrait story-slide-portrait-secondary">
                <img
                  src={storyManifest.hero.assetUrl}
                  alt="Rostro promedio nacional de las candidaturas al Congreso 2026"
                />
              </figure>
              <p className="story-slide-portrait-note">
                Este es el rostro{" "}
                <span className="story-slide-portrait-note-script">promedio</span>
              </p>
            </div>
          </div>
        </section>

        {activeDrawer ? (
          <section
            id={drawerPanelId}
            ref={drawerSectionRef}
            className="catalog-section region-sex-section story-drawer-section"
          >
            <div className="section-shell region-sex-shell story-drawer-shell js-reveal">
              <header className="story-drawer-header">
                <p className="story-drawer-switcher-label">Explora por</p>
                <div
                  className="story-drawer-switcher"
                  role="tablist"
                  aria-label="Cambiar entre region y partido"
                >
                  <button
                    className={`story-drawer-switcher-button${
                      activeDrawer === "regions" ? " is-active" : ""
                    }`}
                    type="button"
                    role="tab"
                    aria-selected={activeDrawer === "regions"}
                    onClick={() => setActiveDrawer("regions")}
                  >
                    Region
                  </button>
                  <button
                    className={`story-drawer-switcher-button${
                      activeDrawer === "parties" ? " is-active" : ""
                    }`}
                    type="button"
                    role="tab"
                    aria-selected={activeDrawer === "parties"}
                    onClick={() => setActiveDrawer("parties")}
                  >
                    Partido
                  </button>
                </div>
              </header>

              {activeDrawer === "regions" ? (
                regionsBySex.map((group) => (
                  <article key={group.slug} className="region-sex-band">
                    <div className="sex-callout">
                      <p className="sex-callout-copy">
                        {`Este es el rostro promedio de los candidatos ${
                          getSexLabelWithSymbol(group.slug)
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
                ))
              ) : partiesBySex.length ? (
                partiesBySex.map((group) => (
                  <article key={group.slug} className="region-sex-band party-band">
                    <div className="sex-callout">
                      <p className="sex-callout-copy">
                        {`Estos son los rostros promedio por afiliacion de ${
                          getSexLabelWithSymbol(group.slug)
                        } (${formatPercentage(group.overall.percentage)}% de candidatos)`}
                      </p>
                    </div>

                    <RegionStrip
                      items={group.items}
                      label={`Rostros promedio por afiliacion de ${
                        group.label?.toLowerCase?.() ?? group.slug
                      }`}
                      prefersReducedMotion={prefersReducedMotion}
                      itemKeyPrefix={`party-${group.slug}`}
                    />
                  </article>
                ))
              ) : (
                <article className="region-sex-band party-band">
                  <div className="sex-callout">
                    <p className="sex-callout-copy">
                      Rostros promedio por afiliacion politica disponibles en el dataset.
                    </p>
                  </div>

                  <RegionStrip
                    items={storyManifest.parties}
                    label="Rostros promedio por afiliacion politica"
                    prefersReducedMotion={prefersReducedMotion}
                    itemKeyPrefix="party"
                  />
                </article>
              )}
            </div>
          </section>
        ) : null}

        <MosaicGeneratorSection
          sectionRef={mosaicSectionRef}
          onBusyChange={setMosaicBusy}
          title={"Todos tenemos un poco de cada candidato:\n\u00BFCu\u00E1les tienes t\u00FA?"}
        />

        <footer className="site-footer">
          <div className="site-footer-shell">
            <a
              className="site-footer-brand"
              href={INCASLOP_URL}
              target="_blank"
              rel="noreferrer"
            >
              <img className="site-footer-logo" src="/favicon/logo.png" alt="IncaSlop" />
              <span className="site-footer-brand-copy">
                <span className="site-footer-brand-label">IncaSlop</span>
                <span className="site-footer-brand-note">Colectivo y archivo vivo</span>
              </span>
            </a>

            <div className="site-footer-socials" aria-label="Enlaces de IncaSlop y del proyecto">
              <a
                className="site-footer-social-link"
                href={SOURCE_CODE_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub del proyecto"
              >
                <span className="site-footer-social-icon" aria-hidden="true">
                  <GitHubIcon />
                </span>
                <span>GitHub</span>
              </a>
              <a
                className="site-footer-social-link"
                href={INCASLOP_INSTAGRAM_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram de IncaSlop"
              >
                <span className="site-footer-social-icon" aria-hidden="true">
                  <InstagramIcon />
                </span>
                <span>Instagram</span>
              </a>
            </div>
          </div>
        </footer>
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

function getPartiesBySexGroups(manifest) {
  const sourceGroups = manifest.partiesBySex ?? manifest.affiliationsBySex ?? [];
  if (!Array.isArray(sourceGroups) || !sourceGroups.length) {
    return [];
  }

  const totalPortraits = manifest.summary?.totalPortraits || 1;

  return sourceGroups.map((group) => {
    const items = group.items ?? group.parties ?? group.affiliations ?? group.regions ?? [];
    return {
      ...group,
      overall: {
        ...group.overall,
        percentage:
          typeof group.overall?.percentage === "number"
            ? group.overall.percentage
            : roundPercentage((group.overall?.portraitCount ?? 0) / totalPortraits),
      },
      items,
    };
  });
}

function roundPercentage(value) {
  return Number((value * 100).toFixed(1));
}

function formatPercentage(value) {
  return percentageFormatter.format(value ?? 0);
}

function getSexLabelWithSymbol(slug) {
  return slug === "male" ? "hombres ♂" : "mujeres ♀";
}

function getQuestionFaces(regionGroups, partyGroups, seed = 0) {
  const facesBySex = {
    male: [],
    female: [],
    other: [],
  };

  regionGroups.forEach((group) => {
    const groupKey = getQuestionFaceGroupKey(group.slug);
    const label = group.slug === "male" ? "hombres" : "mujeres";

    (group.regions ?? []).forEach((region) => {
      facesBySex[groupKey].push({
        key: `region-${group.slug}-${region.slug}`,
        assetUrl: region.assetUrl,
        alt: `Rostro promedio de ${label} en ${region.label}`,
      });
    });
  });

  partyGroups.forEach((group) => {
    const groupKey = getQuestionFaceGroupKey(group.slug);
    const label = group.slug === "male" ? "hombres" : "mujeres";

    (group.items ?? []).forEach((party) => {
      facesBySex[groupKey].push({
        key: `party-${group.slug}-${party.slug}`,
        assetUrl: party.assetUrl,
        alt: `Rostro promedio por afiliacion de ${label} en ${party.label}`,
      });
    });
  });

  const faces = buildQuestionFaceSequence(facesBySex, seed);

  return faces.length
    ? faces
    : [
        {
          key: "hero-fallback",
          assetUrl: storyManifest.hero.assetUrl,
          alt: "Rostro promedio nacional de las candidaturas al Congreso 2026",
        },
      ];
}

function getQuestionFaceGroupKey(slug) {
  return slug === "male" || slug === "female" ? slug : "other";
}

function buildQuestionFaceSequence(facesBySex, seed) {
  const random = createSeededRandom(seed);
  const pools = {
    male: shuffleQuestionFaces(facesBySex.male ?? [], random),
    female: shuffleQuestionFaces(facesBySex.female ?? [], random),
    other: shuffleQuestionFaces(facesBySex.other ?? [], random),
  };
  const sequence = [];
  let previousGroup = "";
  let streak = 0;

  while (pools.male.length || pools.female.length || pools.other.length) {
    const nextGroup = pickNextQuestionFaceGroup(pools, previousGroup, streak, random);
    if (!nextGroup) {
      break;
    }

    const nextFace = pools[nextGroup].shift();
    if (!nextFace) {
      continue;
    }

    sequence.push(nextFace);
    if (nextGroup === previousGroup) {
      streak += 1;
    } else {
      previousGroup = nextGroup;
      streak = 1;
    }
  }

  if (sequence.length < 2) {
    return sequence;
  }

  const startOffset = Math.floor(random() * sequence.length);
  return rotateQuestionFaces(sequence, startOffset);
}

function shuffleQuestionFaces(faces, random) {
  const shuffled = [...faces];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function pickNextQuestionFaceGroup(pools, previousGroup, streak, random) {
  const availableGroups = Object.entries(pools).filter(([, pool]) => pool.length);
  if (!availableGroups.length) {
    return "";
  }

  const alternateGroups = availableGroups.filter(([groupKey]) => groupKey !== previousGroup);
  const shouldForceSwitch = previousGroup && alternateGroups.length && streak >= 2;
  const shouldPreferSwitch =
    previousGroup && alternateGroups.length && !shouldForceSwitch && random() < 0.72;
  const candidateGroups =
    shouldForceSwitch || shouldPreferSwitch ? alternateGroups : availableGroups;
  const totalWeight = candidateGroups.reduce((sum, [, pool]) => sum + pool.length, 0);
  let threshold = random() * totalWeight;

  for (const [groupKey, pool] of candidateGroups) {
    threshold -= pool.length;
    if (threshold <= 0) {
      return groupKey;
    }
  }

  return candidateGroups[candidateGroups.length - 1]?.[0] ?? "";
}

function rotateQuestionFaces(faces, offset) {
  if (!faces.length || !offset) {
    return faces;
  }

  return faces.slice(offset).concat(faces.slice(0, offset));
}

function createQuestionFaceSeed() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }

  return Math.floor(Math.random() * 4294967296);
}

function createSeededRandom(seed) {
  let state = (Number(seed) || 0) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function getQuestionFaceFrames(faces, activeIndex) {
  if (!faces.length) {
    return [];
  }

  const total = faces.length;
  const centerIndex = activeIndex % total;
  const leftIndex = (centerIndex - 1 + total) % total;
  const rightIndex = (centerIndex + 1) % total;

  return [
    {
      ...faces[leftIndex],
      slot: "left",
      renderKey: `left-${faces[leftIndex].key}-${centerIndex}`,
    },
    {
      ...faces[centerIndex],
      slot: "center",
      renderKey: `center-${faces[centerIndex].key}-${centerIndex}`,
    },
    {
      ...faces[rightIndex],
      slot: "right",
      renderKey: `right-${faces[rightIndex].key}-${centerIndex}`,
    },
  ];
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

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.25a8.75 8.75 0 0 0-2.77 17.05c.44.08.6-.19.6-.43v-1.53c-2.45.53-2.97-1.04-2.97-1.04-.4-1.01-.98-1.28-.98-1.28-.8-.54.06-.53.06-.53.88.06 1.34.9 1.34.9.78 1.34 2.06.95 2.56.73.08-.57.3-.95.55-1.17-1.95-.22-4-.98-4-4.36 0-.96.34-1.74.9-2.35-.09-.22-.39-1.12.09-2.34 0 0 .73-.23 2.4.9a8.2 8.2 0 0 1 4.37 0c1.67-1.13 2.4-.9 2.4-.9.48 1.22.18 2.12.09 2.34.56.61.9 1.39.9 2.35 0 3.39-2.05 4.13-4 4.35.31.27.59.81.59 1.64v2.43c0 .24.16.51.61.43A8.75 8.75 0 0 0 12 3.25Z"
        fill="currentColor"
      />
      <path
        d="M8.46 18.26c.49.16.95.24 1.37.24v-1.31c-1.53.25-2.16-.5-2.5-1.04.28.83.63 1.63 1.13 2.11Z"
        fill="var(--brand-gold)"
      />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="4.25"
        y="4.25"
        width="15.5"
        height="15.5"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="3.75" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.3" cy="6.7" r="1.2" fill="var(--brand-gold)" />
    </svg>
  );
}
