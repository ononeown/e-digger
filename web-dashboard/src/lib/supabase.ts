import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  console.warn("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 비어 있습니다. .env 를 확인하세요.");
}

export const supabase = createClient(url ?? "", key ?? "", {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type Clipping = {
  id: string;
  user_id: string;
  title: string;
  url: string | null;
  content: string | null;
  source: string | null;
  tags: string[] | null;
  memo: string | null;
  created_at: string;
};

export type Analysis = {
  clipping_id: string;
  keywords: Record<string, number> | null;
  category: string | null;
  related_clipping_ids: string[] | null;
  similarity_scores: Record<string, number> | null;
};
