import type { Clipping, Analysis } from "../lib/supabase";

export default function SidePanel({
  clippings, aMap, cMap, selectedId, onSelect,
}: {
  clippings: Clipping[];
  aMap: Map<string, Analysis>;
  cMap: Map<string, Clipping>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const selected = selectedId ? cMap.get(selectedId) : null;
  const selectedA = selectedId ? aMap.get(selectedId) : null;

  return (
    <aside className="side">
      {selected ? (
        <>
          <h2>선택된 노트</h2>
          <div className="card active">
            <div className="t">{selected.title}</div>
            {selected.url && <div className="u">{selected.url}</div>}
            {selected.memo && <div style={{ marginTop: 6, fontStyle: "italic" }}>"{selected.memo}"</div>}
            {selectedA?.category && (
              <div style={{ marginTop: 6 }}>
                카테고리: <span className="chip">{selectedA.category}</span>
              </div>
            )}
            {selectedA?.keywords && (
              <div style={{ marginTop: 6 }}>
                {Object.entries(selectedA.keywords).slice(0, 12).map(([k, v]) => (
                  <span key={k} className="chip">{k} · {v}</span>
                ))}
              </div>
            )}
            {selected.content && (
              <p style={{ marginTop: 8, fontSize: 12, color: "var(--muted)",
                          maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap" }}>
                {selected.content.slice(0, 600)}
              </p>
            )}
          </div>

          {selectedA?.related_clipping_ids && selectedA.related_clipping_ids.length > 0 && (
            <>
              <h2>연관 노트</h2>
              {selectedA.related_clipping_ids.map((rid) => {
                const c = cMap.get(rid);
                if (!c) return null;
                const score = selectedA.similarity_scores?.[rid];
                return (
                  <div key={rid} className="card" onClick={() => onSelect(rid)}>
                    <div className="t">{c.title}</div>
                    <div className="u">{score != null ? `유사도 ${score.toFixed(3)}` : ""}</div>
                  </div>
                );
              })}
            </>
          )}
          <button style={{ marginTop: 10 }} onClick={() => onSelect(null)}>선택 해제</button>
        </>
      ) : (
        <>
          <h2>최근 클리핑</h2>
          {clippings.length === 0 && <div className="empty">아직 데이터가 없습니다.</div>}
          {clippings.slice(0, 30).map((c) => {
            const a = aMap.get(c.id);
            return (
              <div key={c.id} className="card" onClick={() => onSelect(c.id)}>
                <div className="t">{c.title}</div>
                {c.url && <div className="u">{new URL(c.url).hostname}</div>}
                {a?.category && <span className="chip">{a.category}</span>}
              </div>
            );
          })}
        </>
      )}
    </aside>
  );
}
