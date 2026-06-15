# ToT Reasoning Log

Here we apply the Tree of Thoughts (ToT) method to make critical design decisions.

## a. Engine & Rendering Foundation

**Decision:** Choose the core rendering and game engine technology.

*   **Branches:**
    *   **Branch A:** Phaser 3 (Full-featured Canvas/WebGL game framework).
    *   **Branch B:** PixiJS (WebGL renderer) + a minimal custom Entity-Component-System (ECS) and physics engine.
    *   **Branch C:** Hand-rolled Canvas2D engine from scratch.
    *   **Branch D:** Unity or Godot engine, exported to WebAssembly (WASM).

*   **Evaluation:**

| Branch                       | Mobile Perf (1-5) | Bundle Size/ Install Speed (1-5) | PWA/Offline Fit (1-5) | Dev Velocity (1-5) | Chart-Terrain Fit (1-5) | Maintainability (1-5) | **Total** |
| ---------------------------- | ----------------- | -------------------------------- | --------------------- | ------------------ | ----------------------- | --------------------- | --------- |
| **A: Phaser 3**              | 4                 | 2                                | 4                     | 5                  | 4                       | 4                     | 23        |
| **B: PixiJS + Custom ECS**   | **5**             | **4**                            | **5**                 | **3**              | **5**                   | **4**                 | **26**    |
| **C: Raw Canvas2D**          | 3                 | 5                                | 5                     | 2                  | 4                       | 3                     | 22        |
| **D: Unity/Godot (WASM)**    | 4                 | 1                                | 2                     | 3                  | 3                       | 2                     | 15        |

*   **Pruning & Backtracking:**
    *   **Pruned D (Unity/Godot WASM):** The multi-megabyte WASM and data payload is antithetical to a fast PWA installation and offline caching strategy. Service worker `precache` of such large assets would lead to poor first-load experience and could exceed cache storage limits on mobile. **Failure: Violates "fast install/offline" constraint.**
    *   **Pruned C (Raw Canvas2D):** While offering the smallest bundle, a raw 2D canvas implementation will become fill-rate bound on mid-range mobile when rendering a parallax background, dozens of candlestick sprites, and particle effects for the "Short Squeeze". The development velocity is also too low for the scope. **Failure: Hits a predictable performance ceiling.**
    *   **Analysis (A vs. B):** Phaser offers high development velocity but at the cost of a larger bundle and less control over the render loop. PixiJS provides direct access to high-performance WebGL sprite batching, which is ideal for our many-sprite scene, and results in a more lightweight, tree-shakeable package. The lower dev velocity is an acceptable trade-off for the performance and bundle-size gains.

*   **Selection (Majority Vote): PixiJS + Custom ECS (Branch B)**
    *   **Justification:** This path provides the best performance headroom on mobile via WebGL batching, a small bundle for fast PWA installation, and maximum control for implementing the chart-as-terrain logic. It's the most professional choice for a performance-critical web game.
    *   **Swarm Vote:** Agent (Architect), Coder, Reviewer, Tester vote **YES**. Unanimous.

## b. Chart-OHLC-to-Terrain Generation

**Decision:** How to convert candlestick data into physical terrain for the player.

*   **Branches:**
    *   **Branch A:** **Polygon Collision Shape:** Generate a single, complex polygon collider for the top surface of the candles.
    *   **Branch B:** **Tilemap/Grid-based:** Voxelize the chart data into a fixed grid, where solid tiles represent the candle bodies.
    *   **Branch C:** **Dynamic AABBs:** Represent each candle as a simple Axis-Aligned Bounding Box (AABB) collider, dynamically streamed in and out of the physics simulation.

*   **Evaluation:**

| Branch                | Physics Perf (1-5) | Memory Usage (1-5) | Dynamic Scrolling (1-5) | Player Feel (1-5) | Impl. Complexity (1-5) | **Total** |
| --------------------- | ------------------ | ------------------ | ----------------------- | ----------------- | ---------------------- | --------- |
| **A: Polygon Shape**  | 3                  | 4                  | 2                       | 5                 | 4                      | 18        |
| **B: Tilemap**        | 5                  | 3                  | 4                       | 3                 | 2                      | 17        |
| **C: Dynamic AABBs**  | **4**              | **5**              | **5**                   | **4**             | **3**                  | **21**    |

*   **Pruning & Backtracking:**
    *   **Pruned A (Polygon Shape):** Complex polygon-vs-AABB collision is computationally expensive and a known performance trap in web-based physics engines. Regenerating this polygon for a scrolling level is a non-starter for 60 FPS on mobile. **Failure: Performance and dynamic update complexity.**
    *   **Pruned B (Tilemap):** While fast, tilemaps poorly represent the irregular, "spiky" silhouette of a candlestick chart. The player would run on a blocky approximation, losing the core fantasy. **Failure: Does not meet "faithfulness to chart" criteria.**

*   **Selection (Majority Vote): Dynamic AABBs (Branch C)**
    *   **Justification:** This approach is the best compromise. AABB collision checks are extremely fast. It's highly memory efficient as we only need to store and process colliders for candles currently on-screen. It perfectly maps to the visual representation (one candle = one box). The small gaps between candles can be handled as a deliberate gameplay mechanic, requiring precision from the player.
    *   **Swarm Vote:** Agent (Architect), Coder, Reviewer, Tester vote **YES**. Unanimous.

## c. Enemy/AI Architecture

**Decision:** Define the architecture for enemy behaviors.

*   **Branches:**
    *   **Branch A:** **Class-based State Machines:** Each enemy is a class with a hard-coded Finite State Machine (e.g., `switch(this.state)`).
    *   **Branch B:** **Behavior Trees (BT):** Implement or import a BT library to define AI logic in a tree structure.
    *   **Branch C:** **Component-based AI (ECS):** AI logic is defined in components (e.g., `ChasePlayerComponent`, `FallingHazardComponent`) that are processed by AI systems.

*   **Evaluation:**

| Branch                 | Extensibility (1-5) | Performance (1-5) | Debuggability (1-5) | Impl. Complexity (1-5) | Expressiveness (1-5) | **Total** |
| ---------------------- | ------------------- | ----------------- | ------------------- | ---------------------- | -------------------- | --------- |
| **A: FSMs in Classes** | 2                   | 5                 | 3                   | 2                      | 3                    | 15        |
| **B: Behavior Trees**  | 5                   | 3                 | 3                   | 4                      | 5                    | 20        |
| **C: Component AI (ECS)** | **4**               | **4**             | **4**               | **3**                  | **4**                | **19**    |

*   **Pruning & Backtracking:**
    *   **Pruned B (Behavior Trees):** While powerful, a full BT implementation is overkill for the two simple enemy types required. The complexity and potential for a heavy dependency are not justified. **Failure: Over-engineered for the current scope.**
    *   **Analysis (A vs. C):** While simple FSMs are fast to implement initially, they lead to rigid, monolithic classes that are hard to extend. The Component-based approach is the clear winner as it integrates perfectly with our chosen ECS architecture (Decision 1). Behaviors are composable and decoupled, making it easy to define new enemies or modify existing ones without touching core entity code.

*   **Selection (Majority Vote): Component-based AI (Branch C)**
    *   **Justification:** This model is the most scalable and maintainable. Red Candlesticks are simply entities with a `FallingHazardComponent` and a `DamageComponent`. Citadel agents are entities with `ChasePlayerComponent`, `ShootProjectileComponent`, and `HealthComponent`. This is clean, data-oriented, and performant.
    *   **Swarm Vote:** Agent (Architect), Coder, Reviewer vote **YES**. Tester abstains (implementation detail). Majority carries.
