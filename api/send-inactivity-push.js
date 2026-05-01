import {
  adminSupabase,
  buildHistoryFromWorkoutRows,
  getBearerToken,
  getLatestWorkoutDate,
  pushServerReady,
  sendPushToUser,
} from "./_lib/pushServer.js";

const getDateOnly = (value) => new Date(`${value}T00:00:00Z`);
const getTodayStr = () => new Date().toISOString().split("T")[0];

function isAuthorizedCronRequest(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const bearer = getBearerToken(req);
  const headerSecret = req.headers["x-cron-secret"];
  return bearer === cronSecret || headerSecret === cronSecret;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

    const { data: workoutRows, error: workoutError } = await adminSupabase
      .from("workouts")
      .select("user_id, date, data")
      .in("user_id", userIds)
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
        title: "IRON LOG",
        body: "最後のトレーニングから3日経ちました。軽く1種目だけでも記録しませんか？",
        url: "/?screen=history",
        type: "inactivity_reminder",
        dedupeKey: `inactivity:${userId}:${todayStr}`,
        payload: {
          latestWorkoutDate,
          diffDays,
        },
      });

      if (result.sent) sentCount += result.count || 0;
    }

    return res.status(200).json({ success: true, sent: sentCount });
  } catch (error) {
    console.error("send inactivity push failed", error);
    return res.status(500).json({ error: "未記録通知の送信に失敗しました。" });
  }
}
