-- =============================================================
-- public.profiles RLS / ビュー / 権限定義 — 本番の正本
-- =============================================================
-- 用途: このファイルは本番 DB の権限・ポリシー状態を正確に記録した
--       唯一の正本である。pg_dump は --no-acl で生成されるため
--       GRANT / REVOKE が含まれない。データ復元後は必ずこのファイルを
--       実行し、権限状態を復元すること。
-- 冪等性: 何度実行しても同じ結果になる。
-- 実行方法: 必ず psql -v ON_ERROR_STOP=1 で実行すること。
--           ON_ERROR_STOP なしだとエラーを無視して COMMIT まで進み、
--           ポリシーが消えたまま残る等の中途半端な状態になる。
-- =============================================================

BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "users can insert own profile" ON public.profiles;
CREATE POLICY "users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "users can update own profile" ON public.profiles;
CREATE POLICY "users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 公開3列だけのビュー（2026-10-24 作成）
-- profiles は19列あるが、他人について読む必要があるのは3列だけ。
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT id, username, avatar1_url FROM public.profiles;

-- 所有者権限で実行し、元テーブルの RLS を迂回させる。
-- これがないと、将来 profiles の SELECT を絞ったときに
-- ビュー経由でも自分の行しか見えなくなる。
ALTER VIEW public.public_profiles SET (security_invoker = false);

-- 重要：Supabase は新規オブジェクトに GRANT ALL を自動付与する。
-- このビューは単一テーブルの単純 SELECT なので自動更新可能であり、
-- 書き込み権限を残すと RLS を迂回して他人の profiles を
-- UPDATE / DELETE できてしまう。
-- 必ず REVOKE ALL してから SELECT だけを付け直すこと。
REVOKE ALL ON public.public_profiles FROM authenticated;
REVOKE ALL ON public.public_profiles FROM anon;
GRANT SELECT ON public.public_profiles TO authenticated;

COMMIT;

-- 確認用
-- SELECT
--   CASE WHEN a.grantee = 0 THEN 'PUBLIC'
--        ELSE a.grantee::regrole::text END AS grantee,
--   a.privilege_type
-- FROM pg_class c
-- CROSS JOIN LATERAL aclexplode(c.relacl) a
-- WHERE c.relname = 'public_profiles'
--   AND c.relnamespace = 'public'::regnamespace
-- ORDER BY 1, 2;
-- 期待: authenticated=SELECT のみ / PUBLIC・anon=なし / postgres・service_role=全権限

-- TODO: 1.1.4 が App Store で普及したあとに以下を実行して SELECT を絞る
-- 実行前に、旧バージョンの利用者がいないことを必ず確認すること。
-- 旧版は profiles を直接読むため、先に絞ると
-- 友達一覧・フィード・コメント・招待が全て壊れる。
--
-- DROP POLICY "profiles are viewable by everyone" ON public.profiles;
-- CREATE POLICY "users can view own profile"
--   ON public.profiles FOR SELECT USING (auth.uid() = id);
