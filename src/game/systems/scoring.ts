import { World, getEntitiesWithComponents, getComponent } from '../ecs';
import { C, HealthComponent, DamageComponent, TransformComponent } from '../components';

export function scoringSystem(world: World) {
    const playerEntity = getEntitiesWithComponents(world, [C.Player, C.Health])[0];
    if (playerEntity === undefined) return;
    
    const health = getComponent<HealthComponent>(world, playerEntity, C.Health);
    if (!health) return;

    // Apply damage
    const damageEntities = getEntitiesWithComponents(world, [C.Damage, C.Transform]);
    const playerTransform = getComponent<TransformComponent>(world, playerEntity, C.Transform);
    if (!playerTransform) return;

    for (const de of damageEntities) {
        const damage = getComponent<DamageComponent>(world, de, C.Damage);
        const damageTransform = getComponent<TransformComponent>(world, de, C.Transform);
        if(!damage || !damageTransform) continue;

        if (isAABBColliding(playerTransform, damageTransform)) {
            health.current -= damage.amount;
        }
    }


    if (health.current <= 0) {
        // Here you would trigger a game over state
    }

    // Win condition would be checked here
}

function isAABBColliding(a: TransformComponent, b: TransformComponent): boolean {
    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
}
