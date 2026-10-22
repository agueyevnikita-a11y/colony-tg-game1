import type { ReactNode } from 'react';
import '@/app/section-atmosphere.css';

export type ColonySection = 'city' | 'build' | 'market' | 'missions' | 'shop' | 'social';

const SCENES: Record<ColonySection, ReactNode> = {
  city: <>
    <path className="sectionSceneHull" d="M36 228h315l32 25H4l32-25Z" />
    <path d="M51 226v-45a42 42 0 0 1 84 0v45m-72-43h60m-30-44v87m64 0v-82h85v82m-72-68h59m-59 17h59m-59 17h59m-59 17h59M271 226v-38h62v38m-31-38v-33m-12 11h24" />
    <path className="sectionSceneLight" d="M74 218h38m62-64h52m-52 47h52m59 17h34" />
    <ellipse cx="325" cy="70" rx="34" ry="12" transform="rotate(-24 325 70)" />
    <ellipse cx="301" cy="87" rx="14" ry="5" transform="rotate(-24 301 87)" />
    <path d="M18 111c30-19 59-18 87-4M4 286c95-24 247-24 384 0" />
  </>,
  build: <>
    <path className="sectionSceneHull" d="m194 69 80 46v92l-80 46-80-46v-92l80-46Z" />
    <path d="m194 69 80 46-80 47-80-47m80 47v91m-60-127 60-35 60 35m-120 67 60 35 60-35" />
    <path d="M114 138H60l-24 24H6m108 28H78l-22 22H6m268-74h49l24-24h42m-115 76h49l24 24h42M194 69V37m-30 18V21m60 34V21" />
    <path className="sectionSceneLight" d="m194 120 33 19v38l-33 19-33-19v-38l33-19Z" />
    <circle cx="36" cy="162" r="5" /><circle cx="347" cy="114" r="5" />
    <path d="M18 254h70m-70 13h45m229-13h78m-52 13h52" />
  </>,
  market: <>
    <path className="sectionSceneHull" d="m196 162 137 55-137 55L59 217l137-55Z" />
    <path d="m59 217 137 56 137-56v12l-137 55-137-55v-12Zm52-19 85 35 85-35m-85-80 41 18v53l-41 18-41-18v-53l41-18Zm-41 18 41 18 41-18m-41 18v53m-19-80v47m38-47v47" />
    <path d="M48 219v-91h33m263 91v-91h-33M35 128h26m270 0h26M48 144h16m280 0h-16M115 73h137m-18-12 18 12-18 12m33 11H130m18-12-18 12 18 12" />
    <path className="sectionSceneLight" d="M94 231h15m174 0h15m-122-71 20 9 20-9" />
  </>,
  missions: <>
    <circle cx="200" cy="154" r="102" /><circle cx="200" cy="154" r="74" strokeDasharray="5 13" />
    <ellipse cx="200" cy="154" rx="162" ry="55" transform="rotate(-32 200 154)" />
    <path className="sectionSceneHull" d="m200 107 38 21v44l-38 22-38-22v-44l38-21Z" />
    <path className="sectionSceneLight" d="m183 152 12 12 24-27" />
    <path d="M200 34v19m0 202v19M80 154h19m202 0h19M49 95l19 8m264 102 19 8" />
    <circle cx="320" cy="91" r="7" /><circle cx="78" cy="219" r="4" />
    <path d="M23 279h90m-90 12h57m214-12h83m-51 12h51" />
  </>,
  shop: <>
    <path className="sectionSceneHull" d="m196 190 119 42-119 43-119-43 119-42Z" />
    <path d="m77 232 119 43 119-43v15l-119 43-119-43v-15Zm41-72 78-44 78 44v62l-78 29-78-29v-62Zm0 0 78 33 78-33m-78 33v58" />
    <path className="sectionSceneLight" d="m196 77 29 35-29 56-29-56 29-35Zm-29 35h58m-29-35v91" />
    <path d="M64 201V97l32-18m232 122V97l-32-18M64 114h15m249 0h-15M44 261h26m252 0h26M122 74l-9-18m157 18 9-18" />
    <path className="sectionSceneLight" d="m146 237 50 18 50-18" />
  </>,
  social: <>
    <path className="sectionSceneHull" d="m196 209 49 24-49 24-49-24 49-24Zm-118-81 33 16-33 16-33-16 33-16Zm236 0 33 16-33 16-33-16 33-16Z" />
    <path d="M196 232V130m-17 103v-37h34v37M78 144V99m236 45V99M78 160v19l118 53 118-53v-19M78 112l118 59 118-59m-118 59v-41" />
    <circle className="sectionSceneLight" cx="196" cy="117" r="13" />
    <path d="M174 94a31 31 0 0 0 0 46m44-46a31 31 0 0 1 0 46m-59-61a52 52 0 0 0 0 76m74-76a52 52 0 0 1 0 76M64 83a20 20 0 0 0 0 30m28-30a20 20 0 0 1 0 30m208-30a20 20 0 0 0 0 30m28-30a20 20 0 0 1 0 30" />
    <path className="sectionSceneLight" d="M78 172v7l33 15m203-22v7l-33 15m-98 44 13 6 13-6" />
    <path d="M34 272h85m-85 12h54m184-12h85m-54 12h54" />
  </>,
};

/** Quiet, non-interactive room identity. It adds no height or motion to the UI. */
export function SectionAtmosphere({ section }: { section: ColonySection }) {
  return <div className={`sectionAtmosphere sectionAtmosphere-${section}`} aria-hidden="true">
    <div className="sectionAtmospherePanel" />
    <svg className="sectionAtmosphereScene" viewBox="0 0 392 312" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {SCENES[section]}
    </svg>
    <div className="sectionAtmosphereEdge" />
  </div>;
}
