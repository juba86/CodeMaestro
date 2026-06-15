import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CodeMaestro",
    short_name: "CodeMaestro",
    description: "Conduct a fleet of AI coding agents — from anywhere",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#111113",
    theme_color: "#111113",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
