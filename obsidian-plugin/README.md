# e=digger Obsidian Plugin

빌드 없이 그대로 사용할 수 있도록 `main.js`는 **순수 CommonJS + Obsidian API 만으로** 작성돼 있습니다 (`@supabase/supabase-js` 등 외부 의존성 없음).

## 설치 (빌드 불필요)

1. Vault 에서 `.obsidian/plugins/edigger-sync/` 폴더 생성
   ```
   <your-vault>/.obsidian/plugins/edigger-sync/
   ```
   ⚠ 폴더명은 반드시 **`edigger-sync`** (manifest.json 의 `id` 와 일치).
2. 다음 2개 파일을 이 폴더에 복사:
   - `manifest.json`
   - `main.js`
3. Obsidian → 설정 → Community plugins → "Reload plugins" → **e=digger Sync** 활성화.
4. 설정 탭에서 Supabase URL / anon key / Email / Password / Vault folder / Poll seconds 입력 후
   "재연결 / Sync now" 클릭.

## 주의 사항

- **폴더 이름**이 `obsidian-plugin` 이면 안 됩니다. Obsidian 은 폴더명 == plugin id 를 요구합니다.
- 첫 동기화 후 `data.json` 에 lastSyncIso 가 저장돼 다음번엔 증분 동기화만 합니다.
- 전체 재동기화는 명령 팔레트 → "e=digger: Re-sync everything (reset cursor)".

## (선택) TS 로 개발하기

`main.ts` 와 `esbuild.config.mjs` 가 함께 있지만 빌드는 선택사항입니다. 빌드 시:
```bash
cd obsidian-plugin
npm install
npm run build   # main.js 를 덮어씁니다
```
> 단순히 사용만 한다면 위 빌드 단계는 건너뛰세요. 제공된 `main.js` 가 그대로 동작합니다.
