import { World, getEntitiesWithComponents, getComponent } from '../ecs';
import { C, SpriteComponent, TransformComponent, SolidComponent, DamageComponent } from '../components';
import * as PIXI from 'pixi.js';

let stage: PIXI.Container | null = null;

export function initRenderSystem(world: World, pixiStage: PIXI.Container) {
    stage = pixiStage;

    // Create sprites for all existing sprite entities
    const entities = getEntitiesWithComponents(world, [C.Sprite, C.Transform]);
    for (const entity of entities) {
        const spriteComp = getComponent<SpriteComponent>(world, entity, C.Sprite);
        if (spriteComp) {
            const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
            
            const transform = getComponent<TransformComponent>(world, entity, C.Transform);
            if (transform) {
                sprite.width = transform.width;
                sprite.height = transform.height;
            }

            const isSolid = getComponent<SolidComponent>(world, entity, C.Solid);
            const isDamage = getComponent<DamageComponent>(world, entity, C.Damage);
            if(isDamage) {
                sprite.tint = 0xff0000;
            } else if (isSolid) {
                sprite.tint = 0x00ff00;
            }

            spriteComp.pixiSprite = sprite;
            stage.addChild(sprite);
        }
    }
}

/** Drops the stage reference (call before destroying the Pixi app). */
export function resetRenderSystem() {
    stage = null;
}

export function renderSystem(world: World) {
    if (!stage) return;

    const entities = getEntitiesWithComponents(world, [C.Sprite, C.Transform]);

    for (const entity of entities) {
        const spriteComp = getComponent<SpriteComponent>(world, entity, C.Sprite);
        const transform = getComponent<TransformComponent>(world, entity, C.Transform);

        if (spriteComp && transform) {
            if (!spriteComp.pixiSprite) { // Create sprite if it doesn't exist
                 const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                 sprite.width = transform.width;
                 sprite.height = transform.height;

                 if(transform.width === 32 && transform.height === 32) { // player
                     sprite.tint = 0xffff00;
                 } else { // candles
                    const isDamage = getComponent<DamageComponent>(world, entity, C.Damage);
                    if(isDamage) {
                        sprite.tint = 0xff0000;
                    } else {
                        sprite.tint = 0x00ff00;
                    }
                 }
                spriteComp.pixiSprite = sprite;
                stage.addChild(sprite);
            }

            spriteComp.pixiSprite.x = transform.x;
            spriteComp.pixiSprite.y = transform.y;
        }
    }
}
