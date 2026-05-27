// Supabase Edge Function: analyze-clipping
// Trigger: Database Webhook on INSERT into public.clippings
// Runs entirely on Supabase free tier (Deno, no external paid APIs).
//
// Logic:
//   1) tokenize content  (Korean + English, simple noun-ish heuristic)
//   2) compute term frequency  (top-N keywords)
//   3) compute TF-IDF against the user's existing clippings corpus
//   4) compute cosine + Jaccard similarity vs. existing clippings
//   5) pick category = top keyword (or top cluster head — MVP: top keyword)
//   6) upsert analysis_results and mark clipping.analyzed = true

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Tokenizer ────────────────────────────────────────────────────────────
// Free, no external dict. Splits by non-letter chars and keeps tokens with:
//   - Hangul block (가-힣) length >= 2  OR
//   - Latin word length >= 3
// Strips a small Korean particle/stopword list and English stopwords.

const STOPWORDS_KO = new Set([
  "그리고","그러나","하지만","그래서","그런데","또한","즉","및","또는","위해","대한","대해",
  "이것","저것","그것","여기","저기","거기","우리","저희","당신","자신","경우","때문","통해",
  "위한","대한","관련","정도","사용","사람","사실","경우","문제","결과","상황","부분","내용",
  "이번","오늘","내일","어제","지금","현재","최근","이후","이전","오전","오후",
  "있다","없다","하다","되다","이다","아니다","같다","많다","적다","좋다","나쁘다",
]);
const STOPWORDS_EN = new Set([
  "the","a","an","and","or","but","if","then","so","of","to","in","on","at","by","for","with",
  "from","as","is","are","was","were","be","been","being","have","has","had","do","does","did",
  "will","would","can","could","should","may","might","this","that","these","those","it","its",
  "he","she","they","we","you","i","me","my","your","his","her","their","our","not","no","yes",
  "about","into","over","than","such","also","more","most","some","any","all","each","other",
]);

function tokenize(raw: string): string[] {
  if (!raw) return [];
  const text = raw.toLowerCase().replace(/<[^>]+>/g, " ");
  // Split on anything that isn't Hangul, Latin letter, or digit
  const parts = text.split(/[^\p{Script=Hangul}a-z0-9]+/u);
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const isHangul = /^[\p{Script=Hangul}]+$/u.test(p);
    const isLatin  = /^[a-z0-9]+$/.test(p);
    if (isHangul) {
      if (p.length < 2) continue;
      if (STOPWORDS_KO.has(p)) continue;
      // crude particle strip: drop common postpositions when length > 2
      const stripped = p
        .replace(/(은|는|이|가|을|를|에|의|로|으로|와|과|도|만|에서|에게|한테|보다|처럼|부터|까지)$/u, "");
      if (stripped.length >= 2 && !STOPWORDS_KO.has(stripped)) out.push(stripped);
    } else if (isLatin) {
      if (p.length < 3) continue;
      if (STOPWORDS_EN.has(p)) continue;
      out.push(p);
    }
  }
  return out;
}

function termFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

function topN(tf: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tf).sort((a, b) => b[1] - a[1]).slice(0, n),
  );
}

// ─── Similarity ───────────────────────────────────────────────────────────
function jaccard(aKeys: Set<string>, bKeys: Set<string>): number {
  if (!aKeys.size || !bKeys.size) return 0;
  let inter = 0;
  for (const k of aKeys) if (bKeys.has(k)) inter++;
  const union = aKeys.size + bKeys.size - inter;
  return union === 0 ? 0 : inter / union;
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of Object.entries(a)) { na += v * v; if (b[k]) dot += v * b[k]; }
  for (const v of Object.values(b)) nb += v * v;
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── TF-IDF ───────────────────────────────────────────────────────────────
function tfidf(
  tf: Record<string, number>,
  docFreq: Record<string, number>,
  totalDocs: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const tokens = Object.values(tf).reduce((s, n) => s + n, 0) || 1;
  for (const [k, n] of Object.entries(tf)) {
    const df = docFreq[k] ?? 0;
    const idf = Math.log((1 + totalDocs) / (1 + df)) + 1; // smooth idf
    out[k] = (n / tokens) * idf;
  }
  return out;
}

// ─── Main handler ─────────────────────────────────────────────────────────
type Clipping = {
  id: string; user_id: string; title: string; content: string | null; url: string | null;
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json();
    // Supabase Webhook payload: { type, table, record, old_record, schema }
    // Allow manual invoke: { clipping_id }
    const record: Clipping | undefined = body?.record;
    const clippingId: string | undefined = record?.id ?? body?.clipping_id;
    if (!clippingId) return json({ ok: false, error: "missing clipping id" }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Fetch the target clipping (full row; webhook record may be partial in older versions)
    const { data: target, error: tErr } = await sb
      .from("clippings")
      .select("id,user_id,title,content,url")
      .eq("id", clippingId)
      .single();
    if (tErr || !target) return json({ ok: false, error: tErr?.message ?? "not found" }, 404);

    const baseText = [target.title, target.content].filter(Boolean).join("\n");
    const tokens = tokenize(baseText);
    if (tokens.length === 0) {
      await sb.from("clippings").update({ analyzed: true }).eq("id", target.id);
      return json({ ok: true, skipped: "empty tokens" });
    }
    const tf = termFreq(tokens);
    const targetKeywords = topN(tf, 30);

    // 2) Fetch user's other analyses (for IDF + similarity)
    const { data: others, error: oErr } = await sb
      .from("analysis_results")
      .select("clipping_id,keywords")
      .eq("user_id", target.user_id)
      .neq("clipping_id", target.id)
      .limit(500);
    if (oErr) return json({ ok: false, error: oErr.message }, 500);

    // 3) Build doc frequency from existing keyword maps + this doc
    const docFreq: Record<string, number> = {};
    const corpus = others ?? [];
    for (const row of corpus) {
      const kws = (row.keywords ?? {}) as Record<string, number>;
      for (const k of Object.keys(kws)) docFreq[k] = (docFreq[k] ?? 0) + 1;
    }
    for (const k of Object.keys(tf)) docFreq[k] = (docFreq[k] ?? 0) + 1;
    const totalDocs = corpus.length + 1;
    const tfidfMap = tfidf(tf, docFreq, totalDocs);
    const topTfidf = topN(tfidfMap, 20);

    // 4) Similarity vs each other clipping (cosine on keyword vectors + jaccard on key sets)
    const targetSet = new Set(Object.keys(targetKeywords));
    const scores: Record<string, number> = {};
    for (const row of corpus) {
      const kws = (row.keywords ?? {}) as Record<string, number>;
      if (Object.keys(kws).length === 0) continue;
      const cos = cosine(targetKeywords, kws);
      const jac = jaccard(targetSet, new Set(Object.keys(kws)));
      const score = 0.6 * cos + 0.4 * jac;
      if (score > 0.08) scores[row.clipping_id] = +score.toFixed(4);
    }
    const related = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);

    // 5) Category = top TF-IDF keyword (fallback to top TF)
    const category =
      Object.keys(topTfidf)[0] ?? Object.keys(targetKeywords)[0] ?? null;

    // 6) Upsert analysis_results
    const { error: upErr } = await sb.from("analysis_results").upsert(
      {
        clipping_id: target.id,
        user_id: target.user_id,
        keywords: targetKeywords,
        tfidf: topTfidf,
        category,
        related_clipping_ids: related,
        similarity_scores: scores,
      },
      { onConflict: "clipping_id" },
    );
    if (upErr) return json({ ok: false, error: upErr.message }, 500);

    await sb.from("clippings").update({ analyzed: true }).eq("id", target.id);

    // 7) Back-fill: append this clipping into the related rows' related_clipping_ids
    //    so the relationship is symmetric in the graph view.
    for (const otherId of related) {
      const { data: otherRow } = await sb
        .from("analysis_results")
        .select("related_clipping_ids, similarity_scores")
        .eq("clipping_id", otherId)
        .single();
      if (!otherRow) continue;
      const arr = new Set<string>(otherRow.related_clipping_ids ?? []);
      arr.add(target.id);
      const sims = { ...(otherRow.similarity_scores ?? {}), [target.id]: scores[otherId] };
      await sb.from("analysis_results")
        .update({
          related_clipping_ids: Array.from(arr).slice(0, 20),
          similarity_scores: sims,
        })
        .eq("clipping_id", otherId);
    }

    return json({
      ok: true,
      clipping_id: target.id,
      keywords: targetKeywords,
      category,
      related,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
