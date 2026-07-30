"use client";

import { useMemo } from "react";
import { useQuestRealtime } from "@/components/QuestRealtimeProvider";
import type { QuestActivityEntry, QuestConnectionState } from "@/lib/quest-realtime-types";
import styles from "./QuestRealtimeStatusPanel.module.css";

const connectionCopy: Record<
  QuestConnectionState,
  { he: string; en: string }
> = {
  connecting: { he: "מתחבר בזמן אמת", en: "Connecting live" },
  live: { he: "מחובר בזמן אמת", en: "Live connection" },
  reconnecting: { he: "מתחבר מחדש", en: "Reconnecting" },
  offline: { he: "אין חיבור לרשת", en: "Offline" },
  stale: { he: "המידע עלול להיות לא מעודכן", en: "State may be stale" }
};

const eventCopy = (
  event: QuestActivityEntry,
  he: boolean
): string => {
  const actor = event.actorName || (he ? "חבר בקבוצה" : "A teammate");
  const messages: Record<string, [string, string]> = {
    PLAYER_JOINED: [`${actor} הצטרף למשחק`, `${actor} joined the quest`],
    PLAYER_CONFIRMED_WHATSAPP: [
      `${actor} חיבר את WhatsApp`,
      `${actor} connected WhatsApp`
    ],
    RUN_STARTED: ["המרוץ התחיל", "The race started"],
    HINT_REQUESTED: [`${actor} חשף רמז`, `${actor} revealed a hint`],
    LOCATION_VERIFIED: [`${actor} אימת את המיקום`, `${actor} verified the location`],
    STATION_SCANNED: [`${actor} סרק את התחנה`, `${actor} scanned the checkpoint`],
    ANSWER_ACCEPTED: [`${actor} פתר את התחנה`, `${actor} solved the checkpoint`],
    ANSWER_REJECTED: [`${actor} ניסה תשובה`, `${actor} tried an answer`],
    OPTIONAL_CHECKPOINT_SKIPPED: [
      `${actor} דילג על תחנה אופציונלית`,
      `${actor} skipped an optional checkpoint`
    ],
    ORGANIZER_CHECKPOINT_SKIPPED: [
      "המארגן דילג על התחנה עבור הקבוצה",
      "The organizer skipped the checkpoint for the team"
    ],
    PHOTO_APPROVED: [`התמונה של ${actor} אושרה`, `${actor}'s photo was approved`],
    PHOTO_REJECTED: [
      `התמונה של ${actor} לא אושרה`,
      `${actor}'s photo was not approved`
    ]
  };
  return messages[event.eventType]?.[he ? 0 : 1] ?? event.eventType;
};

const relativeTime = (createdAt: string, he: boolean) => {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  );
  if (seconds < 15) return he ? "עכשיו" : "now";
  if (seconds < 60) return he ? `לפני ${seconds} שנ׳` : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return he ? `לפני ${minutes} דק׳` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return he ? `לפני ${hours} שע׳` : `${hours}h ago`;
};

export function QuestRealtimeStatusPanel() {
  const { state, presence, connectionState, lastSyncedAt } = useQuestRealtime();
  const language = state?.participant.language ?? "he";
  const he = language === "he";
  const onlineIds = useMemo(
    () => new Set(presence.map((member) => member.participantId)),
    [presence]
  );
  const activity = state?.activity ?? [];

  if (!state) return null;

  return (
    <aside className={styles.shell} dir={he ? "rtl" : "ltr"}>
      <div className={`${styles.connection} ${styles[connectionState]}`}>
        <i aria-hidden="true" />
        <span>{connectionCopy[connectionState][he ? "he" : "en"]}</span>
        {lastSyncedAt && connectionState !== "live" && (
          <small>
            {he ? "סנכרון אחרון" : "Last sync"}: {relativeTime(new Date(lastSyncedAt).toISOString(), he)}
          </small>
        )}
      </div>

      <details className={styles.details}>
        <summary>
          <span>{he ? "הקבוצה בזמן אמת" : "Live team"}</span>
          <strong>
            {presence.length}/{state.members.length} {he ? "מחוברים" : "online"}
          </strong>
        </summary>

        <section className={styles.members} aria-label={he ? "חברי קבוצה" : "Team members"}>
          {state.members.map((member) => {
            const online = onlineIds.has(member.id);
            const live = presence.find((entry) => entry.participantId === member.id);
            return (
              <div key={member.id}>
                <i className={online ? styles.onlineDot : styles.offlineDot} />
                <span>{member.firstName}</span>
                <small>
                  {online
                    ? live && live.deviceCount > 1
                      ? he
                        ? `${live.deviceCount} מכשירים`
                        : `${live.deviceCount} devices`
                      : he
                        ? "מחובר"
                        : "online"
                    : he
                      ? "לא מחובר"
                      : "offline"}
                </small>
              </div>
            );
          })}
        </section>

        <section className={styles.activity} aria-label={he ? "פעילות אחרונה" : "Recent activity"}>
          <h2>{he ? "מה קרה עכשיו" : "What just happened"}</h2>
          {activity.slice(0, 8).map((event) => (
            <div key={event.id}>
              <span>{eventCopy(event, he)}</span>
              <time dateTime={event.createdAt}>{relativeTime(event.createdAt, he)}</time>
            </div>
          ))}
          {!activity.length && (
            <p>{he ? "הפעילות תופיע כאן במהלך המשחק." : "Live activity will appear here."}</p>
          )}
        </section>
      </details>
    </aside>
  );
}
