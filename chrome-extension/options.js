import { getCreds, setCreds, passwordLogin, getUser } from "./lib/supabase-client.js";

const $ = (id) => document.getElementById(id);
const FIELDS = ["url","anonKey","email","password","accessToken","refreshToken"];

async function load() {
  const c = await getCreds();
  for (const f of FIELDS) $(f).value = c[f] ?? "";
}

$("save").addEventListener("click", async () => {
  const patch = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  // If user supplied explicit tokens, set a far-future expiry so the client uses them.
  if (patch.accessToken && !patch.password) {
    patch.expiresAt = Math.floor(Date.now() / 1000) + 3600;
  }
  await setCreds(patch);
  $("msg").className = "msg ok";
  $("msg").textContent = "저장됨";
});

$("login").addEventListener("click", async () => {
  $("msg").className = "msg";
  $("msg").textContent = "로그인 시도 중…";
  try {
    const patch = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
    await setCreds(patch);
    const creds = await passwordLogin(await getCreds());
    const user = await getUser(creds);
    $("msg").className = "msg ok";
    $("msg").textContent = `로그인 성공: ${user.email ?? user.id}`;
  } catch (e) {
    $("msg").className = "msg err";
    $("msg").textContent = e.message;
  }
});

load();
