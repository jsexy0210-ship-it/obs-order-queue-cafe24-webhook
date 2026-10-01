import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "cardbreak.db");

declare global {
  var __cardbreakDb: Database.Database | undefined;
}

// Next.js dev 서버는 파일 변경마다 모듈을 다시 로드하므로,
// global에 인스턴스를 캐싱해서 DB 커넥션이 중복 생성되는 것을 막습니다.
export const db = global.__cardbreakDb ?? new Database(dbPath);

if (process.env.NODE_ENV !== "production") {
  global.__cardbreakDb = db;
}

db.pragma("busy_timeout = 5000");
try {
  db.pragma("journal_mode = WAL");
} catch (error) {
  // Next 빌드의 병렬 프로세스가 이미 WAL 전환 중이면 현재 연결은 기존 저널 모드로 열립니다.
  // 다른 SQLite 오류는 숨기지 않아 운영 문제를 정상적으로 드러냅니다.
  if (!(typeof error === "object" && error !== null && "code" in error && error.code === "SQLITE_BUSY")) {
    throw error;
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'manual',        -- 'cafe24' | 'manual'
    external_order_id TEXT UNIQUE,                 -- 카페24 주문번호 (중복 웹훅 방지 + 취소/환불 매칭용)
    user_id TEXT NOT NULL,                          -- 화면에 노출되는 ID 형식 (예: ID-24018)
    member_id TEXT,                                 -- 카페24 실제 회원 ID (랭킹 합산 및 추적 기준)
    product TEXT NOT NULL,
    product_image_url TEXT,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 15000,
    actual_amount INTEGER,
    tier TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'waiting',         -- 'waiting' | 'opening' | 'done' | 'cancelled'
    prev_status TEXT,                               -- 취소되기 직전 상태 ('waiting' | 'opening') - 화면 배치용
    cancel_reason TEXT,                             -- 'cancelled' | 'refunded'
    cancelled_at TEXT,                              -- 취소/환불 처리된 시각 (라이브 표시 만료 기준, 이력은 누적 보관)
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

  CREATE TABLE IF NOT EXISTS reward_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 카페24 적립/회수 요청의 기준값과 처리 결과를 남기는 원장입니다.
  -- 실제 API 연동 단계에서 동일 주문/동일 작업의 중복 실행을 막는 데 사용합니다.
  CREATE TABLE IF NOT EXISTS reward_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_order_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    grade_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('issue', 'recover')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    card_rate REAL NOT NULL,
    bank_rate REAL NOT NULL,
    applied_rate REAL NOT NULL,
    processing_mode TEXT NOT NULL CHECK (processing_mode IN ('automatic', 'manual')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    error_message TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(external_order_id, action)
  );

  -- OAuth 토큰은 암호화된 payload로만 저장합니다. 실제 토큰 문자열을 평문으로 보관하지 않습니다.
  CREATE TABLE IF NOT EXISTS cafe24_oauth_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    encrypted_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 주문 랭킹 1~10위에게 관리자가 수동 지급한 보너스 적립금 원장입니다.
  CREATE TABLE IF NOT EXISTS ranking_bonus_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT,
    user_id TEXT NOT NULL,
    external_order_id TEXT NOT NULL,
    member_id TEXT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    rank_at_issue INTEGER NOT NULL CHECK (rank_at_issue BETWEEN 1 AND 10),
    status TEXT NOT NULL CHECK (status IN ('test', 'succeeded', 'failed')),
    error_message TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 카페24에서 내려받은 회원별 현재 적립금 잔액입니다. 주문 적립 원장과 별도로
  -- 실제 카페24 잔액을 주문 랭킹에 표시하는 용도로만 보관합니다.
  CREATE TABLE IF NOT EXISTS cafe24_member_point_balance_snapshots (
    member_id TEXT PRIMARY KEY,
    buyer_name TEXT NOT NULL,
    balance INTEGER NOT NULL CHECK (balance >= 0),
    source_file TEXT NOT NULL,
    source_date TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 카페24 주문을 삭제하지 않고 관리자 주문 이력 화면에서만 숨깁니다.
  -- 새로고침으로 원격 주문을 다시 합칠 때에도 숨김 상태를 유지합니다.
  CREATE TABLE IF NOT EXISTS hidden_order_history (
    external_order_id TEXT PRIMARY KEY,
    hidden_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_reward_ledger_status ON reward_ledger(status, action);
  CREATE INDEX IF NOT EXISTS idx_ranking_bonus_user ON ranking_bonus_ledger(user_id, status);
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
if (!orderColumns.some((col) => col.name === "actual_amount")) {
  db.exec("ALTER TABLE orders ADD COLUMN actual_amount INTEGER");
}
if (!orderColumns.some((col) => col.name === "member_id")) {
  db.exec("ALTER TABLE orders ADD COLUMN member_id TEXT");
}
if (!orderColumns.some((col) => col.name === "product_image_url")) {
  db.exec("ALTER TABLE orders ADD COLUMN product_image_url TEXT");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_orders_member_id ON orders(member_id)");

const hitCardColumns = db.prepare("PRAGMA table_info(hit_cards)").all() as { name: string }[];
if (!hitCardColumns.some((col) => col.name === "youtube_nickname")) {
  db.exec("ALTER TABLE hit_cards ADD COLUMN youtube_nickname TEXT");
}

const rankingBonusColumns = db.prepare("PRAGMA table_info(ranking_bonus_ledger)").all() as { name: string }[];
if (!rankingBonusColumns.some((col) => col.name === "request_id")) {
  db.exec("ALTER TABLE ranking_bonus_ledger ADD COLUMN request_id TEXT");
}

// SQLite는 CHECK 제약만 단독 변경할 수 없습니다. 기존 원장 행과 요청 식별자를 보존한 채
// 새 테이블로 교체해 4~10위 보너스 지급도 같은 원장에 기록할 수 있게 합니다.
const rankingBonusSchema = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ranking_bonus_ledger'"
).get() as { sql: string } | undefined;
if (rankingBonusSchema?.sql && /rank_at_issue[\s\S]*?BETWEEN\s+1\s+AND\s+3/i.test(rankingBonusSchema.sql)) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE ranking_bonus_ledger_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT,
        user_id TEXT NOT NULL,
        external_order_id TEXT NOT NULL,
        member_id TEXT,
        amount INTEGER NOT NULL CHECK (amount > 0),
        rank_at_issue INTEGER NOT NULL CHECK (rank_at_issue BETWEEN 1 AND 10),
        status TEXT NOT NULL CHECK (status IN ('test', 'succeeded', 'failed')),
        error_message TEXT,
        processed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ranking_bonus_ledger_next
        (id, request_id, user_id, external_order_id, member_id, amount, rank_at_issue, status, error_message, processed_at, created_at)
      SELECT id, request_id, user_id, external_order_id, member_id, amount, rank_at_issue, status, error_message, processed_at, created_at
        FROM ranking_bonus_ledger;
      DROP TABLE ranking_bonus_ledger;
      ALTER TABLE ranking_bonus_ledger_next RENAME TO ranking_bonus_ledger;
    `);
  })();
}
db.exec("CREATE INDEX IF NOT EXISTS idx_ranking_bonus_user ON ranking_bonus_ledger(user_id, status)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_bonus_request ON ranking_bonus_ledger(request_id)");
