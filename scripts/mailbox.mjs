import Database from 'better-sqlite3';
if(process.env.NODE_ENV==='production')throw Error('Local mailbox is development only.');
const db=new Database('data/timecard.sqlite',{readonly:true});
for(const mail of db.prepare('SELECT address,subject,body,created FROM outbox ORDER BY created DESC LIMIT 10').all())console.log(mail);
