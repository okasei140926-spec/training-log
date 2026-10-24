-- 加重自重（加重懸垂・加重ディップスなど）の加算重量を保存する列
-- 2026-10-24 実行済み（本番 Supabase ダッシュボードにて）

ALTER TABLE public.workout_sets
  ADD COLUMN IF NOT EXISTS added_weight_kg numeric;

-- 設計メモ：
--   set.weight は "BW" のまま変えない。自重判定（weight === "BW"）は全箇所共通。
--   加重分は added_weight_kg に持つ。未設定（通常の自重）は NULL。
--   実効重量 = body_weight_kg + added_weight_kg で計算。
--   負値（アシスト懸垂）は現バージョンではスコープ外。0 扱いで処理される。
