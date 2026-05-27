# e=digger — Second Brain MVP

웹서핑 클리핑 → 자동 분석 → 옵시디언 + 대시보드 시각화. 전 구성 요소는 **무료 사용량** 안에서 동작합니다.

```
┌──────────────┐      ┌────────────────────┐       ┌──────────────────┐
│ Chrome Ext.  │──▶───│ Supabase (DB+Auth) │──▶────│ Edge Function    │
│ (MV3)        │      │  clippings table   │  웹훅  │ analyze-clipping │
└──────────────┘      └──────────┬─────────┘       └────────┬─────────┘
                                 │                          │
                                 ▼                          ▼
                       ┌──────────────────┐      analysis_results 업데이트
                       │ Obsidian Plugin  │◀── Realtime / 폴링
                       │  (md 파일 생성)  │
                       └──────────────────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │ Vite + React     │
                       │ Dashboard        │
                       │ (force graph)    │
                       └──────────────────┘
```

## 디렉토리
| 폴더 | 역할 |
| --- | --- |
| `supabase/` | SQL 스키마 + Edge Function (`analyze-clipping`) |
| `chrome-extension/` | Manifest V3 클리퍼 |
| `obsidian-plugin/` | Vault 동기화 플러그인 |
| `web-dashboard/` | Vite + React + react-force-graph 대시보드 |

## 셋업 순서 (한 번만)

1. **Supabase 프로젝트 생성** → `supabase/schema.sql` 을 SQL Editor 에 붙여넣어 실행.
2. **Edge Function 배포**
   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref <ref>
   supabase functions deploy analyze-clipping --no-verify-jwt
   ```
3. **Database Webhook** 등록 (Dashboard → Database → Webhooks):
   - Table `clippings`, Event `INSERT`
   - URL `https://<ref>.functions.supabase.co/analyze-clipping`
   - Header `Authorization: Bearer <SERVICE_ROLE_KEY>`
4. **Auth** → Email Provider 활성화. 계정 1개 가입.
5. **Chrome Extension** 로드 ( `chrome://extensions` → Load unpacked → `chrome-extension/` ).
   옵션에서 Supabase URL / anon key / 이메일·비밀번호 입력.
6. **Obsidian Plugin** (빌드 불필요):
   - `<vault>/.obsidian/plugins/edigger-sync/` 폴더 생성 (⚠ 폴더명은 반드시 `edigger-sync`)
   - `obsidian-plugin/manifest.json` 과 `obsidian-plugin/main.js` 두 파일을 위 폴더로 복사
   - Obsidian → 설정 → Community plugins → Reload → "e=digger Sync" 활성화
   - 설정 탭에서 Supabase URL / anon key / Email / Password 입력 후 "재연결 / Sync now"
   - (TS로 개발하고 싶을 때만) `npm install && npm run build` — 선택사항
7. **Dashboard** 실행:
   ```bash
   cd web-dashboard && cp .env.example .env  # 값 채우기
   npm install && npm run dev
   ```

## 분석 파이프라인 (Edge Function 내부)

```
content → tokenize(한글+영문, 불용어 제거, 조사 strip)
        → term frequency (top 30)
        → TF-IDF (사용자 본인 코퍼스 기준)
        → 기존 클리핑 keywords 와 cosine + jaccard 결합 점수
        → 상위 10개를 related_clipping_ids 로 저장 (양방향 백필)
        → top TF-IDF 단어를 category 로 저장
```

무료 범위에서 동작 가능한 가벼운 NLP 휴리스틱입니다. 형태소 분석기/임베딩이 필요해지면 Edge Function 내부만 교체하면 됩니다.

## 무료 한도 점검
- Supabase Free: DB 500MB, 월 500K 함수 호출, Realtime 2 동시 채널 — 개인 사용 충분
- Vercel Free: 정적 호스팅 충분
- 외부 유료 API 호출 **없음**

## TODO / 추후 수정 전제 (사용자 메모)
- **대시보드 메인 시각화 디자인은 디버깅 후 크게 재작업 예정** — `web-dashboard/src/components/Graph.tsx` 만 손대면 됩니다.
- 옵시디언 → Supabase 역동기화는 MVP 에서 제외 (기획서 2.2 "로컬 수정사항 백업 (선택)").
- 한글 형태소 분석은 정식 분석기로 교체 여지 있음 (Edge Function `tokenize()` 함수 1곳).
