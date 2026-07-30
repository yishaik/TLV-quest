"use client";

import { useQuestRealtime } from "@/components/QuestRealtimeProvider";
import type { QuestParticipantState } from "@/lib/quest-realtime-types";
import styles from "./QuestStationVisual.module.css";

const imageFor = (state: QuestParticipantState | null) => {
  if (!state?.checkpoint || state.run.status !== "active" || state.team.status === "finished") {
    return null;
  }
  const localized = state.checkpoint.content[state.participant.language];
  const content =
    localized && typeof localized === "object" && !Array.isArray(localized)
      ? (localized as Record<string, unknown>)
      : {};
  const imageUrl = typeof content.imageUrl === "string" ? content.imageUrl.trim() : "";
  const title = typeof content.title === "string" ? content.title : "";
  return imageUrl ? { imageUrl, title, slug: state.checkpoint.slug } : null;
};

export function QuestStationVisual() {
  const { state } = useQuestRealtime();
  const visual = imageFor(state);
  if (!visual) return null;

  return (
    <figure className={styles.visual} key={visual.slug}>
      <img src={visual.imageUrl} alt={visual.title} />
      <figcaption>{visual.title}</figcaption>
    </figure>
  );
}
