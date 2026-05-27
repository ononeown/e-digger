import { getCreds } from "./lib/supabase-client.js";

const $ = (id) => document.getElementById(id);

async function init() {
  const creds = await getCreds();
  $("status").textContent = creds.url ? (creds.email || "logged-in?") : "옵션 설정 필요";

  // pre-fill current page
  chrome.runtime.sendMessage({ type: "capturePage" }, (meta) => {
    if (!meta) return;
    $("title").value = meta.title ?? "";
    $("url").value = meta.url ?? "";
    $("content").value = meta.content ?? "";
  });
}

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("save").addEventListener("click", async () => {
  const msg = $("msg");
  msg.className = "msg";
  msg.textContent = "저장 중…";
  $("save").disabled = true;

  const tags = $("tags").value.split(",").map((s) => s.trim()).filter(Boolean);
  const payload = {
    title: $("title").value.trim() || "Untitled",
    url: $("url").value.trim(),
    content: $("content").value,
    tags,
    memo: $("memo").value.trim(),
  };

  chrome.runtime.sendMessage({ type: "clip", payload }, (res) => {
    $("save").disabled = false;
    if (res?.ok) {
      msg.className = "msg ok";
      msg.textContent = "저장 완료";
      setTimeout(() => window.close(), 600);
    } else {
      msg.className = "msg err";
      msg.textContent = res?.error ?? "알 수 없는 오류";
    }
  });
});

init();
