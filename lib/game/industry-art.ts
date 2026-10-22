/** Distinct industrial silhouettes; stable game keys and production stay unchanged. */
export const INDUSTRY_ATLAS = {
  src: '/art/industry-buildings-v111.webp', width: 1254, height: 1254,
};

const SPRITES = {
  solar: [76, 183, 527, 454],
  warehouse: [653, 159, 548, 479],
  trade_hub: [35, 790, 610, 394],
  logistics: [649, 709, 580, 482],
} as const;

export function industrySpriteByType(type: unknown): readonly [number, number, number, number] | null {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(SPRITES, type)
    ? SPRITES[type as keyof typeof SPRITES] : null;
}
