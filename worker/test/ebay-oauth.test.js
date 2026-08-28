import test from 'node:test';
import assert from 'node:assert/strict';
import { getStoredEbayRefreshToken, handleEbayOAuth } from '../ebay-oauth.js';

function createEnv() {
  const values = new Map();
  return {
    EBAY_CLIENT_ID: 'client-id',
    EBAY_CLIENT_SECRET: 'client-secret',
    EBAY_RUNAME: 'example-runame',
    EBAY_USER_SCOPES: 'https://api.ebay.com/oauth/api_scope/sell.inventory',
    EBAY_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    EBAY_OAUTH_STORE: {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value) { values.set(key, value); }
    },
    values
  };
}

test('OAuth start redirects to eBay with signed state and inventory scope', async () => {
  const env = createEnv();
  const response = await handleEbayOAuth(
    new Request('https://worker.example/oauth/start'),
    new URL('https://worker.example/oauth/start'),
    env
  );
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://auth.ebay.com');
  assert.equal(location.searchParams.get('client_id'), 'client-id');
  assert.equal(location.searchParams.get('redirect_uri'), 'example-runame');
  assert.equal(location.searchParams.get('scope'), env.EBAY_USER_SCOPES);
  assert.match(location.searchParams.get('state'), /^[^.]+\.[^.]+$/);
});

test('OAuth callback stores refresh token encrypted and never renders it', async () => {
  const env = createEnv();
  const start = await handleEbayOAuth(
    new Request('https://worker.example/oauth/start'),
    new URL('https://worker.example/oauth/start'),
    env
  );
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const refreshToken = 'refresh-token-must-not-appear-in-storage-or-html';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    access_token: 'short-lived-access-token',
    expires_in: 7200,
    refresh_token: refreshToken,
    refresh_token_expires_in: 47304000,
    token_type: 'User Access Token'
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const callbackUrl = new URL('https://worker.example/oauth/callback');
    callbackUrl.searchParams.set('code', 'authorization-code');
    callbackUrl.searchParams.set('state', state);
    const response = await handleEbayOAuth(new Request(callbackUrl), callbackUrl, env);
    assert.equal(response.status, 200);
    assert.equal((await response.text()).includes(refreshToken), false);
    const stored = env.values.get('ebay:oauth:refresh-token:v1');
    assert.ok(stored);
    assert.equal(stored.includes(refreshToken), false);
    assert.equal(await getStoredEbayRefreshToken(env), refreshToken);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OAuth callback rejects a manipulated state before token exchange', async () => {
  const env = createEnv();
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}');
  };
  try {
    const callbackUrl = new URL('https://worker.example/oauth/callback?code=test&state=manipulated');
    const response = await handleEbayOAuth(new Request(callbackUrl), callbackUrl, env);
    assert.equal(response.status, 400);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
