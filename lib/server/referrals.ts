import { sql } from '@/lib/server/db';
import { REFERRAL_BONUS, REFERRAL_QUALIFICATION_HQ, referralBonusForCount, referralRoadmapStatus, type ReferralProgram } from '@/lib/game/referrals';
import { pushInbox } from '@/lib/server/inbox';

export async function referralSchemaReady(tx: any): Promise<boolean> {
  const rows = await tx<any[]>`
    SELECT count(*)::int AS columns FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='referral_bonus_claims'
      AND column_name IN ('user_id','invited_user_id','credit_reward','crystal_reward','created_at')
  `;
  return Number(rows[0]?.columns) === 5;
}

const ROADMAP = [
  { target: 1, name: 'Первый сигнал', rewardText: 'Эффект «Радиосигнал» на 7 дней', achievementKey: 'network_1' },
  { target: 3, name: 'Малая сеть', rewardText: '20 кристаллов' },
  { target: 5, name: 'Связной', rewardText: 'Постоянный титул «Связной»', achievementKey: 'network_5' },
  { target: 10, name: 'Орбитальная сеть', rewardText: 'Рамка «Сеть» на 30 дней' },
  { target: 25, name: 'Опора колоний', rewardText: 'Постоянный монумент сети' },
  { target: 50, name: 'Архитектор сети', rewardText: 'Постоянная рамка «Сеть»' },
  { target: 100, name: 'Легенда связи', rewardText: 'Постоянный легендарный ретранслятор' },
] as const;

export async function getReferralProgram(tx: any, userId: string): Promise<ReferralProgram> {
  const enabled = await referralSchemaReady(tx);
  const [totals] = await tx<any[]>`
    SELECT count(*)::int AS total,count(*) FILTER(WHERE referral_qualified_at IS NOT NULL)::int AS qualified
    FROM users WHERE referred_by=${userId} AND id<>${userId}
  `;
  const friendRows = enabled ? await tx<any[]>`
    SELECT u.telegram_id,u.colony_name,u.first_name,u.username,u.referral_qualified_at,
           COALESCE(gs.hq_level,1) AS hq_level,(c.invited_user_id IS NOT NULL) AS bonus_claimed
    FROM users u LEFT JOIN game_states gs ON gs.user_id=u.id
    LEFT JOIN referral_bonus_claims c ON c.user_id=${userId} AND c.invited_user_id=u.id
    WHERE u.referred_by=${userId} AND u.id<>${userId}
    ORDER BY u.created_at DESC,u.id LIMIT 100
  ` : await tx<any[]>`
    SELECT u.telegram_id,u.colony_name,u.first_name,u.username,u.referral_qualified_at,
           COALESCE(gs.hq_level,1) AS hq_level,false AS bonus_claimed
    FROM users u LEFT JOIN game_states gs ON gs.user_id=u.id
    WHERE u.referred_by=${userId} AND u.id<>${userId}
    ORDER BY u.created_at DESC,u.id LIMIT 100
  `;
  const [invitation] = await tx<any[]>`
    SELECT inviter.colony_name,inviter.first_name,inviter.username,COALESCE(gs.hq_level,1) AS hq_level,
           me.referral_qualified_at
    FROM users me JOIN users inviter ON inviter.id=me.referred_by AND inviter.id<>me.id
    LEFT JOIN game_states gs ON gs.user_id=me.id WHERE me.id=${userId}
  `;
  let pendingCount = 0;
  let receivedCount = 0;
  let receivedReward = { credits: 0, crystals: 0 };
  let ownBonusClaimed = false;
  if (enabled) {
    const [pending] = await tx<any[]>`
      SELECT count(*)::int AS count FROM users u
      WHERE u.referred_by IS NOT NULL AND u.referred_by<>u.id AND u.referral_qualified_at IS NOT NULL
        AND (u.referred_by=${userId} OR u.id=${userId})
        AND NOT EXISTS(SELECT 1 FROM referral_bonus_claims c WHERE c.user_id=${userId} AND c.invited_user_id=u.id)
    `;
    const [received] = await tx<any[]>`
      SELECT count(*)::int AS count,COALESCE(sum(credit_reward),0)::bigint AS credits,
             COALESCE(sum(crystal_reward),0)::bigint AS crystals,
             COALESCE(bool_or(invited_user_id=${userId}),false) AS own_claimed
      FROM referral_bonus_claims WHERE user_id=${userId}
    `;
    pendingCount = Number(pending?.count ?? 0);
    receivedCount = Number(received?.count ?? 0);
    receivedReward = { credits: Number(received?.credits ?? 0), crystals: Number(received?.crystals ?? 0) };
    ownBonusClaimed = received?.own_claimed === true;
  }
  const achievementRows = await tx<any[]>`
    SELECT achievement_key,claimed_at FROM user_achievements
    WHERE user_id=${userId} AND achievement_key IN ('network_1','network_5')
  `;
  const milestoneRows = await tx<any[]>`SELECT milestone FROM referral_rewards WHERE user_id=${userId}`;
  const [stats] = await tx<any[]>`SELECT qualified_referrals FROM player_stats WHERE user_id=${userId}`;
  const achievementMap = new Map<string, any>(achievementRows.map((row: any) => [row.achievement_key, row]));
  const milestones = new Set(milestoneRows.map((row: any) => Number(row.milestone)));
  return {
    enabled,
    qualificationHq: REFERRAL_QUALIFICATION_HQ,
    reward: REFERRAL_BONUS,
    totalInvited: Number(totals?.total ?? 0),
    qualifiedInvited: Number(totals?.qualified ?? 0),
    pendingCount,
    pendingReward: referralBonusForCount(pendingCount),
    receivedCount,
    receivedReward,
    invitedBy: invitation ? {
      name: invitation.colony_name || invitation.first_name || invitation.username || 'Колония друга',
      hqLevel: Number(invitation.hq_level), qualified: !!invitation.referral_qualified_at, bonusClaimed: ownBonusClaimed,
    } : null,
    friends: friendRows.map((row: any) => ({
      telegramId: Number(row.telegram_id), name: row.colony_name || row.first_name || row.username || 'Колония друга',
      hqLevel: Number(row.hq_level), qualifiedAt: row.referral_qualified_at ? new Date(row.referral_qualified_at).toISOString() : null,
      bonusClaimed: row.bonus_claimed === true,
    })),
    roadmap: ROADMAP.map((entry) => {
      const achievementKey = 'achievementKey' in entry ? entry.achievementKey : undefined;
      const achievement = achievementKey ? achievementMap.get(achievementKey) : undefined;
      return { ...entry, status: referralRoadmapStatus({
        count: Number(stats?.qualified_referrals ?? 0), target: entry.target,
        requiresClaim: !!achievementKey, unlocked: !!achievement,
        received: achievementKey ? !!achievement?.claimed_at : milestones.has(entry.target),
      }) };
    }),
  };
}

/** Each player only locks and credits their own balance; the other side claims separately. */
export async function claimReferralBonuses(userId: string) {
  return sql.begin(async (tx) => {
    if (!await referralSchemaReady(tx)) throw new Error('Награды за друзей готовятся к запуску. Попробуй немного позже.');
    const state = await tx<any[]>`SELECT user_id FROM game_states WHERE user_id=${userId} FOR UPDATE`;
    if (!state.length) throw new Error('Колония не найдена');
    const receipts = await tx<any[]>`
      INSERT INTO referral_bonus_claims(user_id,invited_user_id,credit_reward,crystal_reward)
      SELECT ${userId},u.id,${REFERRAL_BONUS.credits},${REFERRAL_BONUS.crystals}
      FROM users u
      WHERE u.referred_by IS NOT NULL AND u.referred_by<>u.id AND u.referral_qualified_at IS NOT NULL
        AND (u.referred_by=${userId} OR u.id=${userId})
      ON CONFLICT(user_id,invited_user_id) DO NOTHING
      RETURNING invited_user_id,credit_reward,crystal_reward
    `;
    const reward = receipts.reduce((sum, row) => ({
      credits: sum.credits + Number(row.credit_reward), crystals: sum.crystals + Number(row.crystal_reward),
    }), { credits: 0, crystals: 0 });
    if (receipts.length) {
      await tx`UPDATE game_states SET credits=credits+${reward.credits},crystals=crystals+${reward.crystals},updated_at=now() WHERE user_id=${userId}`;
      await pushInbox(tx, userId, {
        kind: 'reward', dedupeKey: `referral_bonus_${receipts.map((row) => row.invited_user_id).sort().join('_')}`,
        title: 'Связь колоний укрепилась',
        body: `Получено за развитие приглашённых колоний: ${reward.credits} кредитов и ${reward.crystals} кристаллов.`,
        metadata: { count: receipts.length, ...reward },
      });
    }
    return { count: receipts.length, ...reward };
  });
}
