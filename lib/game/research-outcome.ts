import { BUILDINGS } from './config';
import { EXPEDITIONS } from './expeditions';
import { FEATURE_RESEARCH } from './unlocks';

/** Opening a route is distinct from opening expeditions and building their centre. */
export function researchRouteOutcome(researchKey: string) {
  const route = EXPEDITIONS.find(item => item.requiredResearch === researchKey);
  if (!route) return null;
  const requiredHq = Math.max(route.unlockHq, BUILDINGS.expedition_center.unlockHq);
  return {
    routeKey: route.key,
    routeName: route.name,
    requiredHq,
    requirementsText: `Для запуска нужны Центр колонии ур. ${requiredHq} и работающий центр экспедиций. Если экспедиции ещё закрыты, сначала изучи «${FEATURE_RESEARCH.expeditions.name}».`,
  };
}
