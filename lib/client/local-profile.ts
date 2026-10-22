import { LOCAL_PROFILES, localProfileByKey } from '../game/local-profiles';

/** Unknown or ambiguous URLs always keep the existing personal test city. */
export function selectedLocalProfile(search: string) {
  const values = new URLSearchParams(search).getAll('local_profile');
  return (values.length === 1 ? localProfileByKey(values[0]) : null) ?? LOCAL_PROFILES[0];
}

export function localProfileHeaders(headers: Record<string, string>, search: string, localSandbox: boolean) {
  if (!localSandbox || headers['x-telegram-init-data']) return headers;
  return { ...headers, 'x-dev-user-id': String(selectedLocalProfile(search).id) };
}
