import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TLV Quest",
    short_name: "TLV Quest",
    description: "A live, bilingual urban quest companion.",
    start_url: "/resume",
    display: "standalone",
    background_color: "#08131f",
    theme_color: "#08131f",
    orientation: "portrait",
    lang: "he",
    dir: "rtl",
    categories: ["entertainment", "games", "travel"],
    icons: [
      {
        src: "/visuals/quest-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  };
}
