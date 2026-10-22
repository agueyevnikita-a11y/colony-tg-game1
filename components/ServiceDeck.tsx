import { CITY_DIRECTIONS, connectedCityDirections, type RoadConnections } from '@/lib/game/city-connections';
import '@/app/city-connections.css';

/** Inner SVG content in a 160×160 viewport, shared by map and shop previews. */
export function ServiceDeck({ connections = {} }: { connections?: RoadConnections }) {
  return <g className="serviceDeckSurface" data-service-deck-connections={connectedCityDirections(connections).join(' ')}>
    <ellipse cx="80" cy="113" rx="61" ry="20" fill="#08121b" opacity=".35" />
    {CITY_DIRECTIONS.filter(direction => connections[direction.key]).map(direction => <g key={direction.key}
      data-road-direction={direction.key} transform={`rotate(${direction.rotation} 80 80)`}>
      <path className="serviceDeckHull" d="M52 0h56v83H52Z" fill="var(--city-deck-dark, #253540)" />
      <path className="serviceDeckPlate" d="M56 0h48v77H56Z" fill="var(--city-deck-panel, #b8c4cb)" />
      <path d="M63 0h34v76H63Z" fill="var(--city-deck-inset, #566875)" />
      <path d="M65 12h30M65 27h30M65 42h30M65 57h30" stroke="#253943" strokeWidth="2.5" />
      <path className="serviceDeckRail" d="M57 0v70m46-70v70" stroke="var(--city-deck-edge, #e8b35c)" strokeWidth="3" />
      <path d="M60 1v68m40-68v68" stroke="#edf2f1" strokeWidth="1.5" opacity=".75" />
      {[10, 39, 67].map(y => <g key={y} fill="var(--city-deck-dark, #253540)"><circle cx="57" cy={y} r="1.8" /><circle cx="103" cy={y} r="1.8" /></g>)}
      <rect className="serviceDeckSignal" x="77" y="18" width="6" height="9" rx="2" fill="var(--city-deck-light, #74e3df)" />
    </g>)}
    <path className="serviceDeckHull" d="M26 58 34 42h92l8 16v57l-12 13H38l-12-13Z" fill="var(--city-deck-dark, #253540)" />
    <path d="M29 108h102v10l-10 8H39l-10-8Z" fill="#152530" />
    <path className="serviceDeckPlate" d="M28 54 36 40h88l8 14v55l-9 9H37l-9-9Z" fill="var(--city-deck-panel, #b8c4cb)" stroke="#e2e8e5" strokeWidth="1.4" />
    <path d="m132 54-9 10v54l9-9Z" fill="#72838e" />
    <path d="M38 55h84v46l-7 8H45l-7-8Z" fill="var(--city-deck-dark, #253540)" />
    <rect x="45" y="59" width="70" height="42" rx="5" fill="var(--city-deck-inset, #566875)" />
    <path d="M49 66h62M49 74h62M49 82h62M49 90h62" stroke="#293d48" strokeWidth="2" />
    <path d="M54 62v36m13-36v36m13-36v36m13-36v36m13-36v36" stroke="#a3b2b8" strokeWidth=".9" opacity=".65" />
    {!connections.north && <path className="serviceDeckRail" d="M43 43h74" stroke="var(--city-deck-edge, #e8b35c)" strokeWidth="4" />}
    {!connections.south && <path className="serviceDeckRail" d="M43 114h74" stroke="var(--city-deck-edge, #e8b35c)" strokeWidth="4" />}
    {!connections.west && <path className="serviceDeckRail" d="M31 61v40" stroke="var(--city-deck-edge, #e8b35c)" strokeWidth="3" />}
    {!connections.east && <path className="serviceDeckRail" d="M129 61v40" stroke="var(--city-deck-edge, #e8b35c)" strokeWidth="3" />}
    {[{ x: 38, y: 51 }, { x: 122, y: 51 }, { x: 38, y: 107 }, { x: 122, y: 107 }].map(point => <g key={`${point.x}:${point.y}`}>
      <path d={`m${point.x - 5} ${point.y - 4} 5-3 5 3v8l-5 3-5-3Z`} fill="var(--city-deck-dark, #253540)" />
      <path className="serviceDeckGlow" d={`m${point.x - 3} ${point.y - 3} 3-2 3 2v3l-3 2-3-2Z`} fill="var(--city-deck-light, #74e3df)" />
    </g>)}
    <path d="M51 121h13m32 0h13" stroke="var(--city-deck-edge, #e8b35c)" strokeWidth="2" />
  </g>;
}
