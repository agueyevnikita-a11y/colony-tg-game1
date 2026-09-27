import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getInitDataFromRequest } from '@/lib/server/telegram-auth';
import { ensurePlayer } from '@/lib/server/game';
import { sql } from '@/lib/server/db';
import { PRODUCTS } from '@/lib/game/config';
import { assertFeature } from '@/lib/server/feature-flags';
export const runtime='nodejs';
type ProductId=keyof typeof PRODUCTS;
export async function POST(request:Request){
  try{
    const auth=getInitDataFromRequest(request);const userId=await ensurePlayer(auth.user,auth.startParam);
    await sql.begin(async tx=>{await assertFeature(tx,userId,'stars_shop');});
    const {productId}=await request.json() as {productId:ProductId};const product=PRODUCTS[productId];if(!product)throw new Error('Unknown product');
    const token=process.env.BOT_TOKEN;if(!token)throw new Error('BOT_TOKEN is not configured');
    const payload=`shop:${productId}:${crypto.randomUUID()}`.slice(0,128);
    await sql`INSERT INTO purchases(user_id,product_id,stars_paid,invoice_payload) VALUES(${userId},${productId},${product.stars},${payload})`;
    const tgResponse=await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:product.title,description:'Digital item for COLONY Mini App',payload,currency:'XTR',prices:[{label:product.title,amount:product.stars}]})});
    const data=await tgResponse.json() as any;if(!data.ok)throw new Error(data.description??'Telegram invoice error');
    return NextResponse.json({ok:true,invoiceLink:data.result});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Unknown error'},{status:400});}
}
