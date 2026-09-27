import { rewardForStreak } from '@/lib/game/daily-login';

export async function ensureDailyLogin(tx: any, userId: string) {
  await tx`
    INSERT INTO daily_login_streaks(user_id) VALUES(${userId})
    ON CONFLICT(user_id) DO NOTHING
  `;
  const rows = await tx<any[]>`
    SELECT current_streak,longest_streak,last_login_date::text AS last_login_date,
           CURRENT_DATE::text AS today,(CURRENT_DATE-1)::text AS yesterday
    FROM daily_login_streaks WHERE user_id=${userId} FOR UPDATE
  `;
  const row=rows[0];
  if(row?.last_login_date !== row?.today){
    const next=row?.last_login_date===row?.yesterday?Number(row.current_streak)+1:1;
    await tx`
      UPDATE daily_login_streaks
      SET current_streak=${next},longest_streak=GREATEST(longest_streak,${next}),last_login_date=CURRENT_DATE,updated_at=now()
      WHERE user_id=${userId}
    `;
    const reward=rewardForStreak(next);
    await tx`
      INSERT INTO daily_login_rewards(user_id,reward_date,streak_number,cycle_day,credit_reward,crystal_reward)
      VALUES(${userId},CURRENT_DATE,${next},${reward.day},${reward.credits},${reward.crystals})
      ON CONFLICT(user_id,reward_date) DO NOTHING
    `;
  }
  return getDailyLoginState(tx,userId);
}

export async function getDailyLoginState(tx:any,userId:string){
  const streak=(await tx<any[]>`SELECT current_streak,longest_streak,last_login_date::text AS last_login_date FROM daily_login_streaks WHERE user_id=${userId}`)[0];
  const today=(await tx<any[]>`SELECT reward_date::text AS reward_date,streak_number,cycle_day,credit_reward,crystal_reward,claimed_at FROM daily_login_rewards WHERE user_id=${userId} AND reward_date=CURRENT_DATE`)[0]??null;
  return {streak,today};
}

export async function claimDailyLogin(tx:any,userId:string){
  await ensureDailyLogin(tx,userId);
  const rows=await tx<any[]>`
    UPDATE daily_login_rewards SET claimed_at=now()
    WHERE user_id=${userId} AND reward_date=CURRENT_DATE AND claimed_at IS NULL
    RETURNING reward_date::text AS reward_date,streak_number,cycle_day,credit_reward,crystal_reward,claimed_at
  `;
  const reward=rows[0];
  if(!reward) throw new Error('Сегодняшняя награда уже получена');
  await tx`UPDATE game_states SET credits=credits+${Number(reward.credit_reward)},crystals=crystals+${Number(reward.crystal_reward)},updated_at=now() WHERE user_id=${userId}`;
  return reward;
}
