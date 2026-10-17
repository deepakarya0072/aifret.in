-- Add currency metadata used by authorized affiliate imports.
-- Run after 0001_cloudflare_schema.sql for new databases and on existing
-- AIFRET D1 databases that were created before currency support was added.
ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE product_offers ADD COLUMN currency TEXT NOT NULL DEFAULT 'INR';
