import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const authSupabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const adminSupabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const getBearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
};

const getTodayKeyInTokyo = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    return res.status(500).json({ error: "Stripe設定が不足しています。" });
  }

  if (!authSupabase || !adminSupabase) {
    return res.status(500).json({ error: "DB設定が不足しています。" });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const {
    data: { user },
    error: userError,
  } = await authSupabase.auth.getUser(accessToken);

  if (userError || !user?.id) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const { session_id: sessionId } = req.body || {};
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "session_idが必要です" });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });

  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
  } catch (err) {
    console.error("stripe session retrieve failed", err);
    return res.status(400).json({ error: "Stripeセッションの取得に失敗しました。" });
  }

  if (checkoutSession.payment_status !== "paid") {
    return res.status(400).json({ error: "支払いが完了していません。" });
  }

  const sub = checkoutSession.subscription;
  const subUserId = sub?.metadata?.supabase_user_id || checkoutSession.metadata?.supabase_user_id;

  if (subUserId && subUserId !== user.id) {
    return res.status(403).json({ error: "セッションが一致しません。" });
  }

  const stripeCustomerId = checkoutSession.customer;
  const stripeSubscriptionId = typeof sub === "string" ? sub : sub?.id;
  const expiresAt = sub?.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const { error: upsertError } = await adminSupabase
    .from("pump_pro_subscriptions")
    .upsert(
      {
        user_id: user.id,
        active: true,
        provider: "stripe",
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId || null,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    console.error("activate stripe checkout upsert failed", upsertError);
    return res.status(500).json({ error: "Pro有効化に失敗しました。" });
  }

  const usageDate = getTodayKeyInTokyo();
  const { data: usageRow } = await adminSupabase
    .from("ai_chat_usage")
    .select("usage_count")
    .eq("user_id", user.id)
    .eq("usage_date", usageDate)
    .maybeSingle();

  return res.status(200).json({
    success: true,
    isPro: true,
    aiUsage: {
      usageDate,
      isPro: true,
      usageCount: Number(usageRow?.usage_count || 0),
      remaining: null,
      dailyLimit: 5,
    },
  });
}
