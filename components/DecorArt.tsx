import type { ReactNode } from 'react';

export type RoadConnections = { north?: boolean; east?: boolean; south?: boolean; west?: boolean };
type Props = { type: string; className?: string; connections?: RoadConnections; decorative?: boolean; label?: string };

const LABELS: Record<string, string> = {
  road: 'Дорога', tree: 'Зелёный модуль', lamp: 'Световой модуль', park: 'Парк', statue: 'Монумент колонии',
  bench: 'Площадка отдыха', flowerbed: 'Цветник', fountain: 'Водный сад', plaza: 'Площадь колонии',
};

function Platform({ children, green = false }: { children: ReactNode; green?: boolean }) {
  return <><ellipse cx="80" cy="139" rx="65" ry="15" fill="#050e16" opacity=".45" />
    <path d="m12 111 68-35 68 35v9l-68 35-68-35Z" fill="#233944" stroke="#66818a" strokeWidth="1.5" />
    <path d="m12 111 68 35 68-35-68-35Z" fill={green ? '#456b59' : '#49606a'} />
    <path d="m80 146 68-35v9l-68 35Z" fill="#1a303a" /><path d="m22 115 58 30 58-30" fill="none" stroke="#9fb6b1" opacity=".5" />
    {children}</>;
}

function Tree({ x = 80, y = 93, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="m-4 14 7 3V-20l-7-2Z" fill="#8e7960" /><path d="M3 17V-20l4-1v34Z" fill="#554b44" />
    <path d="M0-69 22-43 14-42 31-20 18-18 29-4 2 10-28-4l12-15-12-3 16-21-9-1L0-69Z" fill="#609977" />
    <path d="m0-69 22 26-8 1 17 22-13 2L29-4 2 10 0-15Z" fill="#367a60" />
    <path d="m-16-27 13 6 15-6M-20-9-3-1l21-10" fill="none" stroke="#91c59b" strokeWidth="2" opacity=".65" />
  </g>;
}

export function DecorArt({ type, className = '', connections, decorative = true, label }: Props) {
  let art: ReactNode;
  if (type === 'road') {
    const connected = connections && Object.values(connections).some(Boolean);
    const directions = connected ? connections : { north: true, south: true };
    art = <>
      <path d="M0 0h160v160H0Z" fill="#273e46" opacity=".15" />
      {directions?.north && <path d="M59 0h42v80H59Z" fill="#51646a" />}
      {directions?.south && <path d="M59 80h42v80H59Z" fill="#51646a" />}
      {directions?.east && <path d="M80 59h80v42H80Z" fill="#51646a" />}
      {directions?.west && <path d="M0 59h80v42H0Z" fill="#51646a" />}
      <rect x="59" y="59" width="42" height="42" rx="6" fill="#51646a" />
      <g fill="none" stroke="#bdd3c7" strokeWidth="2" opacity=".7">
        {directions?.north && <path d="M80 0v12m0 12v12m0 12v8" />}
        {directions?.south && <path d="M80 104v8m0 12v12m0 12v12" />}
        {directions?.east && <path d="M104 80h8m12 0h12m12 0h12" />}
        {directions?.west && <path d="M0 80h12m12 0h12m12 0h8" />}
      </g><circle cx="80" cy="80" r="4" fill="#91b9ad" />
    </>;
  } else if (type === 'tree') {
    art = <Platform green><ellipse cx="80" cy="111" rx="29" ry="13" fill="#2b5345" /><Tree /></Platform>;
  } else if (type === 'lamp') {
    art = <Platform><path d="m59 117 21-11 21 11-21 12Z" fill="#1a303a" />
      <path d="m76 116 8 4V48l-8-3Z" fill="#abc0bf" /><path d="m84 120 6-4V45l-6 3Z" fill="#516c79" />
      <path d="m61 42 19-10 20 10v17L80 69 61 59Z" fill="#29444d" stroke="#a9c4be" strokeWidth="2" />
      <path d="m65 46 15 8 16-8v11L80 65l-15-8Z" fill="#f5d58a" /><path d="m61 42 19 10 20-10-20-10Z" fill="#607e89" />
      <ellipse cx="80" cy="112" rx="40" ry="20" fill="#e8cf80" opacity=".13" /><path d="M80 55v9" stroke="#ffedb0" strokeWidth="4" />
    </Platform>;
  } else if (type === 'park') {
    art = <Platform green><path d="m41 117 39-20 39 20-39 20Z" fill="#8ca390" /><Tree x={49} y={96} scale={.7} /><Tree x={105} y={93} scale={.8} />
      <path d="m58 106 22-12 24 12v17l-24 12-22-12Z" fill="#d1d5bf" /><path d="m58 106 22-12 24 12-24 13Z" fill="#b2c6b7" />
      <path d="M66 105c0-20 28-20 28 0l-14 8Z" fill="#78c7bd" stroke="#d6e3cf" strokeWidth="3" /><path d="m73 101 7-9 8 9" fill="none" stroke="#d0fff1" strokeWidth="2" />
    </Platform>;
  } else if (type === 'bench') {
    art = <Platform><path d="m39 101 45-23 37 19-45 24Z" fill="#bda477" />
      <path d="m39 101 37 20v8l-37-20Zm37 20 45-24v8l-45 24Z" fill="#765f4e" />
      <path d="m43 94 41-22v-17L43 77Z" fill="#c8b188" stroke="#536d72" strokeWidth="3" />
      <path d="m49 80 28-15m-28 23 28-15" stroke="#8f7b62" strokeWidth="2" />
      <path d="M44 108v16m32 5v13m39-35v15" stroke="#acbfbc" strokeWidth="5" />
      <path d="m112 121 12-6 12 6v12l-12 7-12-7Z" fill="#769584" /><Tree x={123} y={112} scale={.35} />
    </Platform>;
  } else if (type === 'flowerbed') {
    art = <Platform green><path d="m34 100 47-24 47 24v20l-47 24-47-24Z" fill="#b9c5b4" />
      <path d="m34 100 47 24 47-24-47-24Z" fill="#344d43" /><path d="m81 124 47-24v20l-47 24Z" fill="#688983" />
      {[{ x: 58, y: 103, c: '#e8a5cf' }, { x: 84, y: 94, c: '#9fa9ed' }, { x: 106, y: 105, c: '#efc78a' }, { x: 81, y: 115, c: '#d9a5df' }].map((flower, i) => <g key={i}>
        <path d={`M${flower.x} ${flower.y}v-19m0 13-7-5m7 2 7-6`} stroke="#84ba8f" strokeWidth="3" />
        <path d={`m${flower.x} ${flower.y - 30} 7 8-7 8-7-8Z`} fill={flower.c} /><circle cx={flower.x} cy={flower.y - 22} r="3" fill="#f6e8ba" />
      </g>)}
    </Platform>;
  } else if (type === 'fountain') {
    art = <Platform><ellipse cx="80" cy="112" rx="48" ry="25" fill="#b8ccc8" /><path d="M32 111v9c0 31 96 31 96 0v-9" fill="#6b9297" />
      <ellipse cx="80" cy="111" rx="48" ry="25" fill="#bad1ca" /><ellipse cx="80" cy="110" rx="39" ry="18" fill="#529baf" />
      <path d="M68 108v-17l12-7 12 7v17l-12 7Z" fill="#d5d9c9" /><ellipse cx="80" cy="89" rx="22" ry="10" fill="#80b6be" stroke="#c5ded6" strokeWidth="3" />
      <path d="M80 88V42m0 18c-18-20-31-9-27 9m27-9c18-20 31-9 27 9m-27-4c-9-12-16-7-15 4m15-4c9-12 16-7 15 4" fill="none" stroke="#a7ece7" strokeWidth="3" strokeLinecap="round" />
      <path d="M48 105c10-7 19-5 26-3m12 15c12 2 23-2 28-6" fill="none" stroke="#b9eee4" strokeWidth="2" opacity=".8" />
    </Platform>;
  } else if (type === 'statue') {
    art = <Platform><path d="m47 114 33-18 33 18v10l-33 17-33-17Z" fill="#a6b5af" />
      <path d="m59 110 21-11 21 11v10l-21 11-21-11Z" fill="#cfcec0" /><path d="m70 107 10-70 10 70-10 7Z" fill="#6b8991" />
      <path d="m80 22 13 24-13 28-13-28Z" fill="#87e2d3" /><path d="m80 22 13 24-13 28V22Z" fill="#399ea8" />
      <path d="m76 43 4-12 7 15-7 17" fill="none" stroke="#c0fff0" strokeWidth="2" /><path d="m54 120 26 13 26-13" fill="none" stroke="#8fd7c7" strokeWidth="2" />
    </Platform>;
  } else {
    art = <Platform><path d="m28 108 52-27 52 27-52 27Z" fill="#9dafaa" stroke="#d5ded2" strokeWidth="2" />
      <path d="m54 95 52 27m-39-34 52 27m-78 0 52-27m-39 34 52-27" stroke="#617d80" strokeWidth="2" />
      <path d="m63 108 17-9 17 9-17 9Z" fill="#73b9ad" /><path d="m76 108 4-3 4 3-4 2Z" fill="#daeee0" />
      {[{ x: 28, y: 107 }, { x: 80, y: 80 }, { x: 132, y: 107 }].map((lamp, i) => <g key={i}><path d={`M${lamp.x} ${lamp.y}v-11`} stroke="#d2d8be" strokeWidth="3" /><circle cx={lamp.x} cy={lamp.y - 12} r="4" fill="#f3dc9d" /></g>)}
    </Platform>;
  }
  return <svg className={`decorArt decorArt-${type} ${className}`.trim()} viewBox="0 0 160 160" width="100%" height="100%" focusable="false"
    aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label ?? LABELS[type] ?? 'Оформление колонии'}>
    {art}
  </svg>;
}
