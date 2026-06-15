// A very simple, data-oriented Entity-Component-System

export type Entity = number;

export interface World {
  entities: Set<Entity>;
  nextEntityId: number;
  components: Map<string, Map<Entity, any>>;
}

export function createWorld(): World {
  return {
    entities: new Set(),
    nextEntityId: 0,
    components: new Map(),
  };
}

export function createEntity(world: World): Entity {
  const entity = world.nextEntityId++;
  world.entities.add(entity);
  return entity;
}

export function destroyEntity(world: World, entity: Entity) {
  world.entities.delete(entity);
  for (const componentMap of world.components.values()) {
    componentMap.delete(entity);
  }
}

export function registerComponent<T>(world: World, name: string) {
    if (!world.components.has(name)) {
        world.components.set(name, new Map<Entity, T>());
    }
}

export function addComponent<T>(world: World, entity: Entity, componentName: string, data: T) {
  const componentMap = world.components.get(componentName);
  if (componentMap) {
    componentMap.set(entity, data);
  }
}

export function getComponent<T>(world: World, entity: Entity, componentName: string): T | undefined {
    const componentMap = world.components.get(componentName);
    return componentMap ? componentMap.get(entity) : undefined;
}

export function removeComponent(world: World, entity: Entity, componentName: string) {
    const componentMap = world.components.get(componentName);
    if (componentMap) {
        componentMap.delete(entity);
    }
}

export function getEntitiesWithComponents(world: World, componentNames: string[]): Entity[] {
    const entities: Entity[] = [];
    for (const entity of world.entities) {
        let hasAllComponents = true;
        for (const name of componentNames) {
            const componentMap = world.components.get(name);
            if (!componentMap || !componentMap.has(entity)) {
                hasAllComponents = false;
                break;
            }
        }
        if (hasAllComponents) {
            entities.push(entity);
        }
    }
    return entities;
}
