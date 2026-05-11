-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Multi-location support + signature + driving license
-- Run this once against your production PostgreSQL database.
-- All columns are nullable — safe for existing rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Expand scheduleTime to hold in-house time ranges ("11:00 AM to 01:00 PM")
ALTER TABLE orders
  ALTER COLUMN schedule_time TYPE varchar(30);

-- 2. Location column: 'dallas' | 'houston'
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS location varchar(20);

-- 3. Patient signature — base64 PNG, present on all 4 form types
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS signature_base64 text;

-- 4. Driving license — WordPress upload URL, present on in-house forms only
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS driving_license_url text;

-- 5. Index on location for fast per-location filtering
CREATE INDEX IF NOT EXISTS idx_orders_location ON orders (location);
