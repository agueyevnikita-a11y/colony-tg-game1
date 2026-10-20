# Графика COLONY v1.6

Новый монумент основателя создан встроенным инструментом imagegen. Исходник: `public/art/founder-monument.png`; приложение использует `public/art/founder-monument.webp`. Прозрачность сохранена, WebP получен только перекодированием. Предыдущий атлас использован как образец стиля, существующие рисунки не заменены.

Неоновая тема, сияние, небо основателя и рамки реализованы в CSS/SVG. Предпросмотр использует те же эффекты, что и город. Анимации отключаются при `prefers-reduced-motion: reduce`.

Исходный промпт (дословно):

```text
Use case: stylized-concept. Asset type: one transparent game sprite for COLONY, a friendly sci-fi economic city-building game. The provided image is a STYLE REFERENCE ONLY: match its handcrafted polished 3D isometric game buildings, white ceramic and graphite metal, teal light, amber accents, identical 30-degree camera. Generate ONE unique premium Founder Monument, not a sheet and not a collage. A striking elegant architectural obelisk formed from three ascending champagne-gold and white ceramic fins surrounding a floating luminous amber core, with a small circular orbital ring around the core, teal seams, dark graphite square foundation. The silhouette should feel like a prestigious original colony landmark, clearly different from the reference gray teal statue, readable at 70px. Center the complete monument including base in a square canvas, with 12 percent transparent padding on all sides. Contained soft shadow directly under the base. Genuine transparent background and clean alpha edges. No landscape, no ground plane beyond the small foundation, no text, no letters, no numbers, no UI, no emoji, no watermark, no extra buildings. Reference image is not an edit target; create one new isolated sprite only.
```
