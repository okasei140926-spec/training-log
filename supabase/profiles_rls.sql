-- public.profiles の RLS / 権限定義
-- 2026-10-24 時点の本番状態を記録したもの
-- このファイルは記録用。実行は Supabase ダッシュボードで行う。

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 公開3列だけのビュー（2026-10-24 作成）
-- profiles は19列あるが、他人について読む必要があるのは3列だけ。
CREATE VIEW public.public_profiles AS
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

-- 確認用
-- SELECT privilege_type, grantee
-- FROM information_schema.role_table_grants
-- WHERE table_name = 'public_profiles'
-- ORDER BY grantee, privilege_type;
-- 期待: authenticated=SELECT のみ / anon=なし / postgres・service_role=全権限

-- TODO: 1.1.4 が App Store で普及したあとに以下を実行して SELECT を絞る
-- 実行前に、旧バージョンの利用者がいないことを必ず確認すること。
-- 旧版は profiles を直接読むため、先に絞ると
-- 友達一覧・フィード・コメント・招待が全て壊れる。
--
-- DROP POLICY "profiles are viewable by everyone" ON public.profiles;
-- CREATE POLICY "users can view own profile"
--   ON public.profiles FOR SELECT USING (auth.uid() = id);
