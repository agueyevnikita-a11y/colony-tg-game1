export type ClosureStatus = 'requested'|'cancelled'|'active_data_erased'|'copies_pending'|'completed';
export interface ClosureCase { version:number; revision:number; id:string; accountKey:string; userId:string; status:ClosureStatus; requestedAt:string; updatedAt:string; events:Array<{id:string;at:string;requestId:string;userId:string;action:string;details:Record<string,unknown>}>; [key:string]:unknown }
export const PRIVACY_CAPABILITY: number;
export function privacyConfig(): {secret:string;directory:string};
export function accountKey(telegramId:number):string;
export function initPrivacyStore():Promise<void>;
export function assertPrivacyStoreReady():Promise<{version:number;entries:Record<string,number>;[key:string]:unknown}>;
export function readAccountCase(key:string):Promise<ClosureCase|null>;
export function listAccountCases():Promise<ClosureCase[]>;
export function saveAccountCase(record:ClosureCase,action:string,details?:Record<string,unknown>):Promise<ClosureCase>;
export function newAccountCase(key:string,userId:string):ClosureCase;
export function publicCase(record:ClosureCase|null):{id:string;status:ClosureStatus;requestedAt:string;updatedAt:string}|null;
export function isClosedCase(record:ClosureCase|null):boolean;
