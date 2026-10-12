import { describe, expect, it } from "vitest";
import {
  API_RESOURCE,
  buildAuthorizeUrl,
  type ChatgptAuth,
  ChatgptAuthError,
  completeSignIn,
  DYNAMIC_CLIENT_ID,
  getAccessToken,
  isSignedIn,
  newChatgptAuth,
  newPendingSignIn,
  PENDING_TTL_MS,
  pkceChallenge,
  PLAN_SCOPE,
  REDIRECT_URI,
  REVOKE_URL,
  SCOPES,
  signOut,
  TOKEN_URL,
} from "./chatgpt-auth";

interface Call {
  url: string;
  form: URLSearchParams;
}

function fakeFetch(status: number, json: unknown, calls: Call[]): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      form: new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      ),
    });
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const idToken = (claims: Record<string, unknown>) => `h.${b64url(claims)}.s`;

const NOW = 1_800_000_000_000;

const signedIn = (over: Partial<ChatgptAuth> = {}): ChatgptAuth => ({
  hostId: "host-123456",
  clientId: "oaiapp_abc",
  accessToken: "at-1",
  refreshToken: "rt-1",
  expiresAt: NOW + 3600_000,
  scopes: SCOPES.split(" "),
  email: "me@example.com",
  ...over,
});

describe("PKCE", () => {
  it("matches the RFC 7636 S256 example", async () => {
    expect(
      await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes fresh unguessable state, nonce and verifier", () => {
    const a = newPendingSignIn(NOW);
    const b = newPendingSignIn(NOW);
    expect(a.state).not.toBe(b.state);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("buildAuthorizeUrl", () => {
  it("registers dynamically the first time, with PKCE, resource and loopback redirect", async () => {
    const pending = newPendingSignIn(NOW);
    const url = new URL(await buildAuthorizeUrl(newChatgptAuth(), pending));
    const p = url.searchParams;
    expect(url.origin).toBe("https://auth.openai.com");
    expect(p.get("client_id")).toBe(DYNAMIC_CLIENT_ID);
    expect(p.get("agent_name_hint")).toBeTruthy();
    expect(p.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(REDIRECT_URI).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(p.get("scope")).toContain(PLAN_SCOPE);
    expect(p.get("resource")).toBe(API_RESOURCE);
    expect(p.get("state")).toBe(pending.state);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(await pkceChallenge(pending.verifier));
    expect(p.get("code_verifier")).toBeNull();
  });

  it("reuses the issued client id and hints the account on later sign-ins", async () => {
    const p = new URL(
      await buildAuthorizeUrl(signedIn(), newPendingSignIn(NOW)),
    ).searchParams;
    expect(p.get("client_id")).toBe("oaiapp_abc");
    expect(p.get("agent_name_hint")).toBeNull();
    expect(p.get("login_hint")).toBe("me@example.com");
    expect(p.get("ext_agent_host_id")).toBe("host-123456");
  });
});

describe("completeSignIn", () => {
  const pending = {
    state: "st",
    nonce: "n",
    verifier: "v".repeat(50),
    createdAt: NOW,
  };
  const tokens = {
    access_token: "at",
    refresh_token: "rt",
    id_token: idToken({ email: "me@example.com", aud: "oaiapp_new" }),
    expires_in: 600,
    scope: SCOPES,
  };

  it("exchanges the code with the verifier and stores tokens, client id and email", async () => {
    const calls: Call[] = [];
    const auth = await completeSignIn(
      newChatgptAuth(),
      pending,
      { code: "c0de", state: "st" },
      fakeFetch(200, tokens, calls),
      NOW,
    );
    expect(calls[0]!.url).toBe(TOKEN_URL);
    expect(calls[0]!.form.get("grant_type")).toBe("authorization_code");
    expect(calls[0]!.form.get("code_verifier")).toBe(pending.verifier);
    expect(calls[0]!.form.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(auth).toMatchObject({
      accessToken: "at",
      refreshToken: "rt",
      clientId: "oaiapp_new",
      email: "me@example.com",
      expiresAt: NOW + 600_000,
    });
    expect(isSignedIn(auth)).toBe(true);
  });

  it("rejects mismatched state, expired attempts, cancellations and missing plan scope", async () => {
    const run = (
      cb: { code?: string; state?: string; error?: string },
      p: typeof pending | null = pending,
      json: unknown = tokens,
    ) =>
      completeSignIn(
        newChatgptAuth(),
        p ?? undefined,
        cb,
        fakeFetch(200, json, []),
        NOW,
      );
    await expect(run({ code: "c", state: "evil" })).rejects.toThrow(
      /state mismatch/,
    );
    await expect(run({ code: "c", state: "st" }, null)).rejects.toThrow(
      /expired/,
    );
    await expect(
      run(
        { code: "c", state: "st" },
        { ...pending, createdAt: NOW - PENDING_TTL_MS - 1 },
      ),
    ).rejects.toThrow(/expired/);
    await expect(run({ error: "access_denied" })).rejects.toThrow(/cancelled/);
    await expect(
      run({ code: "c", state: "st" }, pending, {
        ...tokens,
        scope: "openid email",
      }),
    ).rejects.toThrow(/didn't allow/);
  });

  it("surfaces token endpoint errors", async () => {
    await expect(
      completeSignIn(
        newChatgptAuth(),
        pending,
        { code: "c", state: "st" },
        fakeFetch(
          400,
          { error: "invalid_grant", error_description: "Code expired" },
          [],
        ),
        NOW,
      ),
    ).rejects.toThrow(/Code expired/);
  });
});

describe("getAccessToken", () => {
  it("returns a still-valid token without calling OpenAI", async () => {
    const calls: Call[] = [];
    expect(
      await getAccessToken(
        signedIn(),
        () => Promise.resolve(),
        fakeFetch(200, {}, calls),
        NOW,
      ),
    ).toBe("at-1");
    expect(calls).toHaveLength(0);
  });

  it("refreshes near expiry, saves the rotated refresh token first", async () => {
    const calls: Call[] = [];
    const saved: ChatgptAuth[] = [];
    const token = await getAccessToken(
      signedIn({ expiresAt: NOW + 30_000 }),
      async (a) => {
        saved.push(a);
      },
      fakeFetch(
        200,
        { access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 },
        calls,
      ),
      NOW,
    );
    expect(token).toBe("at-2");
    expect(calls[0]!.form.get("grant_type")).toBe("refresh_token");
    expect(calls[0]!.form.get("refresh_token")).toBe("rt-1");
    expect(calls[0]!.form.get("client_id")).toBe("oaiapp_abc");
    expect(saved[0]).toMatchObject({
      accessToken: "at-2",
      refreshToken: "rt-2",
    });
  });

  it("treats network and server errors as retryable, not signed out", async () => {
    const offline: typeof fetch = () => Promise.reject(new Error("offline"));
    for (const f of [offline, fakeFetch(503, {}, [])]) {
      const err = await getAccessToken(
        signedIn({ expiresAt: NOW }),
        () => Promise.resolve(),
        f,
        NOW,
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ChatgptAuthError);
      expect((err as ChatgptAuthError).signedOut).toBe(false);
      expect(String(err)).toMatch(/try again/);
    }
  });

  it("asks to sign in again when refresh fails or nobody is signed in", async () => {
    await expect(
      getAccessToken(
        signedIn({ expiresAt: NOW }),
        () => Promise.resolve(),
        fakeFetch(400, { error: "invalid_grant" }, []),
        NOW,
      ),
    ).rejects.toThrow(ChatgptAuthError);
    await expect(
      getAccessToken(newChatgptAuth(), () => Promise.resolve()),
    ).rejects.toThrow(/Sign in with ChatGPT/);
  });
});

describe("signOut", () => {
  it("revokes the refresh token and keeps only the registration", async () => {
    const calls: Call[] = [];
    const out = await signOut(signedIn(), fakeFetch(200, {}, calls));
    expect(calls[0]!.url).toBe(REVOKE_URL);
    expect(calls[0]!.form.get("token")).toBe("rt-1");
    expect(out).toEqual({
      clientId: "oaiapp_abc",
      hostId: "host-123456",
      scopes: [],
    });
    expect(isSignedIn(out)).toBe(false);
  });

  it("still signs out locally when OpenAI can't be reached", async () => {
    const offline: typeof fetch = () => Promise.reject(new Error("offline"));
    expect(isSignedIn(await signOut(signedIn(), offline))).toBe(false);
  });
});
