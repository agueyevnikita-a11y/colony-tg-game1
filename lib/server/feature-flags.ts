function bucket(userId: string, key: string) {
  let h = 2166136261;
  const input = `${userId}:${key}`;
  for (let i=0;i<input.length;i++) { h ^= input.charCodeAt(i); h = Math.imul(h,16777619); }
  return (h >>> 0) % 100;
}

export async function getFeatureFlags(tx: any, userId: string) {
  const flags = await tx<any[]>`
    SELECT f.flag_key,f.enabled,f.rollout_percent,o.enabled AS override_enabled
    FROM feature_flags f
    LEFT JOIN feature_flag_overrides o ON o.flag_key=f.flag_key AND o.user_id=${userId}
  `;
  const out: Record<string, boolean> = {};
  for (const f of flags) {
    out[f.flag_key] = f.override_enabled === null || f.override_enabled === undefined
      ? Boolean(f.enabled) && bucket(userId,String(f.flag_key)) < Number(f.rollout_percent)
      : Boolean(f.override_enabled);
  }
  return out;
}

export async function assertFeature(tx: any, userId: string, flagKey: string) {
  const flags = await getFeatureFlags(tx,userId);
  if (!flags[flagKey]) throw new Error('Эта функция временно отключена для закрытого теста');
}
