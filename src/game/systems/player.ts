import { World, Entity, getComponent } from '../ecs';
import { C, PlayerComponent, PhysicsComponent, InputComponent } from '../components';

export function playerSystem(world: World, playerEntity: Entity) {
    const player = getComponent<PlayerComponent>(world, playerEntity, C.Player);
    const physics = getComponent<PhysicsComponent>(world, playerEntity, C.Physics);
    const input = getComponent<InputComponent>(world, playerEntity, C.Input);

    if (!player || !physics || !input) {
        return;
    }

    // Horizontal movement
    if (input.left) {
        physics.vx = -player.speed;
    } else if (input.right) {
        physics.vx = player.speed;
    } else {
        physics.vx = 0;
    }

    // Jumping
    if (input.jump && player.isGrounded) {
        physics.vy = -player.jumpForce;
        player.isGrounded = false;
    }
}
