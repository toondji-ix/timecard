import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const {all,run,id,now,audit,decrypt}=await import('../lib/db');
const {faceService}=await import('../lib/face');
const {reconcileBilling}=await import('../lib/billing');
await reconcileBilling();
// Run daily from the same persistent host. Never delete unverified or open attendance.
for(const org of all('SELECT * FROM organizations')){
 const cutoff=new Date(Date.now()-(org.retention||365)*86400000).toISOString();
 const n=run('DELETE FROM attendance WHERE org_id=? AND check_in<? AND check_out IS NOT NULL',org.id,cutoff).changes;
 const owner=all("SELECT user_id FROM memberships WHERE org_id=? AND role='owner'",org.id)[0];
 if(n&&owner)audit(org.id,owner.user_id,'retention.scheduled',{deleted:n,cutoff});
 for(const template of all('SELECT * FROM face_templates WHERE user_id LIKE ? AND created<?',org.id+':%',cutoff)){
  try{await faceService.delete(org.id,decrypt(template.template));run('DELETE FROM face_templates WHERE user_id=?',template.user_id);}catch(e){console.error('Biometric cleanup failed for a workspace; will retry on next maintenance run.');}
 }
}
run('DELETE FROM tokens WHERE expires<?',now());
run('DELETE FROM attendance_proofs WHERE created<?',new Date(Date.now()-86400000).toISOString());
run('DELETE FROM rate_limits WHERE reset<?',Date.now());
run('DELETE FROM challenges WHERE expires<?',now());
run('DELETE FROM oidc_states WHERE expires<?',now());
if(process.env.EMAIL_API_KEY)for(const mail of all('SELECT * FROM outbox WHERE sent=0 ORDER BY created LIMIT 100')){
 try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.EMAIL_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':mail.id},body:JSON.stringify({from:process.env.EMAIL_FROM,to:mail.address,subject:mail.subject,text:mail.body})});if(r.ok)run('UPDATE outbox SET sent=1 WHERE id=?',mail.id);}catch{console.error('Email retry deferred.');}
}
run('DELETE FROM outbox WHERE sent=1 AND created<?',new Date(Date.now()-7*86400000).toISOString());
console.log('Retention, expired sessions and email retries processed.');
