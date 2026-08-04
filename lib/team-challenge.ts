export type TeamRole = { title: string; instruction: string };

export const teamRolesForCheckpoint = ({ kind, participantCount, locale }: {
  kind: string;
  participantCount: number;
  locale: "he" | "en";
}): TeamRole[] => {
  if (participantCount < 2) return [];
  const he = locale === "he";
  if (kind === "photo") {
    return he
      ? [
          { title: "במאי/ת", instruction: "בוחר/ת את הזווית ובודק/ת שהצילום בטוח וברור." },
          { title: "מבצע/ת", instruction: "יוצר/ת את הפריים ומציע/ה שינוי יצירתי אחד." }
        ]
      : [
          { title: "Director", instruction: "Choose the angle and make sure the shot is safe and clear." },
          { title: "Performer", instruction: "Build the frame and suggest one creative change." }
        ];
  }
  return he
    ? [
        { title: "סורק/ת", instruction: "מסתכל/ת סביב ומחפש/ת ראיה בשטח לפני שקוראים את התשובות." },
        { title: "מפענח/ת", instruction: "קורא/ת את החידה ובודק/ת אם הראיה באמת תומכת בתשובה." }
      ]
    : [
        { title: "Scanner", instruction: "Look around for field evidence before reading the answers." },
        { title: "Decoder", instruction: "Read the puzzle and test whether the evidence supports the answer." }
      ];
};
