// Service worker (MV3). Handles context menu, page-meta capture, and Supabase POST.

import { getCreds, signInIfNeeded, sendClipping } from "./lib/supabase-client.js";

const MENU_ID_SELECTION = "edigger-clip-selection";
const MENU_ID_PAGE = "edigger-clip-page";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID_SELECTION,
    title: "e=digger: 선택 텍스트 저장",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: MENU_ID_PAGE,
    title: "e=digger: 전체 페이지 저장",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === MENU_ID_SELECTION) {
      await clip({
        title: tab?.title ?? "Untitled",
        url: tab?.url ?? "",
        content: info.selectionText ?? "",
        source: "chrome",
      });
    } else if (info.menuItemId === MENU_ID_PAGE) {
      const meta = await captureMeta(tab);
      await clip({ ...meta, source: "chrome" });
    }
  } catch (err) {
    notify("저장 실패", String(err?.message ?? err));
  }
});

// popup.js sends { type: 'clip', payload }
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "clip") {
    clip(msg.payload).then(
      (r) => sendResponse({ ok: true, id: r?.id }),
      (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }),
    );
    return true; // async
  }
  if (msg?.type === "capturePage") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      const meta = await captureMeta(tab);
      sendResponse(meta);
    });
    return true;
  }
});

async function clip(payload) {
  const creds = await getCreds();
  if (!creds.url || !creds.anonKey) throw new Error("옵션에서 Supabase 정보를 먼저 설정하세요.");
  await signInIfNeeded(creds);
  const inserted = await sendClipping(creds, payload);
  notify("저장 완료", payload.title?.slice(0, 60) ?? "");
  return inserted;
}

async function captureMeta(tab) {
  if (!tab?.id) return { title: tab?.title ?? "Untitled", url: tab?.url ?? "", content: "" };
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = (window.getSelection()?.toString() ?? "").trim();
        const meta = (name) =>
          document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content ?? "";
        return {
          title: document.title,
          url: location.href,
          content: sel || meta("description") || meta("og:description") || "",
        };
      },
    });
    return result;
  } catch {
    return { title: tab.title ?? "Untitled", url: tab.url ?? "", content: "" };
  }
}

function notify(title, message) {
  // chrome.notifications requires an iconUrl. We use a 1x1 transparent PNG data URL
  // so the extension works without bundling icon files.
  const blank = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: blank,
      title: `e=digger · ${title}`,
      message,
    });
  } catch { /* ignore in dev */ }
}
