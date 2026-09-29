# OBS Order Queue

OBS Browser Source용 주문 대기열 Next.js 프로젝트입니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서:

- 홈: http://localhost:3001
- OBS 오버레이: http://localhost:3001/overlay

## OBS 연결

OBS → 소스 → + → 브라우저

URL:
http://localhost:3001/overlay

권장 크기:
- Width: 500
- Height: 900

## 세로형 라이브

- 실제 OBS 투명 오버레이: http://localhost:3001/overlay-vertical
- 가짜 영상이 포함된 디자인 미리보기: http://localhost:3001/preview-vertical

OBS Browser Source 권장 크기:
- Width: 1080
- Height: 1920

실제 OBS에서는 카메라/영상 소스를 아래에 두고,
`/overlay-vertical` Browser Source를 위에 배치하세요.

## 카드브레이크 방송형 UI (실시간 카페24 연동)

- 실제 OBS 투명 오버레이: http://localhost:3001/overlay-cardbreak
- 방송 느낌 미리보기: http://localhost:3001/preview-cardbreak
- 관리자 화면(오픈 시작/히트카드 등록): http://localhost:3001/admin

권장 OBS Browser Source:
- Width: 1080
- Height: 1920

카페24 웹훅(구매/취소/환불)을 실시간으로 반영합니다.
설정 방법은 `CAFE24_SETUP.md` 파일을 참고하세요.
