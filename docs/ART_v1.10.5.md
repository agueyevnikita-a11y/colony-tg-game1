# COLONY v1.10.5 — лунный декор

Атлас создан встроенным инструментом imagegen. Существующий `public/art/buildings-atlas.png` использован как визуальный референс при преобразовании набора в отдельный атлас декора; исходные здания не перезаписаны.

| Ресурс | Файл | Размер |
| --- | --- | --- |
| Исходный атлас с прозрачностью | `public/art/lunar-decor-atlas.png` | 1263 × 1246 |
| Копия для приложения с сохранением alpha | `public/art/lunar-decor-atlas.webp` | 1263 × 1246, 523 574 байта |
| Жилой модуль с герметичными крышами | `public/art/lunar-habitat.png` | 1299 × 1211 |
| Жилой модуль в приложении | `public/art/lunar-habitat.webp` | 1299 × 1211, 283 724 байта |

Порядок: настил, биокапсула, маяк; купольный сад, монумент, модуль отдыха; гидропоника, рециркулятор, коммуникационный узел. У каждого объекта металлическое основание, белые панели, бирюзовая подсветка и янтарные сигнальные огни. Растения находятся внутри герметичных корпусов.

`lib/game/decor-art.ts` задаёт индивидуальные области для всех девяти объектов: деление картинки на равные трети обрезало бы корпуса и антенны. Компонент `DecorArt` сохраняет пропорции и отступ от края. Карта, каталог, панель действий и публичный город используют один компонент. Для настилов на карте он рисует соединяемые металлические сегменты по соседним клеткам; статический предпросмотр использует атлас. Иконки интерфейса остаются SVG и показывают те же герметичные модули.

Преобразование PNG в WebP выполняется без изменения композиции. Границы проверяются тестами по размеру исходного PNG и непересечению областей; видимость всех объектов дополнительно проверяется в браузере на мобильных размерах.

У жилого модуля тоже заменены открытые растения на крышах: теперь они растут под герметичным стеклом. `BuildingArt` использует отдельное изображение с областью из `lib/game/habitat-art.ts`; другие здания продолжают загружаться из прежнего атласа. Тип, уровни, позиции и доход жилых модулей не меняются.

## Промпт

Встроенный режим, прозрачный фон; референс — атлас зданий COLONY.

```text
Edit/transform the supplied COLONY building sprite sheet into ONE new matching LUNAR DECOR sprite atlas. Keep the exact same high-detail miniature 3D isometric game rendering language, camera angle, white ceramic armor, dark gunmetal bases, tiny amber safety accents and cyan/teal light as the reference. Replace all reference buildings with the following NINE small space-colony infrastructure objects in a STRICT 3x3 equal-cell square grid. Each sprite centered inside its own equal square cell, generous transparent padding, no overlap, all complete including antennas and base, same scale and lighting upper-left. Transparent background including between sprites, no ground scene, no text/numbers/logos. Readable silhouettes at 48px, not flat vector or cartoon. Every object sits on a small diamond-isometric dark metal base matching existing buildings. Row1 left: modular service walkway platform, low metal deck diamond with amber edge strips and bolted panels, NO asphalt/traffic marks. Row1 middle: compact sealed transparent spherical BIOCAPSULE with small green leafy plants visibly enclosed inside pressure glass, white rim, cyan monitoring light. Row1 right: NAVIGATION BEACON, short white/gunmetal mast with turquoise illuminated head and tiny amber ground lights. Row2 left: DOME GARDEN, a larger sealed geodesic glass dome with several small green plants INSIDE, white structural ribs, NO outdoor trees or grass. Row2 middle: PIONEER MONUMENT, angular white/gunmetal sci-fi obelisk with a cyan crystal inset, no vegetation. Row2 right: sealed REST MODULE, compact rounded white pressure cabin with panoramic cyan glass window, internal amber lounge glow, no outdoor benches. Row3 left: HYDROPONIC MODULE, low enclosed glass growing rack with two parallel rows of tiny plants inside and white technical enclosure, no outdoor flowerbeds. Row3 middle: WATER RECIRCULATOR, two closed horizontal silver/white tanks and pipes with cyan circular status indicators, no open water or fountain jets. Row3 right: COMMUNICATION NODE, compact white command console with cyan holographic concentric signal rings over a technical pedestal and antenna, no plaza/pavers/vegetation. These are lightweight comfort installations on the airless Moon, not full large industrial buildings; maintain coherent detailed material style of supplied reference. All plants must be inside sealed glass. Absolutely no fir trees, park benches, exposed lawns, outdoor fountains, checkerboard pattern or opaque background.
```

### Жилой модуль

Встроенный imagegen, прозрачный фон; референсы — исходный атлас зданий и новый атлас декора.

```text
Create ONE isolated replacement residential HABITAT sprite for COLONY's airless lunar colony, transforming the residential building at ROW2 COLUMN2 of reference1. Reference2 establishes the newly approved lunar material style. Output only a SINGLE complete habitat building, not an atlas or scene. Preserve reference1 habitat's characteristic stepped stack of three white rectangular ceramic living modules, teal panoramic windows, graphite structural frames, amber safety lights, diamond-isometric dark metal foundation, same 30-degree camera from upper-left and high-detail miniature 3D game rendering. Crucial change: replace EVERY exposed rooftop plant or garden with SMALL SEALED TRANSPARENT PRESSURE CAPSULES / GLASS DOMES attached to the roofs, with green plants clearly INSIDE those closed glass enclosures. There must be no foliage outside sealed glass, no open trees, shrubs, lawn or outdoor planters anywhere. White pressure hulls, cyan windows, subtle amber equipment, a visible small airlock entrance. This is housing for lunar colonists and should look distinct from a garden-only dome or industrial factory. Keep the complete square foundation, roof equipment, glass capsules and all antenna tips with at least 8% empty transparent margin on every side, no clipping. Centered solitary sprite, generous empty alpha background, consistent lighting and material with both references, restrained readable detail at 48px. No scene/ground terrain, text, digits, logos, characters, black/white opaque backdrop, checkerboard or UI.
```
