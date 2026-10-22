# COLONY v1.10.5 — лунный декор

Атлас создан встроенным инструментом imagegen. Существующий `public/art/buildings-atlas.png` использован как визуальный референс при преобразовании набора в отдельный атлас декора; исходные здания не перезаписаны.

| Ресурс | Файл | Размер |
| --- | --- | --- |
| Исходный атлас с прозрачностью | `public/art/lunar-decor-atlas.png` | 1263 × 1246 |
| Копия для приложения с сохранением alpha | `public/art/lunar-decor-atlas.webp` | 1263 × 1246, 523 574 байта |

Порядок: настил, биокапсула, маяк; купольный сад, монумент, модуль отдыха; гидропоника, рециркулятор, коммуникационный узел. У каждого объекта металлическое основание, белые панели, бирюзовая подсветка и янтарные сигнальные огни. Растения находятся внутри герметичных корпусов.

`lib/game/decor-art.ts` задаёт индивидуальные области для всех девяти объектов: деление картинки на равные трети обрезало бы корпуса и антенны. Компонент `DecorArt` сохраняет пропорции и отступ от края. Карта, каталог, панель действий и публичный город используют один компонент. Для настилов на карте он рисует соединяемые металлические сегменты по соседним клеткам; статический предпросмотр использует атлас. Иконки интерфейса остаются SVG и показывают те же герметичные модули.

Преобразование PNG в WebP выполняется без изменения композиции. Границы проверяются тестами по размеру исходного PNG и непересечению областей; видимость всех объектов дополнительно проверяется в браузере на мобильных размерах.

## Промпт

Встроенный режим, прозрачный фон; референс — атлас зданий COLONY.

```text
Edit/transform the supplied COLONY building sprite sheet into ONE new matching LUNAR DECOR sprite atlas. Keep the exact same high-detail miniature 3D isometric game rendering language, camera angle, white ceramic armor, dark gunmetal bases, tiny amber safety accents and cyan/teal light as the reference. Replace all reference buildings with the following NINE small space-colony infrastructure objects in a STRICT 3x3 equal-cell square grid. Each sprite centered inside its own equal square cell, generous transparent padding, no overlap, all complete including antennas and base, same scale and lighting upper-left. Transparent background including between sprites, no ground scene, no text/numbers/logos. Readable silhouettes at 48px, not flat vector or cartoon. Every object sits on a small diamond-isometric dark metal base matching existing buildings. Row1 left: modular service walkway platform, low metal deck diamond with amber edge strips and bolted panels, NO asphalt/traffic marks. Row1 middle: compact sealed transparent spherical BIOCAPSULE with small green leafy plants visibly enclosed inside pressure glass, white rim, cyan monitoring light. Row1 right: NAVIGATION BEACON, short white/gunmetal mast with turquoise illuminated head and tiny amber ground lights. Row2 left: DOME GARDEN, a larger sealed geodesic glass dome with several small green plants INSIDE, white structural ribs, NO outdoor trees or grass. Row2 middle: PIONEER MONUMENT, angular white/gunmetal sci-fi obelisk with a cyan crystal inset, no vegetation. Row2 right: sealed REST MODULE, compact rounded white pressure cabin with panoramic cyan glass window, internal amber lounge glow, no outdoor benches. Row3 left: HYDROPONIC MODULE, low enclosed glass growing rack with two parallel rows of tiny plants inside and white technical enclosure, no outdoor flowerbeds. Row3 middle: WATER RECIRCULATOR, two closed horizontal silver/white tanks and pipes with cyan circular status indicators, no open water or fountain jets. Row3 right: COMMUNICATION NODE, compact white command console with cyan holographic concentric signal rings over a technical pedestal and antenna, no plaza/pavers/vegetation. These are lightweight comfort installations on the airless Moon, not full large industrial buildings; maintain coherent detailed material style of supplied reference. All plants must be inside sealed glass. Absolutely no fir trees, park benches, exposed lawns, outdoor fountains, checkerboard pattern or opaque background.
```
