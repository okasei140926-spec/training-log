import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  adminSupabase,
  authenticateRequest,
  buildHistoryFromWorkoutRows,
  computeBig3FromHistory,
  excludeDateFromHistory,
  getAcceptedFriendIds,
  getBearerToken,
  getLatestWorkoutDate,
  hasWorkoutOnDate,
  pushServerReady,
  sendPushToUser,
} from "./_lib/pushServer.js";

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

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

const BIG3_LABELS = {
  bench: "ベンチプレス",
  squat: "スクワット",
  deadlift: "デッドリフト",
};

const getTodayStr = () => new Date().toISOString().split("T")[0];
const getDateOnly = (value) => new Date(`${value}T00:00:00Z`);

const getDisplayName = (username) => {
  const trimmed = String(username || "").trim();
  return trimmed || "友達";
};

const groupByUserId = (rows = []) =>
  rows.reduce((acc, row) => {
    const current = acc.get(row.user_id) || [];
    current.push(row);
    acc.set(row.user_id, current);
    return acc;
  }, new Map());

function isAuthorizedCronRequest(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const bearer = getBearerToken(req);
  const headerSecret = req.headers["x-cron-secret"];
  return bearer === cronSecret || headerSecret === cronSecret;
}

// POST /api/push?action=notify-workout
async function handleNotifyWorkout(req, res) {
  if (!pushServerReady()) {
    return res.status(500).json({ error: "Push通知の設定が不足しています。" });
  }

  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user?.id) return res.status(401).json({ error: "ログインが必要です" });

  const workoutDate = String(req.body?.workoutDate || "").trim();
  if (!workoutDate) return res.status(400).json({ error: "workoutDate が必要です" });

  const todayStr = getTodayStr();
  if (workoutDate !== todayStr) {
    return res.status(200).json({ success: true, skipped: true, reason: "workoutDate is not today" });
  }

  try {
    const friendIds = await getAcceptedFriendIds(user.id);
    if (!friendIds.length) {
      return res.status(200).json({ success: true, sent: 0, skipped: true, reason: "no-friends" });
    }

    const relatedUserIds = [user.id, ...friendIds];

    const ninetyDaysAgo = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 3);
      return d.toISOString().slice(0, 10);
    })();

    const [profileRes, workoutsRes, manualBestsRes] = await Promise.all([
      adminSupabase.from("profiles").select("id, username").eq("id", user.id).single(),
      adminSupabase.from("workouts").select("user_id, date, data").in("user_id", relatedUserIds).gte("date", ninetyDaysAgo).order("date", { ascending: true }),
      adminSupabase.from("manual_bests").select("user_id, exercise_name, weight, reps").in("user_id", relatedUserIds),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (workoutsRes.error) throw workoutsRes.error;
    if (manualBestsRes.error) throw manualBestsRes.error;

    const actorName = getDisplayName(profileRes.data?.username);
    const workoutRowsMap = groupByUserId(workoutsRes.data || []);
    const manualBestsMap = groupByUserId(manualBestsRes.data || []);

    const actorHistory = buildHistoryFromWorkoutRows(workoutRowsMap.get(user.id) || []);
    if (!hasWorkoutOnDate(actorHistory, workoutDate)) {
      return res.status(200).json({ success: true, sent: 0, skipped: true, reason: "no-valid-record-for-date" });
    }

    const actorManualBests = manualBestsMap.get(user.id) || [];
    const actorCurrentBig3 = computeBig3FromHistory(actorHistory, actorManualBests);
    const actorPreviousBig3 = computeBig3FromHistory(
      excludeDateFromHistory(actorHistory, workoutDate),
      actorManualBests
    );

    let sentCount = 0;
    const overtakeEvents = [];

    for (const friendId of friendIds) {
      const friendWorkoutResult = await sendPushToUser({
        userId: friendId,
        title: `${actorName}さんが記録しました`,
        body: "",
        url: "/?screen=friends",
        type: "friend_workout",
        dedupeKey: `friend_workout:${user.id}:${workoutDate}`,
        payload: { actorUserId: user.id, workoutDate },
      });

      if (friendWorkoutResult.sent) sentCount += friendWorkoutResult.count || 0;

      const friendHistory = buildHistoryFromWorkoutRows(workoutRowsMap.get(friendId) || []);
      const friendBig3 = computeBig3FromHistory(friendHistory, manualBestsMap.get(friendId) || []);

      const candidateTypes = [
        {
          key: "total",
          currentValue: actorCurrentBig3.total,
          previousValue: actorPreviousBig3.total,
          targetValue: friendBig3.total,
          body: `${actorName}さんがBIG3合計であなたを超えました`,
        },
        ...Object.entries(BIG3_LABELS).map(([key, label]) => ({
          key,
          currentValue: actorCurrentBig3[key],
          previousValue: actorPreviousBig3[key],
          targetValue: friendBig3[key],
          body: `${actorName}さんが${label}であなたの記録を超えました`,
        })),
      ];

      for (const candidate of candidateTypes) {
        if (!(candidate.targetValue > 0)) continue;
        if (!(candidate.currentValue > candidate.targetValue)) continue;
        if (candidate.previousValue > candidate.targetValue) continue;

        const result = await sendPushToUser({
          userId: friendId,
          title: `${actorName}さんが記録を更新しました`,
          body: candidate.body,
          url: "/?screen=friends",
          type: candidate.key === "total" ? "big3_overtake_total" : "big3_overtake_exercise",
          dedupeKey: `overtaken:${friendId}:${user.id}:${candidate.key}:${workoutDate}`,
          payload: { actorUserId: user.id, type: candidate.key, workoutDate, value: candidate.currentValue },
        });

        if (result.sent) {
          sentCount += result.count || 0;
          overtakeEvents.push({ targetUserId: friendId, type: candidate.key, value: candidate.currentValue });
        }
      }
    }

    return res.status(200).json({ success: true, sent: sentCount, overtakeEvents });
  } catch (error) {
    console.error("notify workout save failed", error);
    return res.status(500).json({ error: "通知送信に失敗しました。" });
  }
}

// POST /api/push?action=send-test
async function handleSendTest(req, res) {
  if (!authSupabase || !adminSupabase) {
    return res.status(500).json({ error: "Push通知の設定が不足しています。" });
  }

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return res.status(500).json({ error: "VAPIDキーが設定されていません。" });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) return res.status(401).json({ error: "ログインが必要です" });

  const { data: { user }, error: userError } = await authSupabase.auth.getUser(accessToken);
  if (userError || !user?.id) return res.status(401).json({ error: "ログインが必要です" });

  const { data: rows, error: rowsError } = await adminSupabase
    .from("push_subscriptions")
    .select("id, endpoint, keys")
    .eq("user_id", user.id)
    .eq("enabled", true);

  if (rowsError) return res.status(500).json({ error: "通知先の取得に失敗しました。" });
  if (!rows?.length) return res.status(400).json({ error: "通知が有効になっていません。" });

  const payload = JSON.stringify({
    title: "通知テスト",
    body: "記録リマインドや友達の更新通知はこのように届きます。",
    url: "/",
  });

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: row.keys || {} }, payload);
        return { ok: true, id: row.id };
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await adminSupabase
            .from("push_subscriptions")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", row.id);
        }
        throw error;
      }
    })
  );

  const successCount = results.filter((r) => r.status === "fulfilled").length;
  if (successCount === 0) return res.status(500).json({ error: "テスト通知の送信に失敗しました。" });

  return res.status(200).json({ success: true, sent: successCount });
}

// POST or GET /api/push?action=inactivity  (called by Vercel Cron)
async function handleInactivity(req, res) {
  if (!pushServerReady()) {
    return res.status(500).json({ error: "Push通知の設定が不足しています。" });
  }

  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data: subscriptions, error: subscriptionError } = await adminSupabase
      .from("push_subscriptions")
      .select("user_id")
      .eq("enabled", true);

    if (subscriptionError) throw subscriptionError;

    const userIds = [...new Set((subscriptions || []).map((row) => row.user_id).filter(Boolean))];
    if (!userIds.length) {
      return res.status(200).json({ success: true, sent: 0, skipped: true, reason: "no-enabled-subscriptions" });
    }

    const ninetyDaysAgo = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 3);
      return d.toISOString().slice(0, 10);
    })();

    const { data: workoutRows, error: workoutError } = await adminSupabase
      .from("workouts")
      .select("user_id, date, data")
      .in("user_id", userIds)
      .gte("date", ninetyDaysAgo)
      .order("date", { ascending: true });

    if (workoutError) throw workoutError;

    const workoutRowsMap = new Map();
    (workoutRows || []).forEach((row) => {
      const current = workoutRowsMap.get(row.user_id) || [];
      current.push(row);
      workoutRowsMap.set(row.user_id, current);
    });

    const todayStr = getTodayStr();
    const todayDate = getDateOnly(todayStr);
    let sentCount = 0;

    for (const userId of userIds) {
      const history = buildHistoryFromWorkoutRows(workoutRowsMap.get(userId) || []);
      const latestWorkoutDate = getLatestWorkoutDate(history);
      if (!latestWorkoutDate) continue;

      const diffDays = Math.floor(
        (todayDate.getTime() - getDateOnly(latestWorkoutDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays < 3) continue;

      const result = await sendPushToUser({
        userId,
        title: "トレーニングを再開しませんか",
        body: "最後のトレーニングから3日経ちました。軽く1種目だけでも記録しませんか？",
        url: "/?screen=history",
        type: "inactivity_reminder",
        dedupeKey: `inactivity:${userId}:${todayStr}`,
        payload: { latestWorkoutDate, diffDays },
      });

      if (result.sent) sentCount += result.count || 0;
    }

    return res.status(200).json({ success: true, sent: sentCount });
  } catch (error) {
    console.error("send inactivity push failed", error);
    return res.status(500).json({ error: "未記録通知の送信に失敗しました。" });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = req.query.action;

  switch (action) {
    case "notify-workout":
      return handleNotifyWorkout(req, res);
    case "send-test":
      return handleSendTest(req, res);
    case "inactivity":
      return handleInactivity(req, res);
    default:
      return res.status(404).json({ error: "Unknown action" });
  }
}
