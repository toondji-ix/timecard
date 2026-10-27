import { db,one,run,id,now,all,type Row } from './db';
import { dateAt,minutesAt,distanceMeters } from './domain';
export function verifyLocation(org:string,input:{lat:number;lng:number;accuracy:number;mocked?:boolean}){
 if(input.mocked)throw Error('This location signal cannot be verified. Please request manual approval.');
 if(input.accuracy>100)throw Error('Your location is not precise enough. Move outdoors and try again.');
 const candidates=all('SELECT * FROM locations WHERE org_id=?',org).map<Row&{distance:number}>(l=>({...l,distance:distanceMeters(input,{lat:l.lat,lng:l.lng})})).sort((a,b)=>(a.distance-a.radius)-(b.distance-b.radius));
 const nearest=candidates.find(l=>l.distance<=l.radius)||candidates[0];
 if(!nearest)throw Error('Your manager needs to add a work location first.');
 if(nearest.distance>nearest.radius)throw Error(`You're ${Math.round(nearest.distance-nearest.radius)} m outside the work area. Move closer or request manual approval.`);
 return nearest;
}
export function writeAttendance(o:any,uid:string,action:string,data:{lat?:number;lng?:number;location?:string;score?:number;synced?:boolean;notes?:string;timestamp?:string}){return db.transaction(()=>{
 const stamp=data.timestamp||now(),day=dateAt(stamp,o.timezone);const open=one('SELECT * FROM attendance WHERE org_id=? AND user_id=? AND check_out IS NULL ORDER BY check_in DESC LIMIT 1',o.id,uid);
 if(action==='in'){if(open||one('SELECT id FROM attendance WHERE org_id=? AND user_id=? AND day=?',o.id,uid,day))throw Error('You have already checked in today.');const [h,min]=o.start_time.split(':').map(Number),late=minutesAt(stamp,o.timezone)>h*60+min+o.grace;run('INSERT INTO attendance(id,org_id,user_id,day,check_in,lat,lng,location_id,match_score,status,late,synced_late,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id(),o.id,uid,day,stamp,data.lat??null,data.lng??null,data.location??null,data.score??null,late?'late':'present',late?1:0,data.synced?1:0,data.notes||'');}
 else {if(!open)throw Error('You need to check in first.');if(Date.parse(stamp)<Date.parse(open.check_in))throw Error('Check-out cannot be before check-in.');const [h,min]=o.end_time.split(':').map(Number);const extra=open.break_start?(Date.parse(stamp)-Date.parse(open.break_start))/60000:0;run('UPDATE attendance SET check_out=?,early=?,break_minutes=break_minutes+?,break_start=NULL,notes=notes||?,synced_late=MAX(synced_late,?),checkout_lat=?,checkout_lng=?,checkout_score=?,checkout_location_id=? WHERE id=?',stamp,minutesAt(stamp,o.timezone)<h*60+min?1:0,extra,data.notes?' | '+data.notes:'',data.synced?1:0,data.lat??null,data.lng??null,data.score??null,data.location??null,open.id);}
 })();}
