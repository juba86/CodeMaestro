import { World, createEntity, addComponent } from '../ecs';
import { C, TransformComponent, SolidComponent, DamageComponent } from '../components';
import { Candlestick } from '../chart-data';

const CANDLE_WIDTH = 50;
const Y_SCALE = 2;

export function terrainSystem(world: World, chartData: Candlestick[]) {
    chartData.forEach((candle, i) => {
        const isRed = candle.close < candle.open;
        
        const entity = createEntity(world);
        
        const height = (candle.high - candle.low) * Y_SCALE;
        const y_pos = 600 - candle.low * Y_SCALE - height;

        addComponent<TransformComponent>(world, entity, C.Transform, {
            x: i * (CANDLE_WIDTH + 10),
            y: y_pos,
            width: CANDLE_WIDTH,
            height: height,
        });

        if (!isRed) {
            addComponent<SolidComponent>(world, entity, C.Solid, {});
        } else {
            addComponent<DamageComponent>(world, entity, C.Damage, { amount: 10, from: -1 });
            // Red candles are hazards, but can still be solid
            addComponent<SolidComponent>(world, entity, C.Solid, {});
        }
    });
}
