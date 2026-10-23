import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { PRODUCTS } from '@/lib/game/config';
import { permanentProductOwned } from '@/lib/game/product-ownership';
import { assertFeature } from '@/lib/server/feature-flags';
export const runtime='nodejs';
type ProductId=keyof typeof PRODUCTS;
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);const userId=await ensurePlayer(auth.user,auth.startParam);
    await sql.begin(async tx=>{await assertFeature(tx,userId,'stars_shop');});
    const body:unknown=await request.json();
    const productId=body && typeof body==='object' && !Array.isArray(body) ? (body as {productId?:unknown}).productId : undefined;
    if(typeof productId!=='string' || !Object.hasOwn(PRODUCTS,productId))throw new Error('Товар не найден');
    const product=PRODUCTS[productId as ProductId];
    if(product.kind!=='premium'){
      const ownerships=await sql<{cosmetic_id:string;expires_at:null}[]>`
        SELECT cosmetic_id,expires_at FROM user_cosmetics WHERE user_id=${userId} AND expires_at IS NULL
      `;
      if(permanentProductOwned(productId,ownerships))throw new Error(product.kind==='bundle'?'Все предметы набора уже есть у тебя навсегда':'Этот предмет уже есть у тебя навсегда');
    }
    const token=process.env.BOT_TOKEN;if(!token)throw new Error('BOT_TOKEN is not configured');
    const payload=`shop:${productId}:${crypto.randomUUID()}`.slice(0,128);
    const [purchase]=await sql<{id:string}[]>`INSERT INTO purchases(user_id,product_id,stars_paid,invoice_payload) VALUES(${userId},${productId},${product.stars},${payload}) RETURNING id`;
    if(!purchase)throw new Error('Не удалось подготовить покупку');
    const tgResponse=await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:product.title,description:'Digital item for COLONY Mini App',payload,currency:'XTR',prices:[{label:product.title,amount:product.stars}]})});
    const data=await tgResponse.json() as any;if(!data.ok)throw new Error(data.description??'Telegram invoice error');
    return NextResponse.json({ok:true,invoiceLink:data.result,purchaseId:purchase.id});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
