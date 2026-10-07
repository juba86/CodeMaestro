'use client';

import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { createWorld, createEntity, addComponent, registerComponent } from '@/game/ecs';
import { C, TransformComponent, PhysicsComponent, PlayerComponent, SpriteComponent, SolidComponent, HealthComponent, DamageComponent, FallingHazardComponent, ChasePlayerComponent } from '@/game/components';
import { createInput } from '@/game/input';
import { playerSystem } from '@/game/systems/player';
import { physicsSystem } from '@/game/systems/physics';
import { renderSystem, initRenderSystem, resetRenderSystem } from '@/game/systems/render';
import { terrainSystem } from '@/game/systems/terrain';
import { aiSystem } from '@/game/systems/ai';
import { scoringSystem } from '@/game/systems/scoring';
import { loadChartData } from '@/game/chart-data';

const GamePage = () => {
    const gameContainer = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = gameContainer.current;
        if (!container) return;

        // Everything below is owned by THIS effect run. Under StrictMode the
        // effect mounts, unmounts and mounts again; each run must tear down
        // exactly what it created, even if init() has not resolved yet.
        let disposed = false;
        let rafId = 0;
        let removeInput: (() => void) | null = null;
        const app = new PIXI.Application();

        const ready = (async () => {
            await app.init({
                width: 800,
                height: 600,
                backgroundColor: 0x1099bb,
            });
            if (disposed) return;
            container.appendChild(app.canvas);

            // ECS World
            const w = createWorld();

            // Register components
            registerComponent<TransformComponent>(w, C.Transform);
            registerComponent<PhysicsComponent>(w, C.Physics);
            registerComponent<SpriteComponent>(w, C.Sprite);
            registerComponent<PlayerComponent>(w, C.Player);
            registerComponent<SolidComponent>(w, C.Solid);
            registerComponent<HealthComponent>(w, C.Health);
            registerComponent<DamageComponent>(w, C.Damage);
            registerComponent<FallingHazardComponent>(w, C.FallingHazard);
            registerComponent<ChasePlayerComponent>(w, C.ChasePlayer);

            // Render System
            initRenderSystem(w, app.stage);

            // Chart Data
            const chartData = loadChartData();
            terrainSystem(w, chartData);

            // Player
            const player = createEntity(w);
            addComponent<TransformComponent>(w, player, C.Transform, { x: 100, y: 100, width: 32, height: 32 });
            addComponent<PhysicsComponent>(w, player, C.Physics, { vx: 0, vy: 0, gravity: true });
            addComponent<PlayerComponent>(w, player, C.Player, { isGrounded: false, jumpForce: 10, speed: 5 });
            // pixiSprite is created (and added to the stage) by the render system.
            addComponent<SpriteComponent>(w, player, C.Sprite, { texture: 'player', pixiSprite: null });
            addComponent<HealthComponent>(w, player, C.Health, { current: 100, max: 100 });

            // Input
            removeInput = createInput(w, player);

            // Game Loop
            const FIXED_TIMESTEP = 1000 / 60;
            let accumulator = 0;
            let lastTime = performance.now();

            const gameLoop = (currentTime: number) => {
                if (disposed) return;
                const deltaTime = currentTime - lastTime;
                lastTime = currentTime;
                // Clamp so a long pause (background tab) doesn't trigger a
                // catch-up spiral of thousands of fixed steps.
                accumulator += Math.min(deltaTime, 250);

                while (accumulator >= FIXED_TIMESTEP) {
                    aiSystem(w);
                    playerSystem(w, player);
                    physicsSystem(w);
                    scoringSystem(w);
                    accumulator -= FIXED_TIMESTEP;
                }

                renderSystem(w);

                rafId = requestAnimationFrame(gameLoop);
            };

            rafId = requestAnimationFrame(gameLoop);
        })();

        return () => {
            disposed = true;
            cancelAnimationFrame(rafId);
            removeInput?.();
            resetRenderSystem();
            // Pixi v8 can't destroy an Application whose init() is still
            // pending, so wait for it; removeView detaches the canvas.
            ready
                .catch(() => {})
                .then(() => {
                    try {
                        app.destroy({ removeView: true }, { children: true });
                    } catch {
                        /* init failed — nothing to release */
                    }
                });
        };
    }, []);

    return <div ref={gameContainer} />;
};

export default GamePage;
