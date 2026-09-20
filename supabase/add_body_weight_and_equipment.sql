-- Migration: add body_weight_kg + weight_updated_at to profiles
-- Run in Supabase SQL editor (Dashboard → SQL Editor)

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS body_weight_kg  numeric,
    ADD COLUMN IF NOT EXISTS weight_updated_at timestamptz;

-- Migration: add equipment column to custom_exercises
ALTER TABLE custom_exercises
    ADD COLUMN IF NOT EXISTS equipment text;
