-- ============================================================
-- e=digger : Second Brain Supabase Schema
-- Supabase Free Tier 기준 (Postgres 15+, RLS 활성화)
-- ============================================================

-- 0) 확장
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) profiles : auth.users 1:1 매핑
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  updated_at timestamptz default now()
);

-- auth.users 생성 시 profiles 자동 행 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2) clippings : 크롬/옵시디언이 푸시하는 원본 클리핑
-- ------------------------------------------------------------
create table if not exists clippings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  url text,
  content text,
  raw_html text,
  source text default 'chrome',           -- 'chrome' | 'obsidian' | 'web'
  tags text[] default '{}',
  memo text,                              -- 클리핑 시점 한 줄 메모
  analyzed boolean default false,         -- Edge Function 처리 여부
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists clippings_user_idx on clippings(user_id, created_at desc);
create index if not exists clippings_analyzed_idx on clippings(analyzed) where analyzed = false;

-- ------------------------------------------------------------
-- 3) analysis_results : Edge Function 결과
-- ------------------------------------------------------------
create table if not exists analysis_results (
  id uuid default gen_random_uuid() primary key,
  clipping_id uuid references clippings(id) on delete cascade not null unique,
  user_id uuid references profiles(id) on delete cascade not null,
  keywords jsonb default '{}'::jsonb,     -- { "단어": 빈도, ... } top-N
  tfidf jsonb default '{}'::jsonb,        -- { "단어": tfidf_score, ... }
  category text,                          -- 자동 분류 라벨 (최상위 키워드 기반)
  related_clipping_ids uuid[] default '{}',
  similarity_scores jsonb default '{}'::jsonb, -- { "<other_clipping_id>": 0.42, ... }
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists analysis_user_idx on analysis_results(user_id);
create index if not exists analysis_clipping_idx on analysis_results(clipping_id);

-- ------------------------------------------------------------
-- 4) updated_at 자동 갱신 트리거
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists touch_clippings on clippings;
create trigger touch_clippings before update on clippings
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_analysis on analysis_results;
create trigger touch_analysis before update on analysis_results
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 5) RLS (Row Level Security)
-- ------------------------------------------------------------
alter table profiles enable row level security;
alter table clippings enable row level security;
alter table analysis_results enable row level security;

-- profiles
drop policy if exists "profiles self read" on profiles;
create policy "profiles self read" on profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles self upsert" on profiles;
create policy "profiles self upsert" on profiles
  for update using (auth.uid() = id);

-- clippings : 본인 것만
drop policy if exists "clippings owner select" on clippings;
create policy "clippings owner select" on clippings
  for select using (auth.uid() = user_id);
drop policy if exists "clippings owner insert" on clippings;
create policy "clippings owner insert" on clippings
  for insert with check (auth.uid() = user_id);
drop policy if exists "clippings owner update" on clippings;
create policy "clippings owner update" on clippings
  for update using (auth.uid() = user_id);
drop policy if exists "clippings owner delete" on clippings;
create policy "clippings owner delete" on clippings
  for delete using (auth.uid() = user_id);

-- analysis_results : 본인 것만 조회. insert/update는 service_role(Edge Function) 전용
drop policy if exists "analysis owner select" on analysis_results;
create policy "analysis owner select" on analysis_results
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 6) Realtime publication (옵시디언 플러그인이 구독)
-- ------------------------------------------------------------
alter publication supabase_realtime add table clippings;
alter publication supabase_realtime add table analysis_results;

-- ------------------------------------------------------------
-- 7) Edge Function 트리거 (Database Webhook 권장)
-- ------------------------------------------------------------
-- Supabase Dashboard → Database → Webhooks 에서 다음과 같이 설정:
--   Table: clippings
--   Events: INSERT
--   Type: HTTP Request
--   URL: https://<project-ref>.functions.supabase.co/analyze-clipping
--   HTTP Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
--
-- (대안) pg_net + trigger 로 직접 호출 가능하지만 Webhook 이 가장 간편.
