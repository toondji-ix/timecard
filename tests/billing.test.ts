import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {unlinkSync} from 'node:fs';
const path=resolve('data/billing-test-'+randomUUID()+'.sqlite');process.env.DATABASE_PATH=path;process.env.PAYSTACK_SECRET_KEY='sk_test_placeholder';
const {db,run,one}=await import('../lib/db');const {verifiedEvent,handleBillingEvent,createCheckout,paystack}=await import('../lib/billing');
test('Paystack webhooks reject forged signatures and derive stable replay identifiers',()=>{const raw=JSON.stringify({event:'charge.success',data:{reference:'test'}}),key='sk_test_placeholder',signature=createHmac('sha512',key).update(raw).digest('hex');assert.equal(verifiedEvent(raw,signature,key).id,verifiedEvent(raw,signature,key).id);assert.throws(()=>verifiedEvent(raw,'bad',key),/signature/);});
test('live keys are rejected before any network request',async()=>{const old=process.env.PAYSTACK_SECRET_KEY;process.env.PAYSTACK_SECRET_KEY='sk_live_rejected';await assert.rejects(()=>paystack('plan'),/Live billing is disabled/);process.env.PAYSTACK_SECRET_KEY=old;});
test('flat NGN 15,000 test checkout, verified upgrades, payment attention and cancellation are durable',async t=>{
 run("INSERT INTO organizations(id,name) VALUES('org','Billing test')");let subscriptionStatus='active',requests=0,reference='';
 t.mock.method(globalThis,'fetch',async(url:string,options?:RequestInit)=>{requests++;const body=options?.body?JSON.parse(options.body as string):{};let data:any;
 if(url.endsWith('/plan')&&options?.method==='POST'){assert.equal(body.amount,1500000);assert.equal(body.currency,'NGN');data={plan_code:'PLN_test'};}
 else if(url.includes('/plan/'))data={plan_code:'PLN_test',amount:1500000,currency:'NGN',interval:'monthly'};
 else if(url.includes('transaction/initialize')){reference=body.reference;assert.equal(body.amount,1500000);data={authorization_url:'https://checkout.paystack.com/test'};}
 else if(url.includes('transaction/verify'))data={domain:'test',status:'success',amount:1500000,currency:'NGN',customer:{customer_code:'CUS_test',email:'owner@example.invalid'},plan_object:{plan_code:'PLN_test'}};
 else data={domain:'test',subscription_code:'SUB_test',status:subscriptionStatus,customer:{customer_code:'CUS_test'},plan:{plan_code:'PLN_test',amount:1500000,currency:'NGN'}};
 return Response.json({status:true,data});});
 const url=await createCheckout('org','owner@example.invalid','http://localhost:3000');assert.equal(url,'https://checkout.paystack.com/test');const prior=requests;assert.equal(await createCheckout('org','owner@example.invalid','http://localhost:3000'),url);assert.equal(requests,prior);
 await handleBillingEvent({id:'evt_payment',event:'charge.success',data:{domain:'test',reference}});assert.equal(one("SELECT plan FROM organizations WHERE id='org'")!.plan,'business');const count=requests;await handleBillingEvent({id:'evt_payment',event:'charge.success',data:{domain:'test',reference}});assert.equal(requests,count);
 await handleBillingEvent({id:'evt_sub',event:'subscription.create',data:{domain:'test',subscription_code:'SUB_test'}});assert.equal(one("SELECT quantity FROM subscriptions WHERE org_id='org'")!.quantity,1);
 subscriptionStatus='attention';await handleBillingEvent({id:'evt_failed',event:'invoice.payment_failed',data:{domain:'test',subscription:{subscription_code:'SUB_test'}}});assert.equal(one("SELECT status FROM subscriptions WHERE org_id='org'")!.status,'attention');assert.equal(one("SELECT plan FROM organizations WHERE id='org'")!.plan,'business');
 subscriptionStatus='cancelled';await handleBillingEvent({id:'evt_cancel',event:'subscription.disable',data:{domain:'test',subscription_code:'SUB_test'}});assert.equal(one("SELECT plan FROM organizations WHERE id='org'")!.plan,'free');
 await handleBillingEvent({id:'evt_old_payment_replayed',event:'charge.success',data:{domain:'test',reference}});assert.equal(one("SELECT plan FROM organizations WHERE id='org'")!.plan,'free','replaying an old payment cannot reactivate a cancelled subscription');
});
after(()=>{db.close();for(const suffix of ['','-wal','-shm'])try{unlinkSync(path+suffix);}catch{}});
