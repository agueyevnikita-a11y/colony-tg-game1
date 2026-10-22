import type { DecorType } from './decor';

export const DECOR_ATLAS = { src: '/art/lunar-decor-atlas.webp', width: 1263, height: 1246 } as const;

// Hand-measured viewports include full bases, antennas and contained glows.
// Generated sheets have uneven spacing, so equal thirds would clip objects.
const SPRITES: Record<DecorType, readonly [number, number, number, number]> = {
  road: [8, 98, 438, 312], tree: [450, 43, 400, 368], lamp: [903, 4, 355, 407],
  park: [0, 431, 442, 391], statue: [460, 420, 379, 409], bench: [849, 470, 414, 343],
  flowerbed: [0, 858, 440, 337], fountain: [440, 855, 415, 347], plaza: [860, 818, 403, 385],
};

export function decorSpriteByType(type: unknown) {
  return typeof type === 'string' && Object.hasOwn(SPRITES, type) ? SPRITES[type as DecorType] : null;
}
