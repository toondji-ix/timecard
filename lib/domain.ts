export const plans = {
  free: { limit: Number(process.env.FREE_STAFF_LIMIT || 15), xlsx: false, locations: 1 },
  business: { limit: Number(process.env.BUSINESS_STAFF_LIMIT || 3000), xlsx: true, locations: Infinity },
  enterprise: { limit: Infinity, xlsx: true, locations: Infinity },
};
export function distanceMeters(a: {lat:number;lng:number}, b: {lat:number;lng:number}) {
  const rad = (n:number) => n * Math.PI / 180;
  const dlat = rad(b.lat-a.lat), dlng = rad(b.lng-a.lng);
  const h = Math.sin(dlat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
export function workedHours(start:string, end:string|null, breakMinutes=0) {
  return Math.max(0, ((end ? Date.parse(end) : Date.now()) - Date.parse(start))/3600000-breakMinutes/60);
}
export function dateAt(time:string|Date, zone:string) { return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time)); }
export function minutesAt(time:string|Date, zone:string) { const p = new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(time)).split(':'); return Number(p[0])*60+Number(p[1]); }
export function leaveDays(start:string,end:string, workdays:number[]=[1,2,3,4,5]) { let n=0; for(let t=Date.parse(start+'T12:00:00Z');t<=Date.parse(end+'T12:00:00Z');t+=86400000) if(workdays.includes(new Date(t).getUTCDay())) n++; return n; }
export function safeCsv(value:unknown) { let s=String(value??''); if(/^[=+\-@\t\r]/.test(s))s="'"+s; return '"'+s.replaceAll('"','""')+'"'; }
