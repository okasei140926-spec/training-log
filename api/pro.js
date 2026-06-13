import { createClient } from "@supabase/supabase-js";

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const authenticateUser = async (req) => {
  const accessToken = getBearerToken(req);
  if (!accessToken) return { user: null, error: "ログインが必要です" };
  const { data: { user }, error } = await authSupabase.auth.getUser(accessToken);
  if (error || !user?.id) return { user: null, error: "ログインが必要です" };
  return { user };
};

const buildPlanState = (subscription) => {
  const expiresAt = subscription?.expires_at || null;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const isWithinPaidPeriod = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
  const isActive = subscription?.active === true;

  if (isActive) {
    return { isPro: true, status: "pro", label: "Pro", renewalStopped: false, expiresAt };
  }

  if (isWithinPaidPeriod) {
    return { isPro: true, status: "canceled_active", label: "Pro解約済み", renewalStopped: true, expiresAt };
  }

  return { isPro: false, status: "free", label: "Free", renewalStopped: false, expiresAt };
};

// GET /api/pro  — pro-status
async function handleStatus(req, res) {
  const { user, error: authError } = await authenticateUser(req);
  if (authError || !user) return res.status(401).json({ error: authError });

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

// POST /api/pro?action=activate-dev  — activate-pro-dev
async function handleActivateDev(req, res) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const { user, error: authError } = await authenticateUser(req);
  if (authError || !user) return res.status(401).json({ error: authError });

  const { error: upsertError } = await adminSupabase
    .from("pump_pro_subscriptions")
    .upsert(
      {
        user_id: user.id,
        active: true,
        provider: "dev",
        expires_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    console.error("activate dev pro failed", upsertError);
    return res.status(500).json({ error: "Pump Proの有効化に失敗しました。" });
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
    aiUsage: {
      usageDate,
      isPro: true,
      usageCount: Number(usageRow?.usage_count || 0),
      remaining: null,
      dailyLimit: 5,
    },
  });
}

// POST /api/pro?action=deactivate-dev  — deactivate-pro-dev
async function handleDeactivateDev(req, res) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const { user, error: authError } = await authenticateUser(req);
  if (authError || !user) return res.status(401).json({ error: authError });

  const nowIso = new Date().toISOString();
  const { error: upsertError } = await adminSupabase
    .from("pump_pro_subscriptions")
    .upsert(
      {
        user_id: user.id,
        active: false,
        provider: "dev",
        expires_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    console.error("deactivate dev pro failed", upsertError);
    return res.status(500).json({ error: "Pump Proの解除に失敗しました。" });
  }

  const usageDate = getTodayKeyInTokyo();
  const { data: usageRow } = await adminSupabase
    .from("ai_chat_usage")
    .select("usage_count")
    .eq("user_id", user.id)
    .eq("usage_date", usageDate)
    .maybeSingle();

  const usageCount = Number(usageRow?.usage_count || 0);
  const dailyLimit = 5;

  return res.status(200).json({
    success: true,
    aiUsage: {
      usageDate,
      isPro: false,
      usageCount,
      remaining: Math.max(0, dailyLimit - usageCount),
      dailyLimit,
    },
  });
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  if (!authSupabase || !adminSupabase) {
    return res.status(500).json({ error: "DB設定が不足しています。" });
  }

  // GET /api/pro → status
  if (req.method === "GET") {
    return handleStatus(req, res);
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = req.query.action;

  switch (action) {
    case "activate-dev":
      return handleActivateDev(req, res);
    case "deactivate-dev":
      return handleDeactivateDev(req, res);
    default:
      return res.status(404).json({ error: "Unknown action" });
  }
}
