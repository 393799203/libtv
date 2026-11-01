import test from 'node:test';
import assert from 'node:assert/strict';
import { captureReferralCode, savedReferralCode, clearReferralCode, referralLink } from '../src/utils/referral.ts';

test('invitation links normalize, persist across navigation and clear after authentication', () => {
  const values = new Map<string,string>();
  Object.defineProperty(globalThis,'sessionStorage',{ configurable:true,value:{
    getItem:(key:string)=>values.get(key)||null,
    setItem:(key:string,value:string)=>values.set(key,value),
    removeItem:(key:string)=>values.delete(key),
  } });
  assert.equal(captureReferralCode('?ref=1234567890abcdef'),'1234567890ABCDEF');
  assert.equal(captureReferralCode('?source=wasu'),'');
  assert.equal(savedReferralCode(),'1234567890ABCDEF');
  assert.equal(captureReferralCode('?ref=not-a-valid-code'),'');
  assert.equal(referralLink('1234567890ABCDEF','https://example.test'),'https://example.test/?ref=1234567890ABCDEF');
  clearReferralCode();
  assert.equal(savedReferralCode(),'');
});
