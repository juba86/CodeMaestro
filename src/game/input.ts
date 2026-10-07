import { World, Entity } from './ecs';
import { getComponent, addComponent, registerComponent } from './ecs';
import { C, InputComponent } from './components';

/** Registers keyboard input for `player`; returns a function that removes the listeners. */
export function createInput(world: World, player: Entity): () => void {
    registerComponent<InputComponent>(world, C.Input);
    addComponent<InputComponent>(world, player, C.Input, {
        left: false,
        right: false,
        jump: false,
    });

    const onKeyDown = (e: KeyboardEvent) => handleKeyEvent(e, true, world, player);
    const onKeyUp = (e: KeyboardEvent) => handleKeyEvent(e, false, world, player);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
    };
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
