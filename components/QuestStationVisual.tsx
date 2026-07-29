"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./QuestStationVisual.module.css";

type StatePayload = {
  participant: { language: "he" | "en" };
  run: { status: string };
  team: { status: string };
  checkpoint: null | {
    slug: string;
    content: Record<string, unknown>;
  };
};

const imageFor = (state: StatePayload | null) => {
  if (!state?.checkpoint || state.run.status !== "active" || state.team.status === "finished") {
    return null;
  }
  const localized = state.checkpoint.content[state.participant.language];
  const content = localized && typeof localized === "object" && !Array.isArray(localized)
    ? localized as Record<string, unknown>
    : {};
  const imageUrl = typeof content.imageUrl === "string" ? content.imageUrl.trim() : "";
  const title = typeof content.title === "string" ? content.title : "";
  return imageUrl ? { imageUrl, title, slug: state.checkpoint.slug } : null;
};

export function QuestStationVisual({ token }: { token: string }) {
  const [visual, setVisual] = useState<ReturnType<typeof imageFor>>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/participants/${encodeURIComponent(token)}/state`,
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (response.ok && payload.ok) setVisual(imageFor(payload.data as StatePayload));
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        await refresh();
      } catch {
        if (!cancelled) setVisual(null);
      }
    };
    const start = () => {
      void run();
      window.clearInterval(timer);
      timer = window.setInterval(run, 7000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  if (!visual) return null;

  return (
    <figure className={styles.visual} key={visual.slug}>
      <img src={visual.imageUrl} alt={visual.title} />
      <figcaption>{visual.title}</figcaption>
    </figure>
  );
}
