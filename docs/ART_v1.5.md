# COLONY v1.5: графические ресурсы

Для версии v1.5 сгенерированы два растровых изображения: атлас зданий и иллюстрация прибытия в колонию. Исходники PNG сохранены в репозитории; приложение загружает их оптимизированные WebP-копии с сохранением прозрачности там, где она есть. Конвертация формата не меняет состав и расположение рисунков.

| Изображение | PNG-исходник | WebP в приложении | Где используется |
| --- | --- | --- | --- |
| Атлас зданий | `public/art/buildings-atlas.png` | `public/art/buildings-atlas.webp` | Карта города, каталог и сведения о здании |
| Прибытие в колонию | `public/art/colony-arrival.png` | `public/art/colony-arrival.webp` | Приветственный экран |

Иллюстрация прибытия имеет размер 1672 × 941 пиксель. Она не содержит функциональных надписей: заголовок, описание игры и кнопки выводятся обычным HTML поверх интерфейса, а не встраиваются в изображение.

## Атлас

Атлас организован как сетка 4 × 4. Порядок слева направо, сверху вниз фиксирован:

| Строка | Столбец 1 | Столбец 2 | Столбец 3 | Столбец 4 |
| --- | --- | --- | --- | --- |
| 1 | `hq` | `mine` | `solar` | `warehouse` |
| 2 | `foundry` | `habitat` | `trade_hub` | `research_lab` |
| 3 | `logistics` | `expedition_center` | `alliance_hub` | `observatory` |
| 4 | `deep_mine` | `solar_array` | `park` | `statue` |

`components/BuildingArt.tsx` выбирает ячейку с помощью `background-size: 400% 400%` и позиций 0%, 33⅓%, 66⅔%, 100% по каждой оси. При замене атласа нужно сохранить его сетку и порядок ячеек либо одновременно изменить соответствие в компоненте. Здания используют изображения атласа; неизвестный тип получает нейтральную иконку здания.

## Иконки и движение

`components/GameIcon.tsx` содержит отдельный согласованный набор SVG-иконок для ресурсов, навигации и действий. Это элементы интерфейса, созданные в коде, а не замена рисунков зданий. `GameAmount` сохраняет текстовое название ресурса для скринридера и подсказку `title` рядом с суммой.

Огни, строительные леса и выбор клетки оформлены в `app/city-art.css`. Они накладываются поверх изображения и не требуют отдельных кадров атласа. Анимации отключаются при `prefers-reduced-motion: reduce`.

## Происхождение

Оба PNG созданы инструментом генерации изображений для COLONY v1.5. WebP — производные файлы этих PNG для загрузки в приложении. Ниже дословно сохранены исходные промпты. Атлас запрошен с прозрачным фоном, иллюстрация — с непрозрачным.

### Атлас зданий

```text
Create ONE production-ready transparent PNG sprite atlas for the Telegram sci-fi city-building game COLONY. This is a single game asset sheet, not a screenshot or mockup. EXACTLY 4 columns x 4 rows, 16 equally sized square cells, perfectly aligned. Each cell contains ONE isolated isometric building on a small dark graphite square foundation, viewed from identical 30-degree game camera, centered in its cell, with ample clear transparent padding; no object crosses a cell boundary. Consistent attractive handcrafted 3D game illustration style, readable silhouettes even at 48px, white ceramic and graphite metal, teal illuminated windows, warm amber machinery highlights. Soft contained shadows, polished moderate detail, friendly optimistic planetary settlement. TRANSPARENT background, no ground landscape, no text, no letters, no numbers, no emoji, no borders or panel frames. Row-major ordering is essential. ROW 1 left to right: (1) colony command center with a pale round central dome and antenna, (2) small ore mine with a mechanical drill and amber mineral bins, (3) solar power plant with two cobalt blue panel wings, (4) storage warehouse with stacked cargo containers. ROW 2: (5) compact foundry furnace with glowing amber core and two short chimneys, (6) residential habitat of white modules with small green rooftop gardens, (7) trading depot cargo landing pad and crane, (8) research laboratory with a glass teal dome. ROW 3: (9) logistics terminal with conveyor and loading canopy, (10) expedition rocket launch station with small upright rocket, (11) alliance headquarters with linked twin towers and luminous teal beacon, (12) observatory with a large tilted telescope dish. ROW 4: (13) advanced deep mine with a large industrial vertical drilling rig, (14) advanced solar array with four large blue solar trackers, (15) bio-garden park with several miniature trees in square planters, (16) angular graphite monument with teal crystal tip. Give all sixteen equal visual scale, no missing or extra cells. High-resolution atlas with clean alpha edges.
```

### Прибытие в колонию

```text
Create a polished landscape wide illustration for the welcome screen of COLONY, a friendly sci-fi economic city-building Telegram game. One cohesive scene, no UI, no typography, no logos, no emoji. A small hopeful human colony on a remote blue-gray planet at dawn: foreground landing ramp and paths leading toward a ceramic-white command dome, small amber-lit foundry, cobalt solar panels, cargo warehouse and a glass teal research dome. In the distance a dramatic but peaceful rocky horizon and a large pale moon. Readable architectural silhouettes, appealing handcrafted 3D isometric-adjacent game art, graphite structural frames, white ceramic shells, teal lights, warm amber accents, soft atmospheric light. The place feels like a new home the player can grow, purposeful and welcoming. Wide composition, buildings concentrated across middle and lower portions, detailed but uncluttered, high quality, rich restrained dark navy palette matching a mobile dark UI. This is finished artwork for a real game, not a concept sheet or website screenshot.
```
