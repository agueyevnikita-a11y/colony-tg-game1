import { CITY_DIRECTIONS, connectedCityDirections, type RoadConnections } from '@/lib/game/city-connections';
import '@/app/city-connections.css';

/** Matching approach plates extend beneath an adjacent building's foundation. */
export function CityConnections({ connections, active = true }: { connections: RoadConnections; active?: boolean }) {
  const directions = connectedCityDirections(connections);
  if (!directions.length) return null;
  return <>
    <svg className={`cityArrivalDeck${active ? '' : ' isPreparing'}`} viewBox="0 0 160 160" aria-hidden="true" focusable="false" data-building-road-connections={directions.join(' ')}>
      {CITY_DIRECTIONS.filter(direction => connections[direction.key]).map(direction => <g key={direction.key} data-building-road-direction={direction.key} transform={`rotate(${direction.rotation} 80 80)`}>
        <path d="M52 0h56v62l-9 10H61l-9-10Z" fill="var(--city-deck-dark, #253540)" />
        <path className="cityDockPlate" d="M56 0h48v55l-7 8H63l-7-8Z" fill="var(--city-deck-panel, #b8c4cb)" />
        <path d="M63 0h34v54H63Z" fill="var(--city-deck-inset, #566875)" />
        <path d="M65 11h30M65 26h30M65 41h30" stroke="#293d48" strokeWidth="2.5" />
        <path className="cityDockRail" d="M57 0v48m46-48v48" stroke="var(--city-deck-edge, #e8b35c)" strokeWidth="3" />
        <path d="M61 52h38v9H61Z" fill="var(--city-deck-dark, #253540)" />
        <path className="cityDockGlow" d="M66 55h28" stroke="var(--city-deck-light, #74e3df)" strokeWidth="3" />
      </g>)}
    </svg>
    <svg className="cityArrivalLights" viewBox="0 0 160 160" aria-hidden="true" focusable="false">
      {CITY_DIRECTIONS.filter(direction => connections[direction.key]).map(direction => <g key={direction.key} transform={`rotate(${direction.rotation} 80 80)`}>
        <rect x="53" y="4" width="7" height="13" rx="2" fill="var(--city-deck-dark, #253540)" />
        <rect x="100" y="4" width="7" height="13" rx="2" fill="var(--city-deck-dark, #253540)" />
        <path className="cityDockGlow" d="M56 7v7m47-7v7" stroke="var(--city-deck-light, #74e3df)" strokeWidth="3" strokeLinecap="round" />
      </g>)}
    </svg>
  </>;
}
