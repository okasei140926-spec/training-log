-- Migration: pump_pro_subscriptions を (user_id, provider) 複合PK に変更
-- 既存データは削除しない。Stripe と RevenueCat の行を物理分離することで
-- 互いの Webhook が上書きしないようにする。

-- ① stripe 固有カラムがなければ追加（冪等）
ALTER TABLE public.pump_pro_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- ② provider が NULL の行を 'stripe' に統一（念のため）
UPDATE public.pump_pro_subscriptions
  SET provider = 'stripe'
  WHERE provider IS NULL;

-- ③ provider = 'stripe' 以外の行から Stripe 固有カラムを NULL に
--    （異なるプロバイダーのIDが1行に混在した状態を解消）
UPDATE public.pump_pro_subscriptions
  SET stripe_customer_id     = NULL,
      stripe_subscription_id = NULL
  WHERE provider <> 'stripe';

-- ④ provider を NOT NULL に変更
ALTER TABLE public.pump_pro_subscriptions
  ALTER COLUMN provider SET NOT NULL;

-- ⑤ 旧 PRIMARY KEY を DROP（user_id 単独）
ALTER TABLE public.pump_pro_subscriptions
  DROP CONSTRAINT IF EXISTS pump_pro_subscriptions_pkey;

-- ⑥ 複合 PRIMARY KEY (user_id, provider) を追加
ALTER TABLE public.pump_pro_subscriptions
  ADD CONSTRAINT pump_pro_subscriptions_pkey
  PRIMARY KEY (user_id, provider);

-- ⑦ user_id → profiles の FK を再設定（旧PK定義のインライン FK が外れるため）
ALTER TABLE public.pump_pro_subscriptions
  DROP CONSTRAINT IF EXISTS pump_pro_subscriptions_user_id_fkey;
ALTER TABLE public.pump_pro_subscriptions
  ADD CONSTRAINT pump_pro_subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ⑧ stripe_customer_id による逆引き用インデックス
--    (getUserIdForCustomer で WHERE stripe_customer_id = ? を使うため)
CREATE INDEX IF NOT EXISTS idx_pump_pro_stripe_customer
  ON public.pump_pro_subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ⑨ RLS: ユーザーが自分の行を SELECT できるポリシー
--    サーバー側は service role で bypass するが、クライアント直読みの保険として設定
DROP POLICY IF EXISTS "users can read own pro subscriptions" ON public.pump_pro_subscriptions;
CREATE POLICY "users can read own pro subscriptions"
  ON public.pump_pro_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- ⑩ is_user_pump_pro 関数を再作成
--    WHERE user_id = ? は複合PK でも prefix 検索で効くため変更なし
--    「いずれかの provider が active かつ有効期限内」なら Pro
CREATE OR REPLACE FUNCTION public.is_user_pump_pro(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pump_pro_subscriptions
    WHERE user_id = p_user_id
      AND active = true
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;
