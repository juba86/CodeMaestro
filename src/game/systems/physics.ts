import { World, getEntitiesWithComponents, getComponent } from '../ecs';
import { C, PhysicsComponent, TransformComponent, PlayerComponent } from '../components';

const GRAVITY = 0.5;

// Velocities are per fixed tick (the page steps this at 60 Hz).
export function physicsSystem(world: World) {
    const movingEntities = getEntitiesWithComponents(world, [C.Physics, C.Transform]);
    const solidEntities = getEntitiesWithComponents(world, [C.Solid, C.Transform]);

    for (const entity of movingEntities) {
        const physics = getComponent<PhysicsComponent>(world, entity, C.Physics);
        const transform = getComponent<TransformComponent>(world, entity, C.Transform);

        if (!physics || !transform) continue;

        // Gravity
        if (physics.gravity) {
            physics.vy += GRAVITY;
        }

        // Move
        transform.x += physics.vx;
        transform.y += physics.vy;

        // Collision with solid entities
        const playerComp = getComponent<PlayerComponent>(world, entity, C.Player);
        if (playerComp) { // Simple collision for player for now
            playerComp.isGrounded = false;
            for (const solid of solidEntities) {
                const solidTransform = getComponent<TransformComponent>(world, solid, C.Transform);
                if (!solidTransform) continue;

                if (isAABBColliding(transform, solidTransform)) {
                    // Collision response
                    const overlapX = Math.min(transform.x + transform.width, solidTransform.x + solidTransform.width) - Math.max(transform.x, solidTransform.x);
                    const overlapY = Math.min(transform.y + transform.height, solidTransform.y + solidTransform.height) - Math.max(transform.y, solidTransform.y);
                    
                    if (overlapY < overlapX) {
                        if (transform.y < solidTransform.y) { // Coming from top
                            transform.y = solidTransform.y - transform.height;
                            physics.vy = 0;
                            playerComp.isGrounded = true;
                        } else { // Coming from bottom
                            transform.y = solidTransform.y + solidTransform.height;
                            physics.vy = 0;
                        }
                    } else {
                        if (transform.x < solidTransform.x) { // Coming from left
                           transform.x = solidTransform.x - transform.width;
                           physics.vx = 0;
                        } else { // Coming from right
                            transform.x = solidTransform.x + solidTransform.width;
                            physics.vx = 0;
                        }
                    }
                }
            }
        }
    }
}

function isAABBColliding(a: TransformComponent, b: TransformComponent): boolean {
    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
}
