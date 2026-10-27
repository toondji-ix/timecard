import { all,id,now,run } from './db';
export async function email(to:string,subject:string,text:string){
 const key=id();run('INSERT INTO outbox VALUES(?,?,?,?,?,0)',key,to,subject,text,now());
 if(!process.env.EMAIL_API_KEY){if(process.env.NODE_ENV==='production')throw Error('Email delivery is not configured.');return;}
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.EMAIL_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:process.env.EMAIL_FROM,to,subject,text}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Email is queued for delivery. Please try again shortly.');run('UPDATE outbox SET sent=1 WHERE id=?',key);
}
export async function notify(org:string,uid:string,message:string){run('INSERT INTO notifications VALUES(?,?,?,?,?,0)',id(),org,uid,message,now());const person=all('SELECT email FROM users WHERE id=?',uid)[0];if(person)await email(person.email,'Timecard update',message).catch(()=>{});}
