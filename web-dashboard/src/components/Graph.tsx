// MVP visualization — heavy redesign expected later. Keep it functional, not fancy.
//
// Nodes: clippings (sized by total keyword count).
// Links: edges drawn from analysis_results.similarity_scores (weighted).

import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { Clipping, Analysis } from "../lib/supabase";

type Node = { id: string; name: string; val: number; category?: string | null };
type Link = { source: string; target: string; value: number };

export default function Graph({
  clippings, analyses, selectedId, onSelect,
}: {
  clippings: Clipping[];
  analyses: Analysis[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const fgRef = useRef<ForceGraphMethods<Node, Link>>();

  const { nodes, links } = useMemo(() => {
    const aMap = new Map(analyses.map((a) => [a.clipping_id, a]));
    const nodes: Node[] = clippings.map((c) => {
      const a = aMap.get(c.id);
      const kwSum = a?.keywords ? Object.values(a.keywords).reduce((s, n) => s + n, 0) : 1;
      return {
        id: c.id,
        name: c.title || "Untitled",
        val: Math.max(2, Math.log2(kwSum + 1) * 2),
        category: a?.category ?? null,
      };
    });
    const idSet = new Set(nodes.map((n) => n.id));
    const seen = new Set<string>();
    const links: Link[] = [];
    for (const a of analyses) {
      if (!a.similarity_scores) continue;
      for (const [other, score] of Object.entries(a.similarity_scores)) {
        if (!idSet.has(other) || !idSet.has(a.clipping_id)) continue;
        const key = [a.clipping_id, other].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: a.clipping_id, target: other, value: score });
      }
    }
    return { nodes, links };
  }, [clippings, analyses]);

  // Color per category
  const colorOf = useMemo(() => {
    const cats = Array.from(new Set(nodes.map((n) => n.category ?? "·")));
    const map = new Map<string, string>();
    cats.forEach((c, i) => map.set(c, `hsl(${(i * 47) % 360} 70% 60%)`));
    return (n: Node) => map.get(n.category ?? "·")!;
  }, [nodes]);

  useEffect(() => {
    if (!fgRef.current || !selectedId) return;
    const n = nodes.find((x) => x.id === selectedId) as any;
    if (n && n.x != null && n.y != null) {
      fgRef.current.centerAt(n.x, n.y, 600);
      fgRef.current.zoom(2.5, 600);
    }
  }, [selectedId, nodes]);

  return (
    <ForceGraph2D
      ref={fgRef as any}
      graphData={{ nodes, links }}
      nodeId="id"
      nodeLabel={(n: Node) => `${n.name}${n.category ? ` · #${n.category}` : ""}`}
      nodeRelSize={3}
      nodeVal={(n: Node) => n.val}
      linkWidth={(l: Link) => Math.max(0.5, l.value * 4)}
      linkColor={() => "rgba(160,170,180,0.35)"}
      cooldownTime={4000}
      onNodeClick={(n: Node) => onSelect(n.id)}
      onBackgroundClick={() => onSelect(null)}
      nodeCanvasObjectMode={() => "after"}
      nodeCanvasObject={(node: any, ctx, scale) => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(2, node.val), 0, Math.PI * 2);
        ctx.fillStyle = node.id === selectedId ? "#fff" : colorOf(node);
        ctx.fill();
        if (scale > 1.5 || node.id === selectedId) {
          ctx.font = `${12 / scale}px system-ui`;
          ctx.fillStyle = "#e6e8ea";
          ctx.fillText(node.name, node.x + 6, node.y + 4);
        }
      }}
    />
  );
}
