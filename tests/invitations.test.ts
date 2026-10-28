import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationUrl} from '../lib/invitations';
const token='01234567-89ab-cdef-0123-456789abcdef';
const env={NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://timecard.example.com'};
test('production invitation links use Render HTTPS with missing or stale localhost APP_URL',()=>{
 for(const APP_URL of [undefined,'http://localhost:3000']){
  const url=new URL(invitationUrl(token,{...env,APP_URL}));assert.equal(url.origin,env.RENDER_EXTERNAL_URL);assert.equal(url.searchParams.get('invite'),token);
 }
});
test('production invitations fail before generating an unusable localhost link',()=>{
 assert.throws(()=>invitationUrl(token,{NODE_ENV:'production',APP_URL:'http://localhost:3000'}),/APP_URL/);
});
