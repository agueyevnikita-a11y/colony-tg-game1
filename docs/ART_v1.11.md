# COLONY v1.11 — отличимые промышленные здания

Атлас создан встроенным imagegen в режиме преобразования с прозрачным фоном. Референсы первого прохода — существующие `public/art/buildings-atlas.png` и `public/art/lunar-decor-atlas.png`. Второй проход использует результат первого и меняет расположение четырёх объектов, чтобы прямоугольные области не захватывали соседние здания.

| Ресурс | Файл | Размер |
| --- | --- | --- |
| Исходный финальный PNG | `public/art/industry-buildings-v111.png` | 1254 × 1254 |
| WebP для приложения | `public/art/industry-buildings-v111.webp` | 1254 × 1254, alpha сохранён |

Верхний ряд: реактор без солнечных панелей, закрытый склад контейнеров. Нижний ряд: торговый порт с шаттлом, гараж логистических роверов. Белая керамика, графит, бирюзовый свет и янтарные сигналы соответствуют лунным объектам предыдущего релиза.

Индивидуальные области в `lib/game/industry-art.ts` включают корпуса, основания и антенны, не пересекаются и имеют прозрачный отступ. Максимальная alpha на границах областей исходного PNG — 0, 0, 1, 1 из 255. Компонент сохраняет пропорции и использует один источник для карты, каталога, магазина и публичного города. WebP получен из финального PNG без перерисовки или изменения композиции.

Исходные результаты imagegen сохранены без изменений:
- первый проход: `C:/Users/Ageev/.codex/generated_images/01a0e23d-8a07-7741-a35e-af7e21a36e98/exec-0d3d3e05-52b0-4ae9-bfd4-f43f318302f6.png`;
- финальный проход: `C:/Users/Ageev/.codex/generated_images/01a0e23d-8a07-7741-a35e-af7e21a36e98/exec-a7f16c36-e5d4-4b4c-9478-ab4c4a9e4f83.png`.

## Промпт первого прохода

```text
Transform these COLONY reference game sprites into ONE new 2x2 building atlas that preserves their detailed miniature 3D isometric style, identical 30-degree camera, white ceramic pressure hulls, graphite metal foundations, cyan windows and restrained warm amber technical lights. Transparent alpha background, no ground scene/text/digits/logos/UI, four isolated complete sprites with at least 6% transparent padding around EACH object and space between objects. These four buildings MUST have instantly different silhouettes even at 48px. TOP LEFT: compact fission ELECTRIC POWER STATION, a single squat hexagonal reactor vessel with a cyan luminous core ring, six prominent vertical dark graphite radiator fins around it and small amber safety lamps; NO solar panels, no chimney smoke, no huge cooling towers. Clearly a sealed autonomous reactor for an airless Moon. TOP RIGHT: STORAGE WAREHOUSE, a chunky tall rectangular shielded vault frame holding three rows of stacked sealed cargo containers, white overhead pressure shelter and small amber loading door, strong square/block silhouette, no spacecraft or cranes. BOTTOM LEFT: TRADE HUB, a broad low octagonal landing pad with a small white cargo shuttle visibly landed, two compact exchange gantries and a short cyan trade beacon; open landingpad outline and shuttle make it clearly a trade port rather than warehouse. BOTTOM RIGHT: LOGISTICS CENTER, compact white dispatch tower behind three small six-wheeled lunar cargo rovers in separate service bays, one slim robotic handling arm, a short antenna; clearly a rover/drone dispatch garage, no aircraft or rocket, no solar panels. All on individual diamond-shaped dark metal bases, same visual weight/scale and upper-left lighting as supplied references, no exposed vegetation or water, no clipping of bases/antenna. Finished production sprites for a real game, not a sketch or vector mockup.
```

## Промпт финального прохода

```text
Rearrange this exact FOUR-sprite COLONY atlas to fix overlap between rectangular sprite viewports. Preserve the same four building designs, white/graphite/cyan/amber materials, isometric camera and fine illustration detail. Change ONLY arrangement, scale and empty spacing, not their identities. Output a SQUARE transparent sprite sheet, 2 columns by 2 rows: reactor upper-left, storage warehouse upper-right, shuttle trade port lower-left, rover logistics garage lower-right. Each object must fit COMPLETELY inside the CENTRAL 65% of its own equally sized square cell, with at least 15% clear alpha padding on EVERY side of EVERY sprite. The top-right warehouse must end well ABOVE the midpoint of the sheet; the bottom-right garage antenna must start well BELOW the midpoint, leaving a wide entirely transparent horizontal gutter. No antenna, glow, shadow or base may cross a cell boundary. Reduce building scale as much as needed to guarantee this clear space. Center all four complete bases inside their own cells. Background and all gutters must be genuinely 100% transparent alpha, no gray haze, backdrop, floor, gradient or contact shadows beyond small contained bases. No text/numbers/UI. These same four complete sprites, generously separated for deterministic rectangular cropping.
```

