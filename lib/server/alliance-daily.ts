import { ALLIANCE_DAILY_GOALS, type AllianceDailyEvent } from '@/lib/game/alliance';

export async function ensureAllianceDailyGoals(tx: any, allianceId: string) {
  for (const goal of ALLIANCE_DAILY_GOALS) {
    await tx`
      INSERT INTO alliance_daily_goals(alliance_id,goal_date,goal_key,event_name,target,reward_crystals,reward_credits)
      VALUES(${allianceId},CURRENT_DATE,${goal.key},${goal.event},${goal.target},${goal.rewardCrystals},${goal.rewardCredits})
      ON CONFLICT(alliance_id,goal_date,goal_key) DO NOTHING
    `;
  }
}

export async function recordAllianceDailyEvent(tx: any, userId: string, event: AllianceDailyEvent, amount = 1) {
  const membership = (await tx<any[]>`SELECT alliance_id FROM alliance_members WHERE user_id=${userId} LIMIT 1`)[0];
  if (!membership) return;
  await ensureAllianceDailyGoals(tx, membership.alliance_id);
  const matching = ALLIANCE_DAILY_GOALS.filter((goal) => goal.event === event);
  for (const cfg of matching) {
    const updated = await tx<any[]>`
      WITH current AS (
        SELECT alliance_id,goal_date,goal_key,progress,target
        FROM alliance_daily_goals
        WHERE alliance_id=${membership.alliance_id} AND goal_date=CURRENT_DATE AND goal_key=${cfg.key} AND completed_at IS NULL
        FOR UPDATE
      )
      UPDATE alliance_daily_goals g
      SET progress=LEAST(g.target,g.progress+${amount}),
          completed_at=CASE WHEN g.progress+${amount} >= g.target THEN COALESCE(g.completed_at,now()) ELSE g.completed_at END
      FROM current c
      WHERE g.alliance_id=c.alliance_id AND g.goal_date=c.goal_date AND g.goal_key=c.goal_key
      RETURNING GREATEST(0,LEAST(${amount},c.target-c.progress))::bigint AS accepted
    `;
    if (!updated.length) continue;
    const accepted = Number(updated[0].accepted ?? 0);
    if (accepted <= 0) continue;
    await tx`
      INSERT INTO alliance_daily_goal_members(alliance_id,goal_date,goal_key,user_id,contribution)
      VALUES(${membership.alliance_id},CURRENT_DATE,${cfg.key},${userId},${accepted})
      ON CONFLICT(alliance_id,goal_date,goal_key,user_id)
      DO UPDATE SET contribution=alliance_daily_goal_members.contribution+EXCLUDED.contribution
    `;
  }
}

export async function getAllianceDailyState(tx: any, userId: string, allianceId: string) {
  await ensureAllianceDailyGoals(tx, allianceId);
  return tx<any[]>`
    SELECT g.*,
           COALESCE(m.contribution,0)::bigint AS my_contribution,
           m.claimed_at AS my_claimed_at
    FROM alliance_daily_goals g
    LEFT JOIN alliance_daily_goal_members m
      ON m.alliance_id=g.alliance_id AND m.goal_date=g.goal_date AND m.goal_key=g.goal_key AND m.user_id=${userId}
    WHERE g.alliance_id=${allianceId} AND g.goal_date=CURRENT_DATE
    ORDER BY g.goal_key
  `;
}
