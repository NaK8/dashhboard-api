-- Migration: Add extended patient fields to orders table
-- Run with: bun run db:migrate

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS patient_email     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS patient_city      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS patient_state     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS patient_zip_code  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS referral_source   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS allergy_info      TEXT,
  ADD COLUMN IF NOT EXISTS consent_data      JSONB;
