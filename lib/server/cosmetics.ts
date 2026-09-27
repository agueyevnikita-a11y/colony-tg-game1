export async function grantCosmetic(tx:any,userId:string,cosmeticId:string,source:string,days?:number){
 const permanent=await tx<any[]>`SELECT 1 FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id=${cosmeticId} AND expires_at IS NULL LIMIT 1`; if(permanent.length)return;
 if(!days){await tx`INSERT INTO user_cosmetics (user_id,cosmetic_id,source,expires_at) VALUES (${userId},${cosmeticId},${source},NULL)`;return;}
 const temp=await tx<any[]>`SELECT acquired_at,expires_at FROM user_cosmetics WHERE user_id=${userId} AND cosmetic_id=${cosmeticId} AND expires_at>now() ORDER BY expires_at DESC LIMIT 1`;
 if(temp[0]) await tx`UPDATE user_cosmetics SET expires_at=GREATEST(expires_at,now())+make_interval(days=>${days}) WHERE user_id=${userId} AND cosmetic_id=${cosmeticId} AND acquired_at=${temp[0].acquired_at}`;
 else await tx`INSERT INTO user_cosmetics (user_id,cosmetic_id,source,expires_at) VALUES (${userId},${cosmeticId},${source},now()+make_interval(days=>${days}))`;
}
