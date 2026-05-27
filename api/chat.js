import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
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

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getSupabaseConfigStatus() {
  const missingEnv = [];
  if (!supabaseUrl) missingEnv.push("SUPABASE_URL or REACT_APP_SUPABASE_URL");
  if (!supabaseAnonKey) missingEnv.push("SUPABASE_ANON_KEY or REACT_APP_SUPABASE_ANON_KEY");
  if (!supabaseServiceRoleKey) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");

  return {
    missingEnv,
    authSupabaseReady: Boolean(supabase),
    adminSupabaseReady: Boolean(adminSupabase),
  };
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id || null,
    email: user.email || null,
  };
}

function serializeSupabaseError(error) {
  if (!error) return null;
  return {
    code: error.code || null,
    message: error.message || String(error),
    details: error.details || null,
    hint: error.hint || null,
  };
}

function logSupabaseUsageStep(step, { user, usageDate, tableName, action, conditions, data, error }) {
  const logPayload = {
    step,
    user: serializeUser(user),
    userId: user?.id || conditions?.user_id || null,
    usageDate: usageDate || conditions?.usage_date || null,
    tableName,
    action,
    conditions,
    data,
    error: serializeSupabaseError(error),
  };

  if (error) {
    console.error("ai usage supabase step failed", logPayload);
  } else {
    console.log("ai usage supabase step", logPayload);
  }
}

function createSupabaseStepError(message, debug, error) {
  const wrapped = new Error(message);
  wrapped.cause = error;
  wrapped.debug = {
    ...debug,
    error: serializeSupabaseError(error),
  };
  return wrapped;
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

  logSupabaseUsageStep("profile lookup before ai usage", {
    user,
    tableName: "profiles",
    action: "select id",
    conditions: { id: user.id },
    data: existingProfile,
    error: lookupError,
  });

  if (lookupError) {
    throw createSupabaseStepError(
      "profiles lookup failed",
      { tableName: "profiles", action: "select", conditions: { id: user.id } },
      lookupError
    );
  }
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

    logSupabaseUsageStep("profile insert before ai usage", {
      user,
      tableName: "profiles",
      action: "insert",
      conditions: { id: user.id, username },
      data: error ? null : { id: user.id, username },
      error,
    });

    if (!error) return;
    if (error.code !== "23505") {
      throw createSupabaseStepError(
        "profiles insert failed",
        { tableName: "profiles", action: "insert", conditions: { id: user.id, username } },
        error
      );
    }

    const { data: profileAfterConflict, error: conflictLookupError } = await adminSupabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    logSupabaseUsageStep("profile conflict lookup before ai usage", {
      user,
      tableName: "profiles",
      action: "select id",
      conditions: { id: user.id },
      data: profileAfterConflict,
      error: conflictLookupError,
    });

    if (conflictLookupError) {
      throw createSupabaseStepError(
        "profiles conflict lookup failed",
        { tableName: "profiles", action: "select", conditions: { id: user.id } },
        conflictLookupError
      );
    }
    if (profileAfterConflict?.id) return;
  }

  throw new Error("プロフィールの初期作成に失敗しました。");
}

async function reserveAiChatUsage(user) {
  const userId = user?.id;
  const usageDate = getTodayKeyInTokyo();
  const tableName = "ai_chat_usage";
  const conditions = { user_id: userId, usage_date: usageDate };
  const { data: currentUsage, error: selectError } = await adminSupabase
    .from(tableName)
    .select("usage_count")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle();

  logSupabaseUsageStep("ai usage select before reserve", {
    user,
    usageDate,
    tableName,
    action: "select usage_count",
    conditions,
    data: currentUsage,
    error: selectError,
  });

  if (selectError) {
    throw createSupabaseStepError(
      "ai_chat_usage select failed",
      { tableName, action: "select", conditions, usageDate },
      selectError
    );
  }

  const currentCount = Number(currentUsage?.usage_count || 0);
  if (currentCount >= AI_DAILY_LIMIT) {
    return {
      usageDate,
      allowed: false,
      isPro: false,
      usageCount: currentCount,
      remaining: 0,
      dailyLimit: AI_DAILY_LIMIT,
    };
  }

  const nextCount = currentCount + 1;
  const mutation = currentUsage
    ? adminSupabase
        .from(tableName)
        .update({ usage_count: nextCount })
        .eq("user_id", userId)
        .eq("usage_date", usageDate)
        .select("usage_count")
        .maybeSingle()
    : adminSupabase
        .from(tableName)
        .insert({ user_id: userId, usage_date: usageDate, usage_count: nextCount })
        .select("usage_count")
        .maybeSingle();

  const { data: reservedUsage, error: reserveError } = await mutation;

  logSupabaseUsageStep("ai usage reserve mutation", {
    user,
    usageDate,
    tableName,
    action: currentUsage ? "update usage_count" : "insert usage_count",
    conditions,
    data: reservedUsage,
    error: reserveError,
  });

  if (reserveError) {
    throw createSupabaseStepError(
      "ai_chat_usage reserve mutation failed",
      { tableName, action: currentUsage ? "update" : "insert", conditions, usageDate },
      reserveError
    );
  }

  const reservedCount = Number(reservedUsage?.usage_count || nextCount);
  return {
    usageDate,
    allowed: true,
    isPro: false,
    usageCount: reservedCount,
    remaining: Math.max(0, AI_DAILY_LIMIT - reservedCount),
    dailyLimit: AI_DAILY_LIMIT,
  };
}

async function getTodayAiUsageCount(user, usageDate) {
  const userId = user?.id;
  const tableName = "ai_chat_usage";
  const conditions = { user_id: userId, usage_date: usageDate };
  const { data, error } = await adminSupabase
    .from(tableName)
    .select("usage_count")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle();

  logSupabaseUsageStep("ai usage count lookup", {
    user,
    usageDate,
    tableName,
    action: "select usage_count",
    conditions,
    data,
    error,
  });

  if (error) {
    throw createSupabaseStepError(
      "ai_chat_usage count lookup failed",
      { tableName, action: "select", conditions, usageDate },
      error
    );
  }
  return Number(data?.usage_count || 0);
}

async function getPumpProStatus(user) {
  const userId = user?.id;
  const tableName = "pump_pro_subscriptions";
  const conditions = { user_id: userId };
  const { data, error } = await adminSupabase
    .from(tableName)
    .select("active, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  logSupabaseUsageStep("pump pro status lookup", {
    user,
    tableName,
    action: "select active, expires_at",
    conditions,
    data,
    error,
  });

  if (error) {
    throw createSupabaseStepError(
      "pump_pro_subscriptions lookup failed",
      { tableName, action: "select", conditions },
      error
    );
  }

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
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

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
      isPro = await getPumpProStatus(user);
    }

    if (isPro) {
      let usageCount = 0;
      try {
        usageCount = await getTodayAiUsageCount(user, usageDate);
      } catch (usageCountError) {
        console.warn("pro ai usage count lookup failed; continuing without blocking", {
          user: serializeUser(user),
          userId: user.id,
          usageDate,
          tableName: "ai_chat_usage",
          conditions: { user_id: user.id, usage_date: usageDate },
          error: serializeSupabaseError(usageCountError?.cause || usageCountError),
          debug: usageCountError?.debug || null,
        });
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
      reservedUsage = await reserveAiChatUsage(user);
    }
  } catch (usageError) {
    console.error("ai usage/pro check failed", {
      user: serializeUser(user),
      userId: user.id,
      usageDate,
      tableName: "ai_chat_usage",
      selectConditions: {
        profiles: { id: user.id },
        pump_pro_subscriptions: { user_id: user.id },
        ai_chat_usage: { user_id: user.id, usage_date: usageDate },
      },
      supabaseConfig: getSupabaseConfigStatus(),
      error: serializeSupabaseError(usageError?.cause || usageError),
      errorCode: usageError?.cause?.code || usageError?.code || null,
      errorMessage: usageError?.cause?.message || usageError?.message || null,
      errorDetails: usageError?.cause?.details || usageError?.details || null,
      errorHint: usageError?.cause?.hint || usageError?.hint || null,
      debug: usageError?.debug || null,
    });
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

種目別の過去記録:
${safeContext.exerciseHistoryContext || "種目別の過去記録はありません。"}

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
- AI用の記録参照元は ${safeContext.source || "unknown"}。workouts.data の記録を優先し、古いsummary_jsonやキャッシュ由来の欠落を根拠に「記録がない」と言わない
- メニュー提案では、種目別の過去記録にあるPR、直近最高重量、推定1RM、推奨ワーキングセット重量を優先して使う
- ベンチプレスなど指定種目の履歴が種目別の過去記録にある場合は、「記録がありません」と返さず、その履歴から現実的な重量を提案する
- BIG3相談では、種目別の過去記録内の「BIG3/主要種目の過去記録」を最優先で確認し、ベンチ系・スクワット系・通常デッドリフト・RDL系バリエーションの記録を参照する
- スクワット系やデッドリフト系バリエーションの記録がある場合は「記録がありません」と言わない
- 通常デッドリフトとRDL/ルーマニアンデッドリフトは区別し、通常デッドリフトが無くRDLだけある場合は「通常デッドリフトの記録は見当たりませんが、RDLの記録があります」と伝える
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
    if (!replyText) {
      if (!reservedUsage.isPro) {
        try {
          const refundedUsage = await refundAiChatUsage(user.id, reservedUsage.usageDate);
          reservedUsage = refundedUsage || reservedUsage;
        } catch (refundError) {
          console.error("refund ai usage failed", refundError);
        }
      }
      console.error("Claude API returned empty AI Coach reply", {
        user: serializeUser(user),
        userId: user.id,
        usageDate,
        status: response.status,
        response: data,
      });
      return res.status(502).json({
        error: "AI Coachの応答が空でした。",
        aiUsage: reservedUsage,
      });
    }
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
  } catch (error) {
    console.error("Claude API request failed for AI Coach", {
      user: serializeUser(user),
      userId: user?.id || null,
      usageDate,
      error,
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    });
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
