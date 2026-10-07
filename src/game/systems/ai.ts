import { World, getEntitiesWithComponents, getComponent } from '../ecs';
import { C, FallingHazardComponent, PhysicsComponent } from '../components';

export function aiSystem(world: World) {
    const fallingHazards = getEntitiesWithComponents(world, [C.FallingHazard, C.Physics, C.Transform]);

    for (const entity of fallingHazards) {
        const hazard = getComponent<FallingHazardComponent>(world, entity, C.FallingHazard);
        const physics = getComponent<PhysicsComponent>(world, entity, C.Physics);

        if (hazard && physics) {
            // For now, red candles are static, so this is a placeholder.
            // We could make them fall, for example:
            // physics.vy = hazard.fallSpeed;
        }
    }
}
