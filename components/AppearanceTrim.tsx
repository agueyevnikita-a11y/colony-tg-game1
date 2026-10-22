/** Shared 320×320 object platform trim; hidden until a city style is equipped. */
export function AppearanceTrim({ type, kind }: { type: string; kind: 'building' | 'decor' }) {
  const biology = ['habitat', 'tree', 'park', 'flowerbed'].includes(type);
  const industry = ['mine', 'deep_mine', 'foundry', 'warehouse', 'logistics', 'fountain'].includes(type);
  return <g className={`appearanceTrim ${biology ? 'isBiology' : industry ? 'isIndustry' : 'isSignal'} is${kind === 'building' ? 'Building' : 'Decor'}`} opacity="0" aria-hidden="true" pointerEvents="none">
    <path className="appearanceTrimHalo" d="m5 226 155-79 155 79-155 80Z" />
    <path className="appearanceTrimHull" d="m8 226 152 77 152-77v8l-152 78L8 234Z" />
    <path className="appearanceTrimEdge" d="m8 226 152 77 152-77m-269 15 117 60 117-60" />
    <path className="appearanceTrimRail" d="m21 236 30 15m17 9 30 15m124 0 30-15m17-9 30-15" />
    <path className="appearanceTrimSignal" d="m145 303 15 8 15-8m-154-82 10-5m258 0 10 5" />
    {biology ? <path className="appearanceTrimMark" d="M151 291h18m-14-4h10" /> : industry
      ? <path className="appearanceTrimMark" d="m137 287 7 4m8 4 7 4m8-4 7-4m8-4 7-4" />
      : <path className="appearanceTrimMark" d="m148 289 12-6 12 6-12 6Z" />}
  </g>;
}
