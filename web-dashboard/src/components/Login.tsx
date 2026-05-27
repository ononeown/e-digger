import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const fn = mode === "signin"
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    setBusy(false);
    if (error) setMsg(error.message);
    else if (mode === "signup") setMsg("확인 메일을 보냈습니다. 메일 확인 후 로그인하세요.");
  }

  return (
    <div className="login">
      <h2 style={{ marginTop: 0 }}>e=digger</h2>
      <form onSubmit={submit}>
        <label>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" className="primary" disabled={busy}>
            {mode === "signin" ? "로그인" : "가입"}
          </button>
          <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "가입하기" : "로그인으로"}
          </button>
        </div>
        {msg && <div style={{ marginTop: 10, color: "#f87171" }}>{msg}</div>}
      </form>
    </div>
  );
}
