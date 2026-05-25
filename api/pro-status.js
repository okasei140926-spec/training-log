import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const authSupabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

const adminSupabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const buildPlanState = (subscription) => {
  const expiresAt = subscription?.expires_at || null;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const isWithinPaidPeriod = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
  const isActive = subscription?.active === true;

  if (isActive) {
    return {
      isPro: true,
      status: "pro",
      label: "Pro",
      renewalStopped: false,
      expiresAt,
    };
  }

  if (isWithinPaidPeriod) {
    return {
      isPro: true,
      status: "canceled_active",
      label: "Pro解約済み",
      renewalStopped: true,
      expiresAt,
    };
  }

  return {
    isPro: false,
    status: "free",
    label: "Free",
    renewalStopped: false,
    expiresAt,
  };
};

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
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

  const { data: subscription, error: subscriptionError } = await adminSupabase
    .from("pump_pro_subscriptions")
    .select("active, provider, expires_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subscriptionError) {
    console.error("pro status lookup failed", subscriptionError);
    return res.status(500).json({ error: "Pump Pro状態の取得に失敗しました。" });
  }

  const usageDate = getTodayKeyInTokyo();
  const { data: usageRow } = await adminSupabase
    .from("ai_chat_usage")
    .select("usage_count")
    .eq("user_id", user.id)
    .eq("usage_date", usageDate)
    .maybeSingle();

  const dailyLimit = 5;
  const usageCount = Number(usageRow?.usage_count || 0);
  const plan = buildPlanState(subscription);

  return res.status(200).json({
    success: true,
    plan,
    aiUsage: {
      usageDate,
      isPro: plan.isPro,
      usageCount,
      remaining: plan.isPro ? null : Math.max(0, dailyLimit - usageCount),
      dailyLimit,
    },
  });
}
