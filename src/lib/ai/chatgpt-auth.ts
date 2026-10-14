/**
 * "Sign in with ChatGPT" (OpenAI, launched Sept 2026): OAuth 2.0 authorization code + PKCE for a
 * local client, so icon generation is billed to the user's ChatGPT plan instead of an API key.
 * Docs: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 *
 * The redirect must be an HTTP loopback URI on 127.0.0.1; the app's local server listens there
 * only to forward the code to the app. Token exchange and refresh run in the browser (the
 * token endpoint allows cross-origin requests).
 */
import { z } from "zod";

export const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
export const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const REVOKE_URL = "https://auth.openai.com/api/accounts/oauth/revoke";
export const API_RESOURCE = "https://api.openai.com/v1";
/** Loopback callback served by scripts/serve.mjs (only the port may vary; never "localhost"). */
export const CALLBACK_PORT = 1455;
export const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`;
export const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/** Scope that allows inference billed to the ChatGPT plan; must be granted. */
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const APP_NAME = "Inkless";

export const chatgptAuthSchema = z.object({
  /** Issued client id (oaiapp_…) after first registration; reused for later sign-ins. */
  clientId: z.string().max(200).optional(),
  /** Stable per-installation identifier (ext_agent_host_id). */
  hostId: z.string().min(8).max(100),
  accessToken: z.string().max(20_000).optional(),
  refreshToken: z.string().max(20_000).optional(),
  idToken: z.string().max(20_000).optional(),
  /** ms since epoch. */
  expiresAt: z.number().optional(),
  scopes: z.array(z.string()).default([]),
  email: z.string().max(320).optional(),
});
export type ChatgptAuth = z.infer<typeof chatgptAuthSchema>;

export const pendingSignInSchema = z.object({
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  createdAt: z.number(),
});
export type PendingSignIn = z.infer<typeof pendingSignInSchema>;

export const PENDING_TTL_MS = 10 * 60_000;

export class ChatgptAuthError extends Error {
  /** True when OpenAI rejected the sign-in itself (not a network or server hiccup). */
  constructor(
    message: string,
    readonly signedOut = false,
  ) {
    super(message);
  }
}

const base64url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge: base64url(SHA-256(verifier)), no padding. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

export function newPendingSignIn(now = Date.now()): PendingSignIn {
  return {
    state: randomToken(16),
    nonce: randomToken(16),
    verifier: randomToken(48),
    createdAt: now,
  };
}

export async function buildAuthorizeUrl(
  auth: ChatgptAuth,
  pending: PendingSignIn,
): Promise<string> {
  const firstTime = !auth.clientId;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: auth.clientId ?? DYNAMIC_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    resource: API_RESOURCE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await pkceChallenge(pending.verifier),
    code_challenge_method: "S256",
    ext_agent_host_id: auth.hostId,
  });
  if (firstTime) params.set("agent_name_hint", APP_NAME);
  if (auth.idToken) params.set("id_token_hint", auth.idToken);
  if (auth.email) params.set("login_hint", auth.email);
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  client_id?: string;
  error?: string;
  error_description?: string;
}

/** Claims from an ID token payload (not verified here; only used for display and client id). */
export function decodeIdToken(
  idToken: string | undefined,
): Record<string, unknown> {
  try {
    const payload = idToken?.split(".")[1];
    if (!payload) return {};
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function applyTokens(
  auth: ChatgptAuth,
  t: TokenResponse,
  now: number,
  clientIdUsed: string,
): ChatgptAuth {
  if (!t.access_token)
    throw new ChatgptAuthError(
      t.error_description ?? t.error ?? "Sign-in failed.",
    );
  const claims = decodeIdToken(t.id_token ?? auth.idToken);
  const issued =
    t.client_id ??
    (typeof claims.client_id === "string" ? claims.client_id : undefined) ??
    (typeof claims.aud === "string" && claims.aud !== DYNAMIC_CLIENT_ID
      ? claims.aud
      : undefined) ??
    (clientIdUsed !== DYNAMIC_CLIENT_ID ? clientIdUsed : undefined);
  const scopes = t.scope ? t.scope.split(/\s+/).filter(Boolean) : auth.scopes;
  return {
    ...auth,
    clientId: issued ?? auth.clientId,
    accessToken: t.access_token,
    // Refresh tokens rotate: always replace together with the access token.
    refreshToken: t.refresh_token ?? auth.refreshToken,
    idToken: t.id_token ?? auth.idToken,
    expiresAt: now + (t.expires_in ?? 3600) * 1000,
    scopes,
    email: typeof claims.email === "string" ? claims.email : auth.email,
  };
}

async function postForm(
  fetchImpl: typeof fetch,
  url: string,
  form: Record<string, string>,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new ChatgptAuthError(
      "Couldn't reach OpenAI to sign in. Are you online?",
    );
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    throw new ChatgptAuthError(
      body.error_description ??
        body.error ??
        `OpenAI sign-in error ${res.status}.`,
      // 4xx (invalid_grant etc.) means the grant is dead; 5xx is worth retrying.
      res.status >= 400 && res.status < 500,
    );
  }
  return body;
}

/**
 * Validate the callback and exchange the code for tokens. A first sign-in registers this app
 * and the callback carries the issued `client_id` (oaiapp_…), which the exchange must use;
 * `saveClient` persists it before the exchange so a failed exchange can retry with it.
 */
export async function completeSignIn(
  auth: ChatgptAuth,
  pending: PendingSignIn | undefined,
  callback: {
    code?: string | null;
    state?: string | null;
    clientId?: string | null;
    error?: string | null;
    errorDescription?: string | null;
  },
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
  saveClient: (a: ChatgptAuth) => Promise<void> = () => Promise.resolve(),
): Promise<ChatgptAuth> {
  if (callback.error === "access_denied")
    throw new ChatgptAuthError("Sign-in was cancelled.");
  if (callback.error)
    throw new ChatgptAuthError(
      `Sign-in failed: ${callback.errorDescription ?? callback.error}`,
    );
  if (!pending || now - pending.createdAt > PENDING_TTL_MS) {
    throw new ChatgptAuthError(
      "This sign-in has expired. Start again from AI settings.",
    );
  }
  if (!callback.state || callback.state !== pending.state) {
    throw new ChatgptAuthError(
      "Sign-in could not be verified (state mismatch). Start again.",
    );
  }
  if (!callback.code) throw new ChatgptAuthError("Sign-in returned no code.");
  // Reauthorization may omit client_id; then the one saved from registration applies.
  const fromCallback = callback.clientId?.trim();
  const issued =
    fromCallback !== undefined && fromCallback !== ""
      ? fromCallback
      : auth.clientId;
  if (!issued || issued === DYNAMIC_CLIENT_ID || issued.length > 200) {
    throw new ChatgptAuthError(
      "OpenAI didn't return this app's client ID. Start the sign-in again.",
    );
  }
  if (issued !== auth.clientId) {
    auth = { ...auth, clientId: issued };
    await saveClient(auth);
  }
  const clientId = issued;
  const t = await postForm(fetchImpl, TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: clientId,
    code: callback.code,
    code_verifier: pending.verifier,
    redirect_uri: REDIRECT_URI,
    resource: API_RESOURCE,
  });
  const next = applyTokens(auth, t, now, clientId);
  if (!next.scopes.includes(PLAN_SCOPE)) {
    throw new ChatgptAuthError(
      "You signed in but didn't allow using your ChatGPT plan, so icons can't be generated this way.",
    );
  }
  return next;
}

export function isSignedIn(auth: ChatgptAuth | undefined): boolean {
  return !!auth?.refreshToken && !!auth.scopes.includes(PLAN_SCOPE);
}

/**
 * A valid access token, refreshing it (and rotating the refresh token) when it expires within a
 * minute. `save` persists the new tokens before they are used.
 */
export async function getAccessToken(
  auth: ChatgptAuth,
  save: (a: ChatgptAuth) => Promise<void>,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<string> {
  if (!isSignedIn(auth))
    throw new ChatgptAuthError("Sign in with ChatGPT first (AI settings).");
  if (auth.accessToken && auth.expiresAt && auth.expiresAt - now > 60_000)
    return auth.accessToken;
  const clientId = auth.clientId ?? DYNAMIC_CLIENT_ID;
  let t: TokenResponse;
  try {
    t = await postForm(fetchImpl, TOKEN_URL, {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: auth.refreshToken!,
      resource: API_RESOURCE,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (e instanceof ChatgptAuthError && e.signedOut) {
      throw new ChatgptAuthError(
        `Your ChatGPT sign-in has expired; sign in again in AI settings. (${detail})`,
        true,
      );
    }
    throw new ChatgptAuthError(
      `Couldn't refresh your ChatGPT sign-in right now; try again. (${detail})`,
    );
  }
  const next = applyTokens(auth, t, now, clientId);
  await save(next);
  return next.accessToken!;
}

/** Revoke the refresh token at OpenAI (best effort) and return the cleared record. */
export async function signOut(
  auth: ChatgptAuth,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatgptAuth> {
  if (auth.refreshToken) {
    await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: auth.refreshToken,
        token_type_hint: "refresh_token",
        client_id: auth.clientId ?? DYNAMIC_CLIENT_ID,
      }).toString(),
    }).catch(() => undefined);
  }
  // Keep the client id and host id so the next sign-in reuses the registration.
  return { clientId: auth.clientId, hostId: auth.hostId, scopes: [] };
}

export function newChatgptAuth(): ChatgptAuth {
  // OpenAI expects a URN UUID (e.g. "urn:uuid:…"), stable per installation.
  return { hostId: `urn:uuid:${crypto.randomUUID()}`, scopes: [] };
}
