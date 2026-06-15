'use client';

import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { createWorld, createEntity, addComponent, registerComponent, World, Entity } from '@/game/ecs';
import { C, TransformComponent, PhysicsComponent, PlayerComponent, SpriteComponent, SolidComponent, HealthComponent, DamageComponent, FallingHazardComponent, ChasePlayerComponent } from '@/game/components';
import { createInput } from '@/game/input';
import { playerSystem } from '@/game/systems/player';
import { physicsSystem } from '@/game/systems/physics';
import { renderSystem, initRenderSystem } from '@/game/systems/render';
import { terrainSystem } from '@/game/systems/terrain';
import { aiSystem } from '@/game/systems/ai';
import { scoringSystem } from '@/game/systems/scoring';
import { loadChartData } from '@/game/chart-data';

const GamePage = () => {
    const gameContainer = useRef<HTMLDivElement>(null);
    const pixiApp = useRef<PIXI.Application | null>(null);
    const world = useRef<World | null>(null);

    useEffect(() => {
        if (pixiApp.current || !gameContainer.current) return;

        pixiApp.current = new PIXI.Application();
        const app = pixiApp.current;

        async function init() {
            await app.init({
                width: 800,
                height: 600,
                backgroundColor: 0x1099bb,
            });
            gameContainer.current?.appendChild(app.view as unknown as Node);

            // ECS World
            world.current = createWorld();
            const w = world.current;

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
            addComponent<SpriteComponent>(w, player, C.Sprite, { texture: 'player', pixiSprite: new PIXI.Sprite(PIXI.Texture.WHITE) });
            addComponent<HealthComponent>(w, player, C.Health, { current: 100, max: 100 });
            
            // Input
            createInput(w, player);
            
            // Game Loop
            const FIXED_TIMESTEP = 1000 / 60;
            let accumulator = 0;
            let lastTime = performance.now();

            const gameLoop = (currentTime: number) => {
                const deltaTime = currentTime - lastTime;
                lastTime = currentTime;
                accumulator += deltaTime;

                while (accumulator >= FIXED_TIMESTEP) {
                    aiSystem(w, FIXED_TIMESTEP);
                    playerSystem(w, player);
                    physicsSystem(w, FIXED_TIMESTEP);
                    scoringSystem(w);
                    accumulator -= FIXED_TIMESTEP;
                }

                const alpha = accumulator / FIXED_TIMESTEP;
                renderSystem(w, alpha);

                requestAnimationFrame(gameLoop);
            };

            requestAnimationFrame(gameLoop);
        }

        init();

        return () => {
            app.destroy(true, true);
            pixiApp.current = null;
        };
    }, []);

    return <div ref={gameContainer} />;
};

export default GamePage;
