# e=digger Dashboard (Vite + React + react-force-graph)

> MVP. The main visualization will be heavily redesigned later — keep code paths thin.

## Run
```bash
cd web-dashboard
cp .env.example .env   # fill in Supabase URL + anon key
npm install
npm run dev            # http://localhost:5173
```

## Build / Deploy
```bash
npm run build          # outputs dist/
# Deploy to Vercel: `vercel` (root: web-dashboard/), set the two VITE_* env vars in the dashboard
```

## What's wired up
- Email/password login via Supabase Auth (RLS limits each user to their own rows).
- Pulls `clippings` + `analysis_results` (up to 500 rows MVP).
- Realtime subscription refetches on any DB change.
- 2D force-directed graph (`react-force-graph-2d`):
  - Node = clipping; size scales with total keyword count; color per `category`.
  - Edge weight = `similarity_scores` from the Edge Function.
- Side panel: recent clippings, keywords as chips, related notes for the selected node.

## Free-tier cost
Vercel + Supabase free tiers cover this entirely. No paid APIs are called from the dashboard.
