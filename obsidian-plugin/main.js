"use strict";
/*
 * e=digger Obsidian Plugin — pure CJS, no bundler, no npm deps.
 * Drop this file + manifest.json into:
 *   <vault>/.obsidian/plugins/edigger-sync/
 * Enable in: Settings → Community plugins → e=digger Sync.
 */

const obsidian = require("obsidian");

const DEFAULTS = {
  supabaseUrl: "",
  anonKey: "",
  email: "",
  password: "",
  folder: "e=digger",
  pollSeconds: 30,
  lastSyncIso: "1970-01-01T00:00:00Z",
  // session (managed automatically)
  accessToken: "",
  refreshToken: "",
  expiresAt: 0,
};

class EdiggerPlugin extends obsidian.Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new EdiggerSettingTab(this.app, this));

    this.addCommand({
      id: "edigger-sync-now",
      name: "e=digger: Sync now",
      callback: () => this.syncOnce().catch((e) => new obsidian.Notice("Sync 실패: " + e.message)),
    });
    this.addCommand({
      id: "edigger-reset-cursor",
      name: "e=digger: Re-sync everything (reset cursor)",
      callback: async () => {
        this.settings.lastSyncIso = "1970-01-01T00:00:00Z";
        await this.saveData(this.settings);
        new obsidian.Notice("커서 초기화. 전체 동기화 실행.");
        this.syncOnce().catch((e) => new obsidian.Notice("Sync 실패: " + e.message));
      },
    });

    this.app.workspace.onLayoutReady(() => this.start().catch(console.error));
  }

  onunload() { this.stopPolling(); }

  async saveSettings() { await this.saveData(this.settings); }

  async start() {
    if (!this.settings.supabaseUrl || !this.settings.anonKey) {
      new obsidian.Notice("e=digger: 설정에서 Supabase URL/anon key 를 입력하세요.");
      return;
    }
    try { await this.ensureSession(); }
    catch (e) { new obsidian.Notice("e=digger 로그인 실패: " + e.message); return; }
    await this.syncOnce();
    if (this.settings.pollSeconds > 0) this.startPolling();
  }

  startPolling() {
    this.stopPolling();
    this._timer = window.setInterval(
      () => this.syncOnce().catch(console.error),
      this.settings.pollSeconds * 1000,
    );
    this.registerInterval(this._timer);
  }
  stopPolling() {
    if (this._timer) { window.clearInterval(this._timer); this._timer = null; }
  }

  // ─── Auth ─────────────────────────────────────────────────────────────
  async ensureSession() {
    const now = Math.floor(Date.now() / 1000);
    if (this.settings.accessToken && this.settings.expiresAt > now + 60) return;
    if (this.settings.refreshToken) {
      try { return await this.refresh(); } catch { /* fall through */ }
    }
    if (!this.settings.email || !this.settings.password) {
      throw new Error("이메일/비밀번호가 없습니다.");
    }
    const res = await obsidian.requestUrl({
      url: `${this.settings.supabaseUrl}/auth/v1/token?grant_type=password`,
      method: "POST",
      headers: { apikey: this.settings.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: this.settings.email, password: this.settings.password }),
      throw: false,
    });
    if (res.status >= 400) throw new Error(`로그인 ${res.status}: ${res.text}`);
    const j = res.json;
    this.settings.accessToken = j.access_token;
    this.settings.refreshToken = j.refresh_token;
    this.settings.expiresAt = Math.floor(Date.now() / 1000) + (j.expires_in || 3600);
    await this.saveSettings();
  }

  async refresh() {
    const res = await obsidian.requestUrl({
      url: `${this.settings.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      method: "POST",
      headers: { apikey: this.settings.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: this.settings.refreshToken }),
      throw: false,
    });
    if (res.status >= 400) throw new Error(`refresh ${res.status}`);
    const j = res.json;
    this.settings.accessToken = j.access_token;
    this.settings.refreshToken = j.refresh_token;
    this.settings.expiresAt = Math.floor(Date.now() / 1000) + (j.expires_in || 3600);
    await this.saveSettings();
  }

  async restGet(path) {
    await this.ensureSession();
    const res = await obsidian.requestUrl({
      url: `${this.settings.supabaseUrl}/rest/v1/${path}`,
      method: "GET",
      headers: {
        apikey: this.settings.anonKey,
        Authorization: `Bearer ${this.settings.accessToken}`,
        Accept: "application/json",
      },
      throw: false,
    });
    if (res.status >= 400) throw new Error(`REST ${res.status}: ${res.text}`);
    return res.json;
  }

  // ─── Sync ─────────────────────────────────────────────────────────────
  async syncOnce() {
    if (!this.settings.supabaseUrl || !this.settings.anonKey) return;
    const sinceEnc = encodeURIComponent(this.settings.lastSyncIso);

    const clips = await this.restGet(
      `clippings?select=id,user_id,title,url,content,source,tags,memo,created_at,updated_at` +
      `&updated_at=gt.${sinceEnc}&order=updated_at.asc&limit=200`,
    );
    if (!clips || clips.length === 0) return;

    const idList = clips.map((c) => c.id).join(",");
    const analyses = await this.restGet(
      `analysis_results?select=clipping_id,keywords,category,related_clipping_ids,similarity_scores` +
      `&clipping_id=in.(${idList})`,
    );
    const aMap = new Map((analyses || []).map((a) => [a.clipping_id, a]));

    await this.ensureFolder(this.settings.folder);
    let newest = this.settings.lastSyncIso;
    for (const c of clips) {
      await this.writeClippingFile(c, aMap.get(c.id));
      if (c.updated_at > newest) newest = c.updated_at;
    }
    this.settings.lastSyncIso = newest;
    await this.saveSettings();
    new obsidian.Notice(`e=digger: ${clips.length}개 노트 동기화`);
  }

  async ensureFolder(folder) {
    const path = obsidian.normalizePath(folder);
    if (!this.app.vault.getAbstractFileByPath(path)) {
      try { await this.app.vault.createFolder(path); } catch (_) { /* exists */ }
    }
  }

  async writeClippingFile(c, a) {
    const folder = obsidian.normalizePath(this.settings.folder);
    const datePart = (c.created_at || "").slice(0, 10) || "undated";
    const safeTitle = (c.title || "Untitled")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, 80);
    const fileName = `${datePart}-${safeTitle || c.id.slice(0, 8)}.md`;
    const fullPath = obsidian.normalizePath(`${folder}/${fileName}`);

    const fm = this.buildFrontmatter(c, a);
    const body = this.buildBody(c, a);
    const md = `---\n${fm}\n---\n\n${body}\n`;

    const existing = this.app.vault.getAbstractFileByPath(fullPath);
    if (existing instanceof obsidian.TFile) {
      await this.app.vault.modify(existing, md);
    } else {
      await this.app.vault.create(fullPath, md);
    }
  }

  buildFrontmatter(c, a) {
    const kws = a && a.keywords ? Object.keys(a.keywords) : [];
    const related = (a && a.related_clipping_ids) || [];
    const tags = [].concat(c.tags || [], a && a.category ? [a.category] : []);
    const lines = [
      `id: ${c.id}`,
      `title: ${yamlString(c.title || "")}`,
      c.url ? `url: ${yamlString(c.url)}` : null,
      `source: ${c.source || "chrome"}`,
      `created: ${c.created_at}`,
      `updated: ${c.updated_at}`,
      a && a.category ? `category: ${yamlString(a.category)}` : null,
      tags.length ? `tags:\n${tags.map((t) => `  - ${yamlString(t)}`).join("\n")}` : null,
      kws.length ? `keywords:\n${kws.map((k) => `  - ${yamlString(k)}`).join("\n")}` : null,
      related.length ? `related:\n${related.map((r) => `  - ${r}`).join("\n")}` : null,
    ].filter(Boolean);
    return lines.join("\n");
  }

  buildBody(c, a) {
    const out = [];
    out.push(`# ${c.title || "Untitled"}\n`);
    if (c.url) out.push(`[원문 열기](${c.url})\n`);
    if (c.memo) out.push(`> ${c.memo}\n`);
    out.push("\n## 본문\n");
    out.push(c.content || "");
    if (a && a.keywords && Object.keys(a.keywords).length) {
      out.push("\n\n## 키워드 (빈도)\n");
      for (const [k, v] of Object.entries(a.keywords)) out.push(`- [[${k}]] · ${v}`);
    }
    if (a && a.related_clipping_ids && a.related_clipping_ids.length) {
      out.push("\n\n## 연관 노트\n");
      for (const rid of a.related_clipping_ids) out.push(`- [[${rid}]]`);
    }
    return out.join("\n");
  }
}

function yamlString(s) {
  return JSON.stringify(String(s));
}

// ─── Settings UI ────────────────────────────────────────────────────────
class EdiggerSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "e=digger Sync" });

    const text = (name, key, opts = {}) => {
      new obsidian.Setting(containerEl).setName(name).addText((t) => {
        if (opts.password) t.inputEl.type = "password";
        t.setValue(String(this.plugin.settings[key] ?? ""))
         .onChange(async (v) => {
           this.plugin.settings[key] = opts.number ? (parseInt(v, 10) || 0) : v.trim();
           await this.plugin.saveSettings();
         });
      });
    };

    text("Supabase URL", "supabaseUrl");
    text("anon key", "anonKey");
    text("Email", "email");
    text("Password", "password", { password: true });
    text("Vault folder", "folder");
    text("Poll seconds (0=수동만)", "pollSeconds", { number: true });

    new obsidian.Setting(containerEl).addButton((b) =>
      b.setButtonText("재연결 / Sync now").setCta().onClick(async () => {
        this.plugin.stopPolling();
        await this.plugin.start();
      }));
  }
}

module.exports = EdiggerPlugin;
