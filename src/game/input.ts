import { World, Entity } from './ecs';
import { getComponent, addComponent, registerComponent } from './ecs';
import { C, InputComponent } from './components';

export function createInput(world: World, player: Entity) {
    registerComponent<InputComponent>(world, C.Input);
    addComponent<InputComponent>(world, player, C.Input, {
        left: false,
        right: false,
        jump: false,
    });

    window.addEventListener('keydown', e => handleKeyEvent(e, true, world, player));
    window.addEventListener('keyup', e => handleKeyEvent(e, false, world, player));
}

function handleKeyEvent(e: KeyboardEvent, isDown: boolean, world: World, player: Entity) {
    const input = getComponent<InputComponent>(world, player, C.Input);
    if (!input) return;

    switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
            input.left = isDown;
            break;
        case 'ArrowRight':
        case 'KeyD':
            input.right = isDown;
            break;
        case 'Space':
        case 'ArrowUp':
        case 'KeyW':
            input.jump = isDown;
            break;
    }
}
