import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "cardbreak.db");

declare global {
  // eslint-disable-next-line no-var
  var __cardbreakDb: Database.Database | undefined;
}

// Next.js dev 서버는 파일 변경마다 모듈을 다시 로드하므로,
// global에 인스턴스를 캐싱해서 DB 커넥션이 중복 생성되는 것을 막습니다.
export const db = global.__cardbreakDb ?? new Database(dbPath);

if (process.env.NODE_ENV !== "production") {
  global.__cardbreakDb = db;
}

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'manual',        -- 'cafe24' | 'manual'
    external_order_id TEXT UNIQUE,                 -- 카페24 주문번호 (중복 웹훅 방지 + 취소/환불 매칭용)
    user_id TEXT NOT NULL,                          -- 화면에 노출되는 ID 형식 (예: ID-24018)
    product TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 15000,
    tier TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'waiting',         -- 'waiting' | 'opening' | 'done' | 'cancelled'
    prev_status TEXT,                               -- 취소되기 직전 상태 ('waiting' | 'opening') - 화면 배치용
    cancel_reason TEXT,                             -- 'cancelled' | 'refunded'
    cancelled_at TEXT,                              -- 취소/환불 처리된 시각 (라이브 표시 만료 기준, 이력은 3개월 보관)
    started_at TEXT,                                -- status가 'opening'으로 바뀐 시각
    completed_at TEXT,                              -- '오픈 완료' 처리된 시각
    youtube_nickname TEXT,                          -- 주문서 추가입력의 유튜브 닉네임
    timer_seconds INTEGER,                          -- 오픈 타이머 길이(초)
    paid_at TEXT,                                   -- 카페24 입금완료 웹훅이 들어온 시각
    payment_method TEXT,                            -- 카페24 결제방식 원본 코드 (cash, card 등). 수동 주문은 NULL
    payment_gateway_name TEXT,                      -- PG사명 (예: cafe24payments)
    easypay_name TEXT,                              -- 간편결제명 (네이버페이, 카카오페이 등)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hit_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    card TEXT NOT NULL,
    youtube_nickname TEXT,                          -- 히트카드 등록 시 입력한 유튜브 닉네임
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS overlay_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
`);

// 이미 만들어져 있던 기존 DB 파일에는 completed_at 컬럼이 없을 수 있으므로,
// 없을 때만 안전하게 추가합니다 (SQLite는 ADD COLUMN IF NOT EXISTS를 지원하지 않음).
const orderColumns = db.prepare("PRAGMA table_info(orders)").all() as { name: string }[];
if (!orderColumns.some((col) => col.name === "completed_at")) {
  db.exec("ALTER TABLE orders ADD COLUMN completed_at TEXT");
}
if (!orderColumns.some((col) => col.name === "youtube_nickname")) {
  db.exec("ALTER TABLE orders ADD COLUMN youtube_nickname TEXT");
}
if (!orderColumns.some((col) => col.name === "paid_at")) {
  db.exec("ALTER TABLE orders ADD COLUMN paid_at TEXT");
}
if (!orderColumns.some((col) => col.name === "payment_method")) {
  db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT");
}
if (!orderColumns.some((col) => col.name === "payment_gateway_name")) {
  db.exec("ALTER TABLE orders ADD COLUMN payment_gateway_name TEXT");
}
if (!orderColumns.some((col) => col.name === "easypay_name")) {
  db.exec("ALTER TABLE orders ADD COLUMN easypay_name TEXT");
}

const hitCardColumns = db.prepare("PRAGMA table_info(hit_cards)").all() as { name: string }[];
if (!hitCardColumns.some((col) => col.name === "youtube_nickname")) {
  db.exec("ALTER TABLE hit_cards ADD COLUMN youtube_nickname TEXT");
}
