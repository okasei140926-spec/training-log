import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
  process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
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

const AI_DAILY_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const rateLimitStore = new Map();

function getSupabaseConfigStatus() {
  const missingEnv = [];
  if (!supabaseUrl) missingEnv.push("REACT_APP_SUPABASE_URL");
  if (!supabaseAnonKey) missingEnv.push("REACT_APP_SUPABASE_ANON_KEY");
  if (!supabaseServiceRoleKey) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");

  return {
    missingEnv,
    authSupabaseReady: Boolean(supabase),
    adminSupabaseReady: Boolean(adminSupabase),
  };
}

function parseWorkoutPlanFromText(text) {
  const rawText = typeof text === "string" ? text : "";
  const marker = "PUMP_WORKOUT_PLAN_JSON:";
  const markerIndex = rawText.lastIndexOf(marker);
  if (markerIndex < 0) return { text: rawText.trim(), workoutPlan: [] };

  const visibleText = rawText.slice(0, markerIndex).trim();
  const jsonText = rawText.slice(markerIndex + marker.length).trim();

  try {
    const parsed = JSON.parse(jsonText);
    return {
      text: visibleText,
      workoutPlan: Array.isArray(parsed) ? parsed : [],
    };
  } catch {
    return {
      text: visibleText,
      workoutPlan: [],
    };
  }
}

const getTodayKeyInTokyo = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function checkRateLimit(userId) {
  const now = Date.now();
  const current = rateLimitStore.get(userId);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(userId, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  rateLimitStore.set(userId, current);
  return { allowed: true };
}

async function ensureProfileForUser(user) {
  if (!user?.id) return;

  const { data: existingProfile, error: lookupError } = await adminSupabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existingProfile?.id) return;

  const metadata = user.user_metadata || {};
  const emailPrefix = String(user.email || "").split("@")[0] || "";
  const baseUsername = String(
    metadata.user_name ||
      metadata.preferred_username ||
      metadata.username ||
      metadata.full_name ||
      metadata.name ||
      emailPrefix ||
      "pump-user"
  )
    .trim()
    .replace(/\s+/g, "")
    .slice(0, 20);

  const candidates = [
    `${baseUsername || "pumpuser"}-${user.id.slice(0, 4)}`,
    `${baseUsername || "pumpuser"}-${user.id.slice(4, 8)}`,
    `pumpuser-${user.id.slice(0, 8)}`,
  ].filter(Boolean);

  for (const username of candidates) {
    const { error } = await adminSupabase.from("profiles").insert({
      id: user.id,
      username,
    });

    if (!error) return;
    if (error.code !== "23505") throw error;

    const { data: profileAfterConflict, error: conflictLookupError } = await adminSupabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (conflictLookupError) throw conflictLookupError;
    if (profileAfterConflict?.id) return;
  }

  throw new Error("プロフィールの初期作成に失敗しました。");
}

async function reserveAiChatUsage(userId) {
  const usageDate = getTodayKeyInTokyo();
  const { data, error } = await adminSupabase.rpc("reserve_ai_chat_usage", {
    p_user_id: userId,
    p_usage_date: usageDate,
    p_daily_limit: AI_DAILY_LIMIT,
  });

  if (error) throw error;

  const usage = Array.isArray(data) ? data[0] : data;
  return {
    usageDate,
    allowed: Boolean(usage?.allowed),
    isPro: Boolean(usage?.is_pro),
    usageCount: Number(usage?.usage_count || 0),
    remaining: usage?.remaining == null ? null : Number(usage.remaining),
    dailyLimit: AI_DAILY_LIMIT,
  };
}

async function getTodayAiUsageCount(userId, usageDate) {
  const { data, error } = await adminSupabase
    .from("ai_chat_usage")
    .select("usage_count")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle();

  if (error) throw error;
  return Number(data?.usage_count || 0);
}

async function getPumpProStatus(userId) {
  const { data, error } = await adminSupabase
    .from("pump_pro_subscriptions")
    .select("active, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  const expiresAt = data?.expires_at ? new Date(data.expires_at).getTime() : null;
  const isNotExpired = !expiresAt || expiresAt > Date.now();
  return Boolean(data?.active && isNotExpired);
}

async function refundAiChatUsage(userId, usageDate) {
  if (!usageDate) return null;

  const { data, error } = await adminSupabase.rpc("refund_ai_chat_usage", {
    p_user_id: userId,
    p_usage_date: usageDate,
  });

  if (error) throw error;

  const usage = Array.isArray(data) ? data[0] : data;
  return {
    usageDate,
    isPro: false,
    usageCount: Number(usage?.usage_count || 0),
    remaining: Number(usage?.remaining || 0),
    dailyLimit: AI_DAILY_LIMIT,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!supabase || !adminSupabase) {
    const configStatus = getSupabaseConfigStatus();
    console.error("Supabase client initialization failed for /api/chat", configStatus);
    return res.status(500).json({
      error: "AI利用回数のDB設定が不足しています。",
      detail: adminSupabase
        ? "Supabase認証クライアントを初期化できませんでした。"
        : "Supabase管理クライアントを初期化できませんでした。",
      config: configStatus,
    });
  }

  if (!process.env.CLAUDE_API_KEY) {
    return res.status(500).json({ error: "Claude APIキーが設定されていません。" });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user?.id) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const rateLimit = checkRateLimit(user.id);
  if (!rateLimit.allowed) {
    return res
      .status(429)
      .json({ error: "AI Coachの利用が集中しています。少し待ってからお試しください。", retryAfterSec: rateLimit.retryAfterSec });
  }

  const requestBody = req.body && typeof req.body === "object" ? req.body : {};
  const clientProHint = requestBody?.clientState?.isPro === true;
  let reservedUsage;
  const usageDate = getTodayKeyInTokyo();
  let isPro = clientProHint;
  try {
    await ensureProfileForUser(user);

    if (!isPro) {
      isPro = await getPumpProStatus(user.id);
    }

    if (isPro) {
      let usageCount = 0;
      try {
        usageCount = await getTodayAiUsageCount(user.id, usageDate);
      } catch (usageCountError) {
        console.warn("pro ai usage count lookup failed; continuing without blocking", usageCountError);
      }

      reservedUsage = {
        usageDate,
        allowed: true,
        isPro: true,
        usageCount,
        remaining: null,
        dailyLimit: AI_DAILY_LIMIT,
      };
    } else {
      reservedUsage = await reserveAiChatUsage(user.id);
    }
  } catch (usageError) {
    console.error("ai usage/pro check failed", usageError);
    return res.status(500).json({ error: "AI利用回数の確認に失敗しました。" });
  }

  if (!reservedUsage.allowed) {
    return res.status(403).json({
      error: "今日の無料AI相談回数を使い切りました",
      aiUsage: reservedUsage,
    });
  }

  const { messages, coachContext } = requestBody;
  const safeContext = coachContext && typeof coachContext === "object" ? coachContext : {};

  const systemPrompt = `あなたは筋トレ記録アプリ PUMP のAI Coachです。ユーザーの実際の記録だけを元に、短く分かりやすく答えてください。

モード: ${safeContext.mode || "general"}
レベル: ${safeContext.level || "standard"}
対象日: ${safeContext.targetDate || "指定なし"}

対象日の記録:
${safeContext.targetWorkoutContext || "対象日の記録はありません。"}

直近の記録要約:
${safeContext.recentSummaryContext || "最近の記録はありません。"}

最新の記録:
${safeContext.latestWorkoutContext || "最新の記録はありません。"}

以下のルールを必ず守ってください：
- 日本語のみで返答する
- マークダウン記法（**太字**、## 見出し、- リスト、アスタリスク等）は一切使わない
- 箇条書きにする場合は「・」を使う
- 基本は3〜6行で返す
- 1メッセージ1テーマで返す
- モバイルで読みやすい短さにする
- 記録分析では、対象日の記録だけを使う
- 対象日の記録に無い種目・部位・重量・回数を推測で追加しない
- 実データに無い改善提案を断定しない
- 対象日の記録が無ければ「その日の記録は見つかりませんでした」と素直に伝える
- 初心者モードでは、種目数を少なめにし、専門用語を減らし、「まずはこれだけでOKです」と分かる形にする
- 初心者モードでは、1回の提案は最大3〜4種目、セット数も簡単にする
- 高重量低repなどの表現は、必要な時だけやさしい言葉に言い換える
- 自然な話し言葉で書く
- メニュー提案モードでは、返答の最後に必ず次の形式でアプリ用JSONを1行だけ付ける
PUMP_WORKOUT_PLAN_JSON: [{"exerciseName":"種目名","bodyPart":"胸","unit":"kg","sets":[{"weight":80,"reps":8},{"weight":80,"reps":8},{"weight":75,"reps":8}]}]
- 自重種目は unit を "bodyweight" にし、sets は [{"reps":10},{"reps":10}] のようにする
- 重量が不明な時は sets を空配列にせず、提案したセット数ぶん [{"weight":0,"reps":0}] を入れる
- メニュー提案ではない時は PUMP_WORKOUT_PLAN_JSON を付けない`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (!reservedUsage.isPro) {
        try {
          const refundedUsage = await refundAiChatUsage(user.id, reservedUsage.usageDate);
          reservedUsage = refundedUsage || reservedUsage;
        } catch (refundError) {
          console.error("refund ai usage failed", refundError);
        }
      }
      return res.status(response.status).json({
        error: data?.error?.message || "AI Coachの応答に失敗しました",
        aiUsage: reservedUsage,
      });
    }
    const replyText = data?.content?.[0]?.text || "";
    const parsedWorkoutPlan = parseWorkoutPlanFromText(replyText);
    const nextContent = Array.isArray(data?.content)
      ? data.content.map((part, index) =>
          index === 0 && part?.type === "text"
            ? { ...part, text: parsedWorkoutPlan.text || part.text }
            : part
        )
      : data?.content;

    return res.status(response.status).json({
      ...data,
      content: nextContent,
      workoutPlan: parsedWorkoutPlan.workoutPlan,
      aiUsage: reservedUsage,
    });
  } catch {
    if (reservedUsage && !reservedUsage.isPro) {
      try {
        const refundedUsage = await refundAiChatUsage(user.id, reservedUsage.usageDate);
        reservedUsage = refundedUsage || reservedUsage;
      } catch (refundError) {
        console.error("refund ai usage failed", refundError);
      }
    }
    return res.status(500).json({ error: "AI Coachの応答に失敗しました", aiUsage: reservedUsage });
  }
}
