-- PharmaStock schema (migration 001)
--
-- Core modelling rule: `drugs` holds identity, `batches` hold stock.
-- There is deliberately NO quantity column on `drugs` - a drug's availability
-- is always the sum of its batches, which is what makes per-batch expiry
-- tracking correct rather than bolted on.
--
-- Every stock change writes an append-only row to `stock_ledger`, so any
-- quantity on screen can be traced back to the movements that produced it.

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  username          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  full_name         TEXT    NOT NULL,
  password_hash     TEXT    NOT NULL,
  role              TEXT    NOT NULL CHECK (role IN ('DOCTOR', 'PHARMACIST', 'ASSISTANT')),
  -- Per-user override behind the ASSISTANT "record received stock if permitted"
  -- requirement. Ignored for other roles.
  can_receive_stock INTEGER NOT NULL DEFAULT 1 CHECK (can_receive_stock IN (0, 1)),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at     TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ---------------------------------------------------------------------------
-- Drug catalogue (identity only - no quantities live here)
-- ---------------------------------------------------------------------------

CREATE TABLE drugs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT    UNIQUE COLLATE NOCASE,   -- drug code / barcode, optional
  name                TEXT    NOT NULL COLLATE NOCASE,
  generic_name        TEXT    COLLATE NOCASE,
  strength            TEXT,                            -- '500mg', '125mg/5ml'
  form                TEXT    NOT NULL DEFAULT 'TABLET'
                              CHECK (form IN ('TABLET', 'CAPSULE', 'SYRUP', 'INJECTION',
                                              'CREAM', 'OINTMENT', 'DROPS', 'INHALER',
                                              'SUPPOSITORY', 'PATCH', 'OTHER')),
  unit                TEXT    NOT NULL DEFAULT 'unit', -- 'tablet', 'ml', 'vial', 'tube'
  min_stock_level     INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_level >= 0),
  default_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  storage_location    TEXT,
  notes               TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_drugs_name ON drugs(name);
CREATE INDEX idx_drugs_generic ON drugs(generic_name);
CREATE INDEX idx_drugs_code ON drugs(code);
CREATE INDEX idx_drugs_active ON drugs(is_active);

-- ---------------------------------------------------------------------------
-- Batches - the actual physical stock
-- ---------------------------------------------------------------------------

CREATE TABLE batches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_id           INTEGER NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
  -- '' means "supplier gave no batch number". Stored as '' rather than NULL so
  -- the UNIQUE constraint below actually fires (SQLite treats NULLs as distinct).
  batch_number      TEXT    NOT NULL DEFAULT '' COLLATE NOCASE,
  expiry_date       TEXT    NOT NULL,               -- YYYY-MM-DD
  supplier_id       INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  -- Last line of defence beneath the application-level checks.
  quantity_on_hand  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  unit_cost         REAL,
  storage_location  TEXT,
  first_received_at TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  -- Same drug + same batch number + same expiry = same physical stock, so a
  -- repeat delivery tops up the existing row. A different expiry always makes
  -- a separate batch, which is what keeps expiry tracking honest.
  UNIQUE (drug_id, batch_number, expiry_date)
);

CREATE INDEX idx_batches_drug ON batches(drug_id);
CREATE INDEX idx_batches_expiry ON batches(expiry_date);
CREATE INDEX idx_batches_number ON batches(batch_number);
CREATE INDEX idx_batches_onhand ON batches(quantity_on_hand);

-- ---------------------------------------------------------------------------
-- Goods receipts (stock in)
-- ---------------------------------------------------------------------------

CREATE TABLE goods_receipts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no          TEXT    NOT NULL UNIQUE,       -- GRN-2026-0001
  supplier_id         INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_no          TEXT,
  order_ref           TEXT,
  received_date       TEXT    NOT NULL,              -- YYYY-MM-DD
  received_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes               TEXT,
  total_cost          REAL    NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_receipts_date ON goods_receipts(received_date DESC);
CREATE INDEX idx_receipts_supplier ON goods_receipts(supplier_id);

CREATE TABLE goods_receipt_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  goods_receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE RESTRICT,
  drug_id          INTEGER NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
  batch_id         INTEGER NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  batch_number     TEXT    NOT NULL DEFAULT '',
  expiry_date      TEXT    NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost        REAL
);

CREATE INDEX idx_receipt_lines_receipt ON goods_receipt_lines(goods_receipt_id);
CREATE INDEX idx_receipt_lines_drug ON goods_receipt_lines(drug_id);

-- ---------------------------------------------------------------------------
-- Dispensing (stock out)
-- ---------------------------------------------------------------------------

CREATE TABLE dispenses (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  dispense_no          TEXT    NOT NULL UNIQUE,      -- DSP-2026-0001
  dispensed_at         TEXT    NOT NULL,             -- YYYY-MM-DD HH:MM:SS
  patient_ref          TEXT,
  patient_name         TEXT,
  prescriber           TEXT,
  notes                TEXT,
  dispensed_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_dispenses_at ON dispenses(dispensed_at DESC);
CREATE INDEX idx_dispenses_patient ON dispenses(patient_ref);

CREATE TABLE dispense_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dispense_id INTEGER NOT NULL REFERENCES dispenses(id) ON DELETE RESTRICT,
  drug_id     INTEGER NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
  batch_id    INTEGER NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  quantity    INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX idx_dispense_lines_dispense ON dispense_lines(dispense_id);
CREATE INDEX idx_dispense_lines_drug ON dispense_lines(drug_id);

-- ---------------------------------------------------------------------------
-- Manual adjustments (damage, count corrections, expired write-offs, returns)
-- ---------------------------------------------------------------------------

CREATE TABLE stock_adjustments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_no  TEXT    NOT NULL UNIQUE,            -- ADJ-2026-0001
  drug_id        INTEGER NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
  batch_id       INTEGER NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),   -- signed
  reason         TEXT    NOT NULL CHECK (reason IN ('DAMAGE', 'EXPIRED_DISPOSAL',
                                                    'COUNT_CORRECTION', 'RETURN_TO_SUPPLIER',
                                                    'LOST', 'OTHER')),
  notes          TEXT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_adjustments_drug ON stock_adjustments(drug_id);
CREATE INDEX idx_adjustments_created ON stock_adjustments(created_at DESC);

-- ---------------------------------------------------------------------------
-- The ledger: APPEND ONLY. Never UPDATE, never DELETE.
-- Corrections are new offsetting rows, so history stays truthful.
-- ---------------------------------------------------------------------------

CREATE TABLE stock_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at     TEXT    NOT NULL,
  drug_id         INTEGER NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
  batch_id        INTEGER NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  change_type     TEXT    NOT NULL CHECK (change_type IN ('OPENING', 'RECEIVE', 'DISPENSE',
                                                          'ADJUST_IN', 'ADJUST_OUT',
                                                          'WRITE_OFF_EXPIRED', 'RETURN')),
  quantity_delta  INTEGER NOT NULL,                  -- signed: + in, - out
  balance_after   INTEGER NOT NULL,                  -- batch balance after this movement
  reference_table TEXT,
  reference_id    INTEGER,
  reason          TEXT,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_ledger_drug_time ON stock_ledger(drug_id, occurred_at DESC);
CREATE INDEX idx_ledger_batch ON stock_ledger(batch_id);
CREATE INDEX idx_ledger_type ON stock_ledger(change_type);
CREATE INDEX idx_ledger_occurred ON stock_ledger(occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Settings and audit
-- ---------------------------------------------------------------------------

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT    NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT,                                   -- JSON
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE sessions (
  sid        TEXT PRIMARY KEY,
  data       TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Views - all expiry / stock status logic lives here so every screen and
-- report agrees. Change the threshold setting and everything re-colours.
-- ---------------------------------------------------------------------------

CREATE VIEW v_batch_status AS
SELECT
  b.id,
  b.drug_id,
  b.batch_number,
  b.expiry_date,
  b.supplier_id,
  b.quantity_received,
  b.quantity_on_hand,
  b.unit_cost,
  b.storage_location,
  b.first_received_at,
  b.created_at,
  CAST(julianday(b.expiry_date) - julianday(date('now', 'localtime')) AS INTEGER)
    AS days_to_expiry,
  CASE
    WHEN julianday(b.expiry_date) < julianday(date('now', 'localtime'))
      THEN 'EXPIRED'
    WHEN julianday(b.expiry_date) - julianday(date('now', 'localtime'))
         <= (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'expiry_alert_days')
      THEN 'EXPIRING_SOON'
    ELSE 'GOOD'
  END AS expiry_status
FROM batches b;

CREATE VIEW v_drug_stock AS
SELECT
  s.*,
  CASE
    WHEN s.available_qty = 0 THEN 'OUT_OF_STOCK'
    WHEN s.min_stock_level > 0 AND s.available_qty <= s.min_stock_level THEN 'LOW'
    ELSE 'OK'
  END AS stock_status,
  CASE
    WHEN s.expired_qty > 0 THEN 'EXPIRED'
    WHEN s.expiring_soon_qty > 0 THEN 'EXPIRING_SOON'
    WHEN s.total_qty > 0 THEN 'GOOD'
    ELSE 'NONE'
  END AS expiry_status
FROM (
  SELECT
    d.id AS drug_id,
    d.code,
    d.name,
    d.generic_name,
    d.strength,
    d.form,
    d.unit,
    d.min_stock_level,
    d.default_supplier_id,
    d.storage_location,
    d.is_active,
    -- Expired stock cannot be dispensed, so it is excluded from availability
    -- but still reported separately - nothing silently disappears.
    COALESCE(SUM(CASE WHEN bs.expiry_status <> 'EXPIRED'
                      THEN bs.quantity_on_hand ELSE 0 END), 0) AS available_qty,
    COALESCE(SUM(CASE WHEN bs.expiry_status = 'EXPIRED'
                      THEN bs.quantity_on_hand ELSE 0 END), 0) AS expired_qty,
    COALESCE(SUM(CASE WHEN bs.expiry_status = 'EXPIRING_SOON'
                      THEN bs.quantity_on_hand ELSE 0 END), 0) AS expiring_soon_qty,
    COALESCE(SUM(bs.quantity_on_hand), 0) AS total_qty,
    MIN(CASE WHEN bs.quantity_on_hand > 0 AND bs.expiry_status <> 'EXPIRED'
             THEN bs.expiry_date END) AS earliest_expiry,
    COUNT(CASE WHEN bs.quantity_on_hand > 0 THEN 1 END) AS batch_count
  FROM drugs d
  LEFT JOIN v_batch_status bs ON bs.drug_id = d.id
  GROUP BY d.id
) s;
