'use client';

import { GameIcon } from '@/components/GameIcon';
import '@/app/colony-guide-entry.css';

/** The permanent guide lives with device and account settings, not in each header. */
export function ColonyGuideEntry({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="card colonyGuideEntry" data-guide-entry aria-haspopup="dialog" onClick={onOpen}>
    <span className="colonyGuideEntryIcon" aria-hidden="true"><GameIcon name="help" size={30} /></span>
    <span className="colonyGuideEntryText"><strong>Руководство колониста</strong><span>Ресурсы, производство и развитие базы</span></span>
    <GameIcon name="arrow" size={20} className="colonyGuideEntryArrow" />
  </button>;
}
