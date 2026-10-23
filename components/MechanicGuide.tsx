import { GameIcon } from '@/components/GameIcon';
import '@/app/mechanic-guide.css';

/** One compact place for the goal, explicit action and outcome of a mechanic. */
export function MechanicGuide({ steps, title = 'Как это работает' }: {
  steps: readonly string[];
  title?: string;
}) {
  if (!steps.length) return null;
  return <details className="mechanicGuide">
    <summary><GameIcon name="info" size={16} /><span>{title}</span><GameIcon name="arrow" size={14} /></summary>
    <ol>{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
  </details>;
}
