import {one} from './db';
export function allowanceFor(org:string,uid:string,type:Record<string,any>,year:number):number{return one('SELECT allowance FROM leave_allowances WHERE org_id=? AND user_id=? AND type_id=? AND year=?',org,uid,type.id,year)?.allowance??type.allowance;}
export function validateCalendarDay(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw Error('Choose a valid calendar date.');return value;}
