# e=digger Chrome Extension

Manifest V3. No build step — load the folder directly.

## Install (dev)
1. Place 16/48/128px PNGs at `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`
   (placeholders are fine — any solid-colored square).
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
3. Click the extension's **Options** and paste:
   - Supabase URL (e.g. `https://xxx.supabase.co`)
   - anon key
   - Either email/password OR access_token + refresh_token

## Usage
- **Right-click selected text → "e=digger: 선택 텍스트 저장"**
- **Right-click on page → "e=digger: 전체 페이지 저장"**
- **Popup (toolbar icon):** prefills current page, allows editing title/content/tags/memo before saving.

## Cost
Uses only Supabase REST + Auth endpoints — no third-party services.
