import {
  App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, requestUrl,
} from "obsidian";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

interface Settings {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
  folder: string;            // vault-relative folder for generated notes
  pollSeconds: number;       // 0 = realtime only
  useRealtime: boolean;
  lastSyncIso: string;       // for incremental polling
}

const DEFAULTS: Settings = {
  supabaseUrl: "",
  anonKey: "",
  email: "",
  password: "",
  folder: "e=digger",
  pollSeconds: 30,
  useRealtime: true,
  lastSyncIso: "1970-01-01T00:00:00Z",
};

type ClippingRow = {
  id: string; user_id: string; title: string; url: string | null;
  content: string | null; source: string | null; tags: string[] | null;
  memo: string | null; created_at: string; updated_at: string;
};
type AnalysisRow = {
  clipping_id: string;
  keywords: Record<string, number> | null;
  tfidf: Record<string, number> | null;
  category: string | null;
  related_clipping_ids: string[] | null;
};

export default class EdiggerPlugin extends Plugin {
  settings: Settings = DEFAULTS;
  client: SupabaseClient | null = null;
  pollTimer: number | null = null;
  realtimeChan: ReturnType<SupabaseClient["channel"]> | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new EdiggerSettingTab(this.app, this));

    this.addCommand({
      id: "edigger-sync-now",
      name: "e=digger: Sync now",
      callback: () => this.syncOnce().catch((e) => new Notice("Sync 실패: " + e.message)),
    });

    this.addCommand({
      id: "edigger-reset-cursor",
      name: "e=digger: Re-sync everything (reset cursor)",
      callback: async () => {
        this.settings.lastSyncIso = "1970-01-01T00:00:00Z";
        await this.saveSettings();
        new Notice("커서 초기화. 전체 동기화를 실행합니다.");
        this.syncOnce().catch((e) => new Notice("Sync 실패: " + e.message));
      },
    });

    this.app.workspace.onLayoutReady(() => this.start().catch(console.error));
  }

  onunload() {
    this.stopPolling();
    this.stopRealtime();
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  async start() {
    if (!this.settings.supabaseUrl || !this.settings.anonKey) {
      new Notice("e=digger: 설정에서 Supabase URL/anon key 를 입력하세요.");
      return;
    }
    this.client = createClient(this.settings.supabaseUrl, this.settings.anonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    if (this.settings.email && this.settings.password) {
      const { error } = await this.client.auth.signInWithPassword({
        email: this.settings.email, password: this.settings.password,
      });
      if (error) { new Notice("e=digger 로그인 실패: " + error.message); return; }
    }

    await this.syncOnce();
    if (this.settings.useRealtime) this.startRealtime();
    if (this.settings.pollSeconds > 0) this.startPolling();
  }

  startPolling() {
    this.stopPolling();
    this.pollTimer = window.setInterval(
      () => this.syncOnce().catch(console.error),
      this.settings.pollSeconds * 1000,
    );
    this.registerInterval(this.pollTimer);
  }
  stopPolling() {
    if (this.pollTimer) { window.clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  startRealtime() {
    if (!this.client) return;
    this.stopRealtime();
    this.realtimeChan = this.client
      .channel("edigger-clippings")
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "clippings" },
          () => this.syncOnce().catch(console.error))
      .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "analysis_results" },
          () => this.syncOnce().catch(console.error))
      .subscribe();
  }
  stopRealtime() {
    if (this.realtimeChan && this.client) {
      this.client.removeChannel(this.realtimeChan);
      this.realtimeChan = null;
    }
  }

  async syncOnce() {
    if (!this.client) return;
    const since = this.settings.lastSyncIso;

    // 1) Fetch clippings updated since last cursor
    const { data: clips, error } = await this.client
      .from("clippings")
      .select("*")
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    if (!clips || clips.length === 0) return;

    // 2) Fetch matching analysis
    const ids = clips.map((c) => c.id);
    const { data: analyses } = await this.client
      .from("analysis_results")
      .select("*")
      .in("clipping_id", ids);
    const aMap = new Map<string, AnalysisRow>(
      (analyses ?? []).map((a) => [a.clipping_id, a as AnalysisRow]),
    );

    // 3) Write markdown files
    await this.ensureFolder(this.settings.folder);
    let newestIso = since;
    for (const c of clips as ClippingRow[]) {
      await this.writeClippingFile(c, aMap.get(c.id));
      if (c.updated_at > newestIso) newestIso = c.updated_at;
    }

    this.settings.lastSyncIso = newestIso;
    await this.saveSettings();
    new Notice(`e=digger: ${clips.length}개 노트 동기화`);
  }

  private async ensureFolder(folder: string) {
    const path = normalizePath(folder);
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path).catch(() => {});
    }
  }

  private async writeClippingFile(c: ClippingRow, a?: AnalysisRow) {
    const folder = normalizePath(this.settings.folder);
    const datePart = c.created_at.slice(0, 10);
    const safeTitle = (c.title || "Untitled")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const fileName = `${datePart}-${safeTitle || c.id.slice(0, 8)}.md`;
    const fullPath = normalizePath(`${folder}/${fileName}`);

    const fm = this.buildFrontmatter(c, a);
    const body = this.buildBody(c, a);
    const md = `---\n${fm}\n---\n\n${body}\n`;

    const existing = this.app.vault.getAbstractFileByPath(fullPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, md);
    } else {
      await this.app.vault.create(fullPath, md);
    }
  }

  private buildFrontmatter(c: ClippingRow, a?: AnalysisRow): string {
    const kws = a?.keywords ? Object.keys(a.keywords) : [];
    const related = a?.related_clipping_ids ?? [];
    const tags = [...(c.tags ?? []), ...(a?.category ? [a.category] : [])];
    const yaml = [
      `id: ${c.id}`,
      `title: ${yamlString(c.title)}`,
      c.url ? `url: ${yamlString(c.url)}` : null,
      `source: ${c.source ?? "chrome"}`,
      `created: ${c.created_at}`,
      `updated: ${c.updated_at}`,
      a?.category ? `category: ${yamlString(a.category)}` : null,
      tags.length ? `tags:\n${tags.map((t) => `  - ${yamlString(t)}`).join("\n")}` : null,
      kws.length ? `keywords:\n${kws.map((k) => `  - ${yamlString(k)}`).join("\n")}` : null,
      related.length ? `related:\n${related.map((r) => `  - ${r}`).join("\n")}` : null,
    ].filter(Boolean).join("\n");
    return yaml;
  }

  private buildBody(c: ClippingRow, a?: AnalysisRow): string {
    const out: string[] = [];
    out.push(`# ${c.title || "Untitled"}\n`);
    if (c.url) out.push(`[원문 열기](${c.url})\n`);
    if (c.memo) out.push(`> ${c.memo}\n`);
    out.push("\n## 본문\n");
    out.push(c.content ?? "");
    if (a?.keywords && Object.keys(a.keywords).length) {
      out.push("\n\n## 키워드 (빈도)\n");
      for (const [k, v] of Object.entries(a.keywords)) {
        out.push(`- [[${k}]] · ${v}`);
      }
    }
    if (a?.related_clipping_ids?.length) {
      out.push("\n\n## 연관 노트\n");
      for (const rid of a.related_clipping_ids) {
        out.push(`- [[${rid}]]`);
      }
    }
    return out.join("\n");
  }
}

function yamlString(s: string): string {
  if (/^[\w./:\-가-힣\s]+$/.test(s)) return JSON.stringify(s).slice(1, -1).includes(":")
    ? JSON.stringify(s) : `"${s.replace(/"/g, '\\"')}"`;
  return JSON.stringify(s);
}

// ─── Settings UI ──────────────────────────────────────────────────────────
class EdiggerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: EdiggerPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "e=digger Sync" });

    new Setting(containerEl).setName("Supabase URL")
      .addText((t) => t.setValue(this.plugin.settings.supabaseUrl)
        .onChange(async (v) => { this.plugin.settings.supabaseUrl = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("anon key")
      .addText((t) => t.setValue(this.plugin.settings.anonKey)
        .onChange(async (v) => { this.plugin.settings.anonKey = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Email")
      .addText((t) => t.setValue(this.plugin.settings.email)
        .onChange(async (v) => { this.plugin.settings.email = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Password")
      .addText((t) => { t.inputEl.type = "password"; return t.setValue(this.plugin.settings.password)
        .onChange(async (v) => { this.plugin.settings.password = v; await this.plugin.saveSettings(); }); });

    new Setting(containerEl).setName("Vault folder")
      .setDesc("Markdown 파일이 저장될 vault 내 폴더")
      .addText((t) => t.setValue(this.plugin.settings.folder)
        .onChange(async (v) => { this.plugin.settings.folder = v.trim() || "e=digger"; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Realtime")
      .setDesc("Supabase 실시간 변경 구독")
      .addToggle((t) => t.setValue(this.plugin.settings.useRealtime)
        .onChange(async (v) => { this.plugin.settings.useRealtime = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Poll seconds")
      .setDesc("0이면 폴링 안 함 (realtime만 사용)")
      .addText((t) => t.setValue(String(this.plugin.settings.pollSeconds))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.pollSeconds = isNaN(n) ? 0 : Math.max(0, n);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("재연결 / Sync now").setCta()
        .onClick(async () => {
          this.plugin.stopPolling(); this.plugin.stopRealtime();
          await this.plugin.start();
        }));
  }
}
