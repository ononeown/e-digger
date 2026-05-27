// Minimal Supabase REST client for MV3 service worker.
// Avoids bundling supabase-js to keep extension small and dependency-free.

const STORAGE_KEY = "edigger.creds.v1";

export async function getCreds() {
  const { [STORAGE_KEY]: c } = await chrome.storage.local.get(STORAGE_KEY);
  return c ?? { url: "", anonKey: "", email: "", password: "", accessToken: "", refreshToken: "", expiresAt: 0 };
}

export async function setCreds(patch) {
  const cur = await getCreds();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function clearSession() {
  await setCreds({ accessToken: "", refreshToken: "", expiresAt: 0 });
}

// Ensures we have a fresh access_token. Logs in with email/password or refreshes as needed.
export async function signInIfNeeded(creds) {
  const now = Math.floor(Date.now() / 1000);
  if (creds.accessToken && creds.expiresAt > now + 60) return creds;
  if (creds.refreshToken) {
    try { return await refresh(creds); } catch { /* fall through */ }
  }
  if (creds.email && creds.password) return await passwordLogin(creds);
  throw new Error("로그인이 필요합니다. 옵션 페이지에서 이메일/비밀번호를 입력하거나 토큰을 붙여넣으세요.");
}

export async function passwordLogin(creds) {
  const res = await fetch(`${creds.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: creds.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  if (!res.ok) throw new Error(`로그인 실패: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return await setCreds({
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
  });
}

async function refresh(creds) {
  const res = await fetch(`${creds.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: creds.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: creds.refreshToken }),
  });
  if (!res.ok) throw new Error(`세션 갱신 실패: ${res.status}`);
  const j = await res.json();
  return await setCreds({
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
  });
}

export async function getUser(creds) {
  const res = await fetch(`${creds.url}/auth/v1/user`, {
    headers: { apikey: creds.anonKey, Authorization: `Bearer ${creds.accessToken}` },
  });
  if (!res.ok) throw new Error(`사용자 조회 실패: ${res.status}`);
  return await res.json();
}

export async function sendClipping(creds, payload) {
  const user = await getUser(creds);
  const row = {
    user_id: user.id,
    title: payload.title || "Untitled",
    url: payload.url || null,
    content: payload.content || "",
    raw_html: payload.raw_html || null,
    source: payload.source || "chrome",
    tags: payload.tags ?? [],
    memo: payload.memo || null,
  };
  const res = await fetch(`${creds.url}/rest/v1/clippings`, {
    method: "POST",
    headers: {
      apikey: creds.anonKey,
      Authorization: `Bearer ${creds.accessToken}`,
      "content-type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`저장 실패: ${res.status} ${await res.text()}`);
  const [inserted] = await res.json();
  return inserted;
}
