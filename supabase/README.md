# Supabase Setup

## 1. Apply schema
1. Create a free project at https://supabase.com
2. SQL Editor → paste `schema.sql` → Run
3. Authentication → enable Email provider (or Magic Link)

## 2. Deploy Edge Function
```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-ref>
supabase functions deploy analyze-clipping --no-verify-jwt
```
(`--no-verify-jwt` is required because the database webhook calls it with the service role key in the Authorization header, not a user JWT.)

## 3. Wire up the trigger
Dashboard → Database → Webhooks → **Create a new hook**
- Name: `analyze-clipping`
- Table: `public.clippings`
- Events: ✅ Insert
- Type: HTTP Request
- Method: POST
- URL: `https://<project-ref>.functions.supabase.co/analyze-clipping`
- HTTP Headers:
  - `Authorization: Bearer <SERVICE_ROLE_KEY>`
  - `Content-Type: application/json`

## 4. Env (set in Edge Function secrets, usually pre-populated)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Free-tier notes
- Free project: 500 MB DB, 2 GB egress, 500K edge function invocations / month.
- This pipeline performs all NLP in Deno (no external paid APIs).
- Korean tokenization is a lightweight heuristic — adequate for MVP, swap in a proper morphological analyzer later if needed.
