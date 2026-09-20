-- Migration: add gender column to profiles
-- Run in Supabase SQL editor (Dashboard → SQL Editor)

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS gender text;
