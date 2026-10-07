// Component data structures

import type { Sprite } from 'pixi.js';

export const C = {
    Transform: 'transform',
    Physics: 'physics',
    Sprite: 'sprite',
    Player: 'player',
    Damage: 'damage',
    Health: 'health',
    ChasePlayer: 'chasePlayer',
    Score: 'score',
    Input: 'input',
    FallingHazard: 'fallingHazard',
    Solid: 'solid'
};

export interface TransformComponent {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhysicsComponent {
  vx: number;
  vy: number;
  gravity: boolean;
}

export interface SpriteComponent {
  texture: string;
  /** Created lazily by the render system when null. */
  pixiSprite: Sprite | null;
}

export interface PlayerComponent {
  isGrounded: boolean;
  jumpForce: number;
  speed: number;
}

export interface DamageComponent {
  amount: number;
  from: number; // entity id
}

export interface HealthComponent {
  current: number;
  max: number;
}

export interface ChasePlayerComponent {
  speed: number;
}

export interface ScoreComponent {
  value: number;
}

export interface InputComponent {
    left: boolean;
    right: boolean;
    jump: boolean;
}

export interface FallingHazardComponent {
    fallSpeed: number;
}

// A tag for solid objects for collision (carries no data).
export type SolidComponent = Record<string, never>;
