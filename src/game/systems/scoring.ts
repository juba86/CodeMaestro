import { World, getEntitiesWithComponents, getComponent, Entity } from '../ecs';
import { C, HealthComponent, DamageComponent, PlayerComponent } from '../components';

export function scoringSystem(world: World) {
    const playerEntity = getEntitiesWithComponents(world, [C.Player, C.Health])[0];
    if (playerEntity === undefined) return;
    
    const health = getComponent<HealthComponent>(world, playerEntity, C.Health);
    if (!health) return;

    // Apply damage
    const damageEntities = getEntitiesWithComponents(world, [C.Damage, C.Transform]);
    const playerTransform = getComponent<any>(world, playerEntity, C.Transform);

    for (const de of damageEntities) {
        const damage = getComponent<DamageComponent>(world, de, C.Damage);
        const damageTransform = getComponent<any>(world, de, C.Transform);
        if(!damage || !damageTransform) continue;

        if (isAABBColliding(playerTransform, damageTransform)) {
            health.current -= damage.amount;
            console.log(`Player took ${damage.amount} damage. Health: ${health.current}`);
        }
    }


    if (health.current <= 0) {
        console.log('Player has been defeated. GAME OVER.');
        // Here you would trigger a game over state
    }

    // Win condition would be checked here
}

function isAABBColliding(a: any, b: any): boolean {
    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
}
