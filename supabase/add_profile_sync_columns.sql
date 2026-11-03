-- 設定の端末間同期に必要な3カラムを profiles に追加する
-- 実行日：2026-11-03
--
-- 追加するカラム：
--   custom_split_sequence  jsonb     カスタム分割の日程定義（配列）
--                                    preferred_split = 'custom' のときのみ使用。
--                                    例: [{"label":"A","bodyParts":["胸","肩"]}, ...]
--
--   week_start_day         smallint  週の開始曜日（0=日曜、1=月曜）
--                                    週間セット集計の起算日に使用。
--
--   weekly_set_targets     jsonb     部位別の週間目標セット数（オブジェクト）
--                                    例: {"胸": 12, "背中": 14, ...}
--
-- 後方互換メモ：
--   ADD COLUMN IF NOT EXISTS を使用しているため何度実行しても安全。
--   既存行はすべて NULL になる。NOT NULL 制約は付けていない。
--   旧バージョンのアプリはこれらの列を送信しないだけで、エラーにはならない。

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS custom_split_sequence  jsonb,
    ADD COLUMN IF NOT EXISTS week_start_day         smallint,
    ADD COLUMN IF NOT EXISTS weekly_set_targets     jsonb;
