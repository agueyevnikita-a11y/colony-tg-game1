export const LOCAL_PROFILES = [
  { key: 'personal', id: 10001, label: 'Мой тестовый город', description: 'Твой текущий город на этом компьютере. Прогресс сохраняется.' },
  { key: 'new', id: 11001, label: 'Новая колония', description: 'Начало игры с обучением и обычными стартовыми ресурсами. Отдельное сохранение.' },
  { key: 'developed', id: 11002, label: 'Развитая база', description: 'Центр ур. 5, открытые постройки, рецепты, экспедиции и декор. Есть запас ресурсов для проверки.' },
] as const;

export type LocalProfileKey = typeof LOCAL_PROFILES[number]['key'];
export type LocalProfile = typeof LOCAL_PROFILES[number];

export function localProfileByKey(key: unknown): LocalProfile | null {
  return typeof key === 'string' ? LOCAL_PROFILES.find(profile => profile.key === key) ?? null : null;
}
