import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { md5Hex, constantTimeEqual, verifyLightspeedSignature } from './lightspeed-verify.ts'

Deno.test('md5Hex — known vector', () => {
  // MD5('abc') = 900150983cd24fb0d6963f7d28e17f72
  assertEquals(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72')
})

Deno.test('constantTimeEqual — gelijke strings', () => {
  assertEquals(constantTimeEqual('abcdef', 'abcdef'), true)
})

Deno.test('constantTimeEqual — 1 char verschil', () => {
  assertEquals(constantTimeEqual('abcdef', 'abcdeg'), false)
})

Deno.test('constantTimeEqual — lengte verschilt', () => {
  assertEquals(constantTimeEqual('abc', 'abcd'), false)
})

Deno.test('verifyLightspeedSignature — geldige signature', () => {
  const secret = 'mysecret'
  const payload = '{"order":{"id":123}}'
  const signature = md5Hex(payload + secret)
  assertEquals(verifyLightspeedSignature(payload, signature, secret), true)
})

Deno.test('verifyLightspeedSignature — verkeerde signature', () => {
  const secret = 'mysecret'
  const payload = '{"order":{"id":123}}'
  const signature = md5Hex('different' + secret)
  assertEquals(verifyLightspeedSignature(payload, signature, secret), false)
})

Deno.test('verifyLightspeedSignature — ontbrekende header', () => {
  assertEquals(verifyLightspeedSignature('{}', null, 'secret'), false)
})

Deno.test('verifyLightspeedSignature — case-insensitive hex', () => {
  const secret = 'mysecret'
  const payload = '{"a":1}'
  const upperSig = md5Hex(payload + secret).toUpperCase()
  assertEquals(verifyLightspeedSignature(payload, upperSig, secret), true)
})
