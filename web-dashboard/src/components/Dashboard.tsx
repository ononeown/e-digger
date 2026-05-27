import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Clipping, type Analysis } from "../lib/supabase";
import Graph from "./Graph";
import SidePanel from "./SidePanel";

export default function Dashboard({ session }: { session: Session }) {
  const [clippings, setClippings] = useState<Clipping[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const [cRes, aRes] = await Promise.all([
      supabase.from("clippings")
        .select("id,user_id,title,url,content,source,tags,memo,created_at")
        .order("created_at", { ascending: false }).limit(500),
      supabase.from("analysis_results")
        .select("clipping_id,keywords,category,related_clipping_ids,similarity_scores")
        .limit(500),
    ]);
    setClippings(cRes.data ?? []);
    setAnalyses(aRes.data ?? []);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  // Realtime: refetch on any change
  useEffect(() => {
    const ch = supabase
      .channel("dashboard")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "clippings" }, () => reload())
      .on("postgres_changes",
          { event: "*", schema: "public", table: "analysis_results" }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const aMap = useMemo(() => new Map(analyses.map((a) => [a.clipping_id, a])), [analyses]);
  const cMap = useMemo(() => new Map(clippings.map((c) => [c.id, c])), [clippings]);

  return (
    <div className="app">
      <div className="topbar">
        <h1>e=digger · {session.user.email}</h1>
        <div className="row">
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {clippings.length} clippings · {analyses.length} analyses
          </span>
          <button onClick={reload}>새로고침</button>
          <button onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </div>
      </div>
      <div className="layout">
        <div className="graph-wrap">
          {loading ? (
            <div className="empty">로딩…</div>
          ) : (
            <Graph
              clippings={clippings}
              analyses={analyses}
              selectedId={selected}
              onSelect={setSelected}
            />
          )}
        </div>
        <SidePanel
          clippings={clippings}
          aMap={aMap}
          cMap={cMap}
          selectedId={selected}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}
