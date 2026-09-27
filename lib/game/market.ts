export type MarketResource = 'ore' | 'energy' | 'parts';
export const MARKET_FEE_RATE = 0.05;
export const MARKET_ORDER_TTL_HOURS = 24;
export const MARKET_MAX_OPEN_ORDERS = 8;
export const MARKET_MIN_ORDER_VALUE = 50;
export const MARKET_MAX_AMOUNT = 100_000;
export const MARKET_RULES: Record<MarketResource,{label:string;emoji:string;minUnitPrice:number;maxUnitPrice:number;minAmount:number}> = {
  ore:{label:'Руда',emoji:'⛏',minUnitPrice:1,maxUnitPrice:20,minAmount:25},
  energy:{label:'Энергия',emoji:'⚡',minUnitPrice:1,maxUnitPrice:20,minAmount:25},
  parts:{label:'Детали',emoji:'⚙️',minUnitPrice:5,maxUnitPrice:100,minAmount:5},
};
export function marketFee(grossCredits:number){ return grossCredits<=0?0:Math.max(1,Math.floor(grossCredits*MARKET_FEE_RATE)); }
export function validateMarketOrder(resource:string,amount:number,unitPrice:number){
  if(!Object.hasOwn(MARKET_RULES, resource)) throw new Error('Этот ресурс нельзя продавать на рынке');
  const rule=MARKET_RULES[resource as MarketResource];
  if(!Number.isInteger(amount)||amount<rule.minAmount||amount>MARKET_MAX_AMOUNT) throw new Error(`Количество: от ${rule.minAmount} до ${MARKET_MAX_AMOUNT}`);
  if(!Number.isInteger(unitPrice)||unitPrice<rule.minUnitPrice||unitPrice>rule.maxUnitPrice) throw new Error(`Цена ${rule.label.toLowerCase()}: ${rule.minUnitPrice}–${rule.maxUnitPrice} кредитов за единицу`);
  if(amount*unitPrice<MARKET_MIN_ORDER_VALUE) throw new Error(`Минимальная стоимость ордера — ${MARKET_MIN_ORDER_VALUE} кредитов`);
}
