# 카페24 웹훅 연동 가이드

## 0. 새로 추가된 것

- `lib/db.ts`, `lib/store.ts` — SQLite(`data/cardbreak.db`)에 주문 · 히트카드 저장
- `lib/cafe24.ts` — 카페24 웹훅 payload를 오버레이 형식으로 변환 (⚠️ 필드명 확인 필요, 아래 2번 참고)
- `app/api/webhooks/cafe24/route.ts` — 카페24가 호출할 웹훅 수신 엔드포인트
- `app/api/orders`, `app/api/orders/[id]`, `app/api/hit-cards` — 주문/히트카드 CRUD
- `app/api/stream` — SSE로 오버레이·관리자 화면에 실시간 반영
- `app/admin` — 방송인이 "오픈 시작", "히트카드 등록"을 직접 조작하는 화면
- `app/overlay-cardbreak/CardBreakFrame.tsx` — 정적 데이터 대신 실시간 데이터를 보여주도록 수정

기존 `cardbreak-data.ts`의 하드코딩 배열은 제거했습니다 (실시간 데이터로 대체).

## 1. 설치

```bat
cd /d C:\Users\DND10\Desktop\obs-order-queue
npm install
```

`better-sqlite3`는 네이티브 모듈이라 설치 중 컴파일이 필요할 수 있습니다.
만약 Windows에서 설치가 실패하면:
- Node.js LTS 버전(짝수 버전, 예: 20.x)을 사용 중인지 확인
- 그래도 실패하면 `npm install better-sqlite3 --build-from-source=false` 로 재시도

## 2. 카페24 웹훅 필드명 확인 (중요)

카페24 웹훅의 정확한 JSON 구조는 이벤트 종류와 앱 설정에 따라 달라질 수 있어서,
`lib/cafe24.ts`의 `normalizeCafe24Order()`는 일반적으로 쓰이는 필드명을 가정한 **1차
추정치**로 작성했습니다. 실제로는 아래 순서로 진행하세요.

1. 아래 3번대로 ngrok을 켜고 웹훅 URL을 카페24에 등록
2. 테스트 스토어에서 주문을 하나 발생시킴
3. `npm run dev`를 실행 중인 터미널 콘솔에 다음과 같은 로그가 찍힙니다:
   ```
   [cafe24 webhook] payload: { ... 실제 원본 데이터 ... }
   ```
4. 이 로그를 보고 주문번호 / 주문자명 / 상품명 / 수량 / 가격이 어떤 키에 들어있는지 확인
5. `lib/cafe24.ts`의 `pick(resource, [...])` 목록에 실제 키 이름을 추가

정규화에 실패하면(`정규화 실패` 경고) 주문이 큐에 추가되지 않을 뿐, 서버가 죽거나
카페24에 에러를 리턴하지는 않습니다(카페24가 웹훅을 재전송 폭주하는 것을 막기 위함).

## 3. 로컬 개발 중 ngrok으로 웹훅 받기

카페24 서버는 `localhost`에 접근할 수 없으므로, 개발 중에는 ngrok으로 임시 공개 URL을 만듭니다.

```bat
:: 터미널 1
cd /d C:\Users\DND10\Desktop\obs-order-queue
npm run dev

:: 터미널 2 (ngrok 설치되어 있다는 가정)
ngrok http 3000
```

ngrok이 알려주는 `https://xxxx.ngrok-free.app` 같은 주소가 이번 세션의 공개 URL입니다.
**ngrok 무료 플랜은 껐다 켤 때마다 URL이 바뀌므로**, 카페24 웹훅 URL도 그때마다 다시
등록해야 합니다. 계속 테스트할 예정이면 ngrok 유료 플랜의 고정 도메인을 고려하세요.

## 4. 카페24 개발자센터에서 웹훅 등록 (구매 / 취소 / 환불 각각)

카페24 WebHook 설정 화면은 "이벤트 1개 + URL 1개"를 한 세트로 등록하는 구조입니다.
그래서 **구매/취소/환불을 각각 별도의 웹훅으로 3번 등록**하고, URL 끝에 붙는
`event=` 값만 다르게 해서 우리 서버가 구분하도록 합니다.

1. 개발자센터 → 내 앱 → 해당 앱 선택 → WebHook 설정 → 웹훅 추가
2. **이벤트** 드롭박스에서 아래 항목을 하나씩 선택해서 총 3개(또는 필요한 만큼) 등록:
   - 주문접수(구매) 관련 이벤트 → `event=created`
   - 주문취소 관련 이벤트 → `event=cancelled`
   - 환불/입금취소 관련 이벤트 → `event=refunded`

   > 드롭박스에 정확히 어떤 이름의 이벤트들이 있는지는 앱에 부여된 권한(Scope)에 따라
   > 달라집니다. "주문", "취소", "환불" 이 들어간 이벤트를 찾아서 선택하세요. 목록을
   > 캡처해서 보여주시면 정확히 어떤 걸 골라야 하는지 같이 확인할 수 있습니다.

3. 각 이벤트마다 **수신 URL**에 아래 형식으로 등록 (event 값만 다르게):
   ```
   https://xxxx.ngrok-free.app/api/webhooks/cafe24?token=여기에_CAFE24_WEBHOOK_TOKEN&event=created
   https://xxxx.ngrok-free.app/api/webhooks/cafe24?token=여기에_CAFE24_WEBHOOK_TOKEN&event=cancelled
   https://xxxx.ngrok-free.app/api/webhooks/cafe24?token=여기에_CAFE24_WEBHOOK_TOKEN&event=refunded
   ```
4. 수신 여부는 "활성"으로 저장
5. 프로젝트 루트에 `.env.local` 파일을 만들고 (`.env.local.example` 복사) 같은 토큰 값을 넣기:
   ```
   CAFE24_WEBHOOK_TOKEN=여기에_CAFE24_WEBHOOK_TOKEN
   ```
6. `.env.local` 수정 후에는 `npm run dev`를 재시작해야 반영됩니다.

### 취소/환불이 화면에 표시되는 방식

- 대기 중이던 주문이 취소/환불되면: 목록에 그대로 남아있고 "취소됨"/"환불됨" 배지가 표시된 뒤
  **8초 후 자동으로 목록에서 사라집니다.**
- 이미 "지금 오픈 중"인 주문이 취소/환불되면: NOW OPENING 패널에 같은 배지가 뜨고, 8초 후
  자동으로 슬롯이 비워집니다(다음 주문을 오픈하는 건 계속 `/admin`에서 수동으로 진행).
- 8초라는 시간은 `lib/store.ts`의 `CANCEL_DISPLAY_SECONDS` 값을 바꾸면 조절됩니다.

## 5. 배포(ngrok 없이 상시 운영하려면)

지금 구조를 그대로 Vercel 등에 배포하면 되지만, `better-sqlite3`는 **로컬 파일 기반**이라
서버리스 환경(Vercel)에서는 배포마다 데이터가 초기화되거나 인스턴스 간 공유가 안 됩니다.
상시 운영(주기적인 실제 방송)까지 가게 되면 그때는 Supabase 같은 외부 DB로 옮기는 걸
권장합니다 — 지금 구조(`lib/store.ts`)는 함수 단위로 분리되어 있어서 DB만 교체하면 API
라우트와 화면 코드는 거의 그대로 재사용할 수 있습니다.

## 6. 사용 흐름

1. 카페24 주문 발생 → 웹훅 → 자동으로 "대기 주문"에 추가
2. 방송인이 `/admin`에서 대기 주문 중 하나를 "오픈 시작" (타이머 초 입력)
3. 오버레이(`/overlay-cardbreak`, `/preview-cardbreak`)에 실시간으로 반영
4. 카드를 오픈하면 `/admin`에서 히트카드 등록 → HIT CARD LIST에 즉시 추가
5. 오픈이 끝나면 "오픈 완료" 클릭

## 7. DB 초기화하고 싶을 때

개발 중 데이터를 리셋하려면 서버를 끄고 `data/cardbreak.db*` 파일들을 지운 뒤 다시
`npm run dev`를 실행하면 빈 DB로 새로 시작합니다.

## 8. .gitignore에 추가 권장

```
data/
.env.local
```
