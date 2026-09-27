import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql, type JsonValue } from '@/lib/server/db';
import { assertRateLimit } from '@/lib/server/rate-limit';
import { pushInbox } from '@/lib/server/inbox';

export const runtime='nodejs';
const categories=new Set(['general','bug','balance','idea','payment']);

export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);const userId=await ensurePlayer(auth.user,auth.startParam);
    await assertRateLimit(`feedback:${userId}`,5,3600);
    const body=await request.json() as {category?:string;message?:string;context?:Record<string,JsonValue>};
    const category=categories.has(String(body.category))?String(body.category):'general';
    const message=String(body.message??'').trim();
    if(message.length<5)throw new Error('Напишите чуть подробнее — минимум 5 символов');
    if(message.length>2000)throw new Error('Сообщение слишком длинное — максимум 2000 символов');
    const rows=await sql<any[]>`
      INSERT INTO player_feedback(user_id,category,message,client_version,context)
      VALUES(${userId},${category},${message},'1.0.1-beta.1',${sql.json(body.context??{})})
      RETURNING id
    `;
    await sql.begin(async tx=>{await pushInbox(tx,userId,{kind:'system',dedupeKey:`feedback_${rows[0]?.id}`,title:'Спасибо за обратную связь',body:'Сообщение сохранено. В закрытой бете мы читаем такие сообщения вручную.'});});
    return NextResponse.json({ok:true,id:rows[0]?.id});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Ошибка отправки'},{status:400});}
}
