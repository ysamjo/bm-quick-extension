const OAUTH_STORE_KEY = 'ebay:oauth:refresh-token:v1';
const DEFAULT_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account';
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;

export async function handleEbayOAuth(request, url, env) {
  if (request.method !== 'GET') return text('Nur GET ist erlaubt.', 405);

  if (url.pathname === '/oauth/start') return startOAuth(env);
  if (url.pathname === '/oauth/callback') return finishOAuth(url, env);
  if (url.pathname === '/oauth/declined') {
    return htmlPage('eBay-Verbindung abgebrochen', 'Es wurden keine Zugangsdaten gespeichert.', 400);
  }
  return text('Nicht gefunden.', 404);
}

export async function getStoredEbayRefreshToken(env) {
  if (env.EBAY_REFRESH_TOKEN) return env.EBAY_REFRESH_TOKEN;
  if (!env.EBAY_OAUTH_STORE || !env.EBAY_OAUTH_ENCRYPTION_KEY) return '';

  const stored = await env.EBAY_OAUTH_STORE.get(OAUTH_STORE_KEY);
  if (!stored) return '';
  let envelope;
  try {
    envelope = JSON.parse(stored);
  } catch {
    throw new Error('Gespeicherter eBay-OAuth-Token ist beschädigt.');
  }
  return decryptToken(envelope, env.EBAY_OAUTH_ENCRYPTION_KEY);
}

async function startOAuth(env) {
  const missing = oauthConfigMissing(env);
  if (missing.length) return htmlPage('OAuth noch nicht bereit', `Worker-Konfiguration fehlt: ${missing.join(', ')}`, 503);
  if (await env.EBAY_OAUTH_STORE.get(OAUTH_STORE_KEY)) {
    return htmlPage('eBay bereits verbunden', 'Im Worker ist bereits ein Refresh-Token gespeichert.', 409);
  }

  const expiresAt = Date.now() + 10 * 60 * 1000;
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  const state = await createSignedState({ nonce, expiresAt }, env.EBAY_OAUTH_ENCRYPTION_KEY);
  const authorizeUrl = new URL('https://auth.ebay.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', env.EBAY_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', env.EBAY_RUNAME);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', env.EBAY_USER_SCOPES || DEFAULT_SCOPE);
  authorizeUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl.toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer'
    }
  });
}

async function finishOAuth(url, env) {
  const missing = oauthConfigMissing(env);
  if (missing.length) return htmlPage('OAuth noch nicht bereit', `Worker-Konfiguration fehlt: ${missing.join(', ')}`, 503);
  if (url.searchParams.get('error')) {
    return htmlPage('eBay-Verbindung abgebrochen', 'eBay hat keine Berechtigung erteilt.', 400);
  }

  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!code || code.length > 4096 || !(await verifySignedState(state, env.EBAY_OAUTH_ENCRYPTION_KEY))) {
    return htmlPage('Ungültige OAuth-Antwort', 'Die eBay-Antwort konnte nicht sicher bestätigt werden. Bitte den Vorgang neu starten.', 400);
  }
  if (await env.EBAY_OAUTH_STORE.get(OAUTH_STORE_KEY)) {
    return htmlPage('eBay bereits verbunden', 'Der vorhandene Refresh-Token wurde nicht überschrieben.', 409);
  }

  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.EBAY_RUNAME
  });
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const token = await readLimitedJson(response, MAX_TOKEN_RESPONSE_BYTES);
  if (!response.ok || !token.refresh_token) {
    console.error('eBay OAuth code exchange failed', { status: response.status, error: token.error || 'unknown' });
    return htmlPage('eBay-Verbindung fehlgeschlagen', 'Der Autorisierungscode konnte nicht gegen einen Refresh-Token getauscht werden.', 502);
  }

  const encrypted = await encryptToken(token.refresh_token, env.EBAY_OAUTH_ENCRYPTION_KEY);
  await env.EBAY_OAUTH_STORE.put(OAUTH_STORE_KEY, JSON.stringify({
    ...encrypted,
    createdAt: new Date().toISOString(),
    refreshTokenExpiresIn: Number(token.refresh_token_expires_in) || null,
    scope: token.scope || env.EBAY_USER_SCOPES || DEFAULT_SCOPE
  }));

  return htmlPage('eBay erfolgreich verbunden', 'Der Refresh-Token wurde verschlüsselt gespeichert. Dieses Fenster kann geschlossen werden.', 200);
}

function oauthConfigMissing(env) {
  return ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_RUNAME', 'EBAY_OAUTH_ENCRYPTION_KEY', 'EBAY_OAUTH_STORE']
    .filter(key => !env[key]);
}

async function createSignedState(payload, secret) {
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encoded, secret);
  return `${encoded}.${bytesToBase64Url(signature)}`;
}

async function verifySignedState(value, secret) {
  const [encoded, signatureText, extra] = String(value).split('.');
  if (!encoded || !signatureText || extra) return false;
  let supplied;
  let payload;
  try {
    supplied = base64UrlToBytes(signatureText);
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
  } catch {
    return false;
  }
  const expected = await hmac(encoded, secret);
  if (!constantTimeEqual(supplied, expected)) return false;
  return Number.isFinite(payload.expiresAt) && payload.expiresAt >= Date.now() && payload.expiresAt <= Date.now() + 11 * 60 * 1000;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', decodeEncryptionKey(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function encryptToken(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', decodeEncryptionKey(secret), 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { version: 1, iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)) };
}

async function decryptToken(envelope, secret) {
  if (envelope?.version !== 1 || !envelope.iv || !envelope.ciphertext) throw new Error('Unbekanntes eBay-OAuth-Speicherformat.');
  const key = await crypto.subtle.importKey('raw', decodeEncryptionKey(secret), 'AES-GCM', false, ['decrypt']);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv) },
      key,
      base64UrlToBytes(envelope.ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Gespeicherter eBay-OAuth-Token konnte nicht entschlüsselt werden.');
  }
}

function decodeEncryptionKey(secret) {
  const bytes = base64UrlToBytes(String(secret).replace(/\+/g, '-').replace(/\//g, '_'));
  if (bytes.byteLength !== 32) throw new Error('EBAY_OAUTH_ENCRYPTION_KEY muss 32 Byte Base64 enthalten.');
  return bytes;
}

async function readLimitedJson(response, maxBytes) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('response too large');
      throw new Error('eBay-OAuth-Antwort ist zu groß.');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function constantTimeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function htmlPage(title, message, status) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${safeTitle}</title><style>body{font:18px system-ui;max-width:680px;margin:12vh auto;padding:24px;color:#20242b}main{border:1px solid #dfe3ea;border-radius:14px;padding:28px}h1{font-size:1.6rem}</style><main><h1>${safeTitle}</h1><p>${safeMessage}</p></main>`, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function text(body, status) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
