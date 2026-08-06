"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export type ScrollFilmScene = {
  id: string;
  chapter: string;
  title: string;
  body: string;
  image: string | null;
  alt: string;
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

export function ScrollFilm({
  scenes,
  scrollLabel
}: {
  scenes: ScrollFilmScene[];
  scrollLabel: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const update = () => {
      frameRef.current = null;
      const section = sectionRef.current;
      if (!section) return;

      const rect = section.getBoundingClientRect();
      const travel = Math.max(1, section.offsetHeight - window.innerHeight);
      const next = clamp(-rect.top / travel);
      setProgress((current) =>
        Math.abs(current - next) > 0.0005 ? next : current
      );
    };

    const requestUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const timelinePosition = progress * Math.max(1, scenes.length - 1);
  const activeIndex = clamp(Math.round(timelinePosition), 0, scenes.length - 1);
  const counter = useMemo(
    () => String(activeIndex + 1).padStart(2, "0"),
    [activeIndex]
  );

  return (
    <section
      ref={sectionRef}
      className="mk-film"
      style={{ "--film-scenes": scenes.length } as CSSProperties}
      aria-label="Scroll story"
    >
      <div className="mk-film-sticky">
        <div className="mk-film-stage">
          {scenes.map((scene, index) => {
            const delta = timelinePosition - index;
            const distance = Math.abs(delta);
            const sceneOpacity = clamp(1 - distance);
            const copyOpacity = clamp(1 - distance * 1.9);
            const scale = 1.075 + delta * 0.035;
            const shift = delta * -3.5;
            const copyShift = delta * -56;

            return (
              <article
                key={scene.id}
                className={`mk-film-scene${index === activeIndex ? " is-active" : ""}`}
                style={
                  {
                    "--scene-opacity": sceneOpacity,
                    "--scene-scale": scale,
                    "--scene-shift": `${shift}%`,
                    "--copy-opacity": copyOpacity,
                    "--copy-shift": `${copyShift}px`
                  } as CSSProperties
                }
                aria-hidden={index !== activeIndex}
              >
                <div className="mk-film-image-wrap">
                  {scene.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={scene.image}
                      alt={scene.alt}
                      loading="eager"
                      decoding="async"
                    />
                  ) : (
                    <div className="mk-film-fallback" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>

                <div className="mk-film-shade" aria-hidden="true" />
                <div className="mk-film-grid" aria-hidden="true" />
                <div className="mk-film-scan" aria-hidden="true" />

                <div className="mk-film-copy">
                  <p>{scene.chapter}</p>
                  <h1>{scene.title}</h1>
                  <span>{scene.body}</span>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mk-film-ui" aria-hidden="true">
          <div className="mk-film-counter">
            <strong>{counter}</strong>
            <span>/ {String(scenes.length).padStart(2, "0")}</span>
          </div>
          <div className="mk-film-progress">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="mk-film-scroll">
            <span>{scrollLabel}</span>
            <i>↓</i>
          </div>
        </div>

        <nav className="mk-film-dots" aria-label="Story progress">
          {scenes.map((scene, index) => (
            <a
              key={scene.id}
              href={`#film-${scene.id}`}
              className={index === activeIndex ? "is-active" : undefined}
              aria-label={scene.chapter}
              onClick={(event) => {
                event.preventDefault();
                const section = sectionRef.current;
                if (!section) return;
                const travel = section.offsetHeight - window.innerHeight;
                const ratio = index / Math.max(1, scenes.length - 1);
                window.scrollTo({
                  top: section.offsetTop + travel * ratio,
                  behavior: "smooth"
                });
              }}
            />
          ))}
        </nav>
      </div>

      <div className="mk-film-markers" aria-hidden="true">
        {scenes.map((scene) => (
          <span key={scene.id} id={`film-${scene.id}`} />
        ))}
      </div>
    </section>
  );
}
