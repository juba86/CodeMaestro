# GME Chart Runner

This document contains notes on the assets, theming, and deployment of the GME Chart Runner game.

## Asset & Theming Notes

*   **Art Style:** A retro, 16-bit pixel art style is recommended. This is performant and aligns with the "game" theme.
    *   **Player:** An "ape" or "diamond-handed" character sprite.
    *   **Terrain:** Green candles are solid ground. Red candles are visually distinct (e.g., glowing red, crumbling) to signal danger.
    *   **Enemies:**
        *   **Red Candlesticks:** Can be animated to look like falling meteors or simple hazards.
        *   **Citadel Agents:** Stylized corporate drones in suits, perhaps with menacing red eyes. Projectiles could be dollar signs or red arrows.
    *   **Short Squeeze:** A spectacular visual effect. The background chart goes vertical, particle effects explode, "tendies" (chicken tenders, a meme) rain down.
*   **Audio:** Chiptune soundtrack.
    *   Upbeat, driving track for normal gameplay.
    *   A triumphant, energetic track for the Short Squeeze.
    *   Sound effects for jumping, collecting points, taking damage, and enemy actions.
*   **IP:** All assets will be original. Names like "GameStop" and "Citadel" will be used in a satirical, parody context (e.g., "GameStock Runner", "Citron Corp").

## Build, Run, Deploy

*   **Build:** `npm run build`
*   **Run:** `npm run dev` for local development. `npm run start` for production server.
*   **Deploy:** The `out` directory can be deployed to any static hosting provider (Vercel, Netlify, Firebase Hosting).
*   **Lighthouse PWA Checklist:**
    *   [X] Registers a service worker that handles `fetch`.
    *   [X] Web app manifest has the required properties.
    *   [X] Serves over HTTPS (when deployed).
    *   [X] Has a start URL that loads.
    *   [X] Works offline (basic assets are cached).
    *   [X] Provides icons for the home screen.

## Swarm Coordination Summary

*   **Decision 1 (Engine):** Majority voted for **PixiJS + Custom ECS**. Unanimous decision.
*   **Decision 2 (Terrain):** Majority voted for **Dynamic AABBs**. Unanimous decision.
*   **Decision 3 (AI):** Majority voted for **Component-based AI**. 3-1 vote.
*   **Memory Entry:**
    ```
    gme-game-dev-plan:
    - engine: pixijs_custom_ecs
    - terrain_generation: dynamic_aabb
    - ai_architecture: component_based_ecs
    - art_style: 16_bit_pixel_art
    - pwa_enabled: true
    ```
