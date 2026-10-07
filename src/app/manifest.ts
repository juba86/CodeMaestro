import type { MetadataRoute } from "next";

const ICON_192 = { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" };

export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable id keeps installed apps tied to this manifest even if start_url changes.
    id: "/",
    name: "CodeMaestro",
    short_name: "CodeMaestro",
    description: "Steuere eine Flotte von KI-Coding-Agenten — von überall",
    lang: "de",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#111113",
    theme_color: "#111113",
    categories: ["developer", "productivity", "utilities"],
    icons: [
      ICON_192,
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Code Assistant", short_name: "Assistant", url: "/assistant", icons: [ICON_192] },
      { name: "Prompt Builder", short_name: "Builder", url: "/builder", icons: [ICON_192] },
      { name: "Bibliothek", short_name: "Bibliothek", url: "/library", icons: [ICON_192] },
    ],
    screenshots: [
      {
        src: "/screenshots/assistant.png",
        sizes: "1440x900",
        type: "image/png",
        form_factor: "wide",
        label: "Code Assistant mit Live-Ausgabe und Freigaben",
      },
      {
        src: "/screenshots/builder.png",
        sizes: "1440x900",
        type: "image/png",
        form_factor: "wide",
        label: "Prompt Builder",
      },
    ],
  };
}
