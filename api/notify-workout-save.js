import {
  adminSupabase,
  authenticateRequest,
  buildHistoryFromWorkoutRows,
  computeBig3FromHistory,
  excludeDateFromHistory,
  getAcceptedFriendIds,
  hasWorkoutOnDate,
  pushServerReady,
  sendPushToUser,
} from "./_lib/pushServer.js";

const BIG3_LABELS = {
  bench: "ベンチプレス",
  squat: "スクワット",
  deadlift: "デッドリフト",
};

const getTodayStr = () => new Date().toISOString().split("T")[0];

const groupByUserId = (rows = []) =>
  rows.reduce((acc, row) => {
    const current = acc.get(row.user_id) || [];
    current.push(row);
    acc.set(row.user_id, current);
    return acc;
  }, new Map());

const groupManualBestsByUserId = (rows = []) =>
  rows.reduce((acc, row) => {
    const current = acc.get(row.user_id) || [];
    current.push(row);
    acc.set(row.user_id, current);
    return acc;
  }, new Map());

const getDisplayName = (username) => {
  const trimmed = String(username || "").trim();
  return trimmed || "友達";
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!pushServerReady()) {
    return res.status(500).json({ error: "Push通知の設定が不足しています。" });
  }

  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const workoutDate = String(req.body?.workoutDate || "").trim();
  if (!workoutDate) {
    return res.status(400).json({ error: "workoutDate が必要です" });
  }

  const todayStr = getTodayStr();
  if (workoutDate !== todayStr) {
    return res.status(200).json({
      success: true,
      skipped: true,
      reason: "workoutDate is not today",
    });
  }

  try {
    const friendIds = await getAcceptedFriendIds(user.id);
    if (!friendIds.length) {
      return res.status(200).json({
        success: true,
        sent: 0,
        skipped: true,
        reason: "no-friends",
      });
    }

    const relatedUserIds = [user.id, ...friendIds];

    const [profileRes, workoutsRes, manualBestsRes] = await Promise.all([
      adminSupabase
        .from("profiles")
        .select("id, username")
        .eq("id", user.id)
        .single(),
      adminSupabase
        .from("workouts")
        .select("user_id, date, data")
        .in("user_id", relatedUserIds)
        .order("date", { ascending: true }),
      adminSupabase
        .from("manual_bests")
        .select("user_id, exercise_name, weight, reps")
        .in("user_id", relatedUserIds),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (workoutsRes.error) throw workoutsRes.error;
    if (manualBestsRes.error) throw manualBestsRes.error;

    const actorName = getDisplayName(profileRes.data?.username);
    const workoutRowsMap = groupByUserId(workoutsRes.data || []);
    const manualBestsMap = groupManualBestsByUserId(manualBestsRes.data || []);

    const actorHistory = buildHistoryFromWorkoutRows(workoutRowsMap.get(user.id) || []);
    if (!hasWorkoutOnDate(actorHistory, workoutDate)) {
      return res.status(200).json({
        success: true,
        sent: 0,
        skipped: true,
        reason: "no-valid-record-for-date",
      });
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
        title: "IRON LOG",
        body: `${actorName}さんが今日のトレーニングを記録しました`,
        url: "/?screen=friends",
        type: "friend_workout",
        dedupeKey: `friend_workout:${user.id}:${workoutDate}`,
        payload: {
          actorUserId: user.id,
          workoutDate,
        },
      });

      if (friendWorkoutResult.sent) {
        sentCount += friendWorkoutResult.count || 0;
      }

      const friendHistory = buildHistoryFromWorkoutRows(workoutRowsMap.get(friendId) || []);
      const friendBig3 = computeBig3FromHistory(
        friendHistory,
        manualBestsMap.get(friendId) || []
      );

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
          title: "IRON LOG",
          body: candidate.body,
          url: "/?screen=friends",
          type: candidate.key === "total" ? "big3_overtake_total" : "big3_overtake_exercise",
          dedupeKey: `overtaken:${friendId}:${user.id}:${candidate.key}:${workoutDate}`,
          payload: {
            actorUserId: user.id,
            type: candidate.key,
            workoutDate,
            value: candidate.currentValue,
          },
        });

        if (result.sent) {
          sentCount += result.count || 0;
          overtakeEvents.push({
            targetUserId: friendId,
            type: candidate.key,
            value: candidate.currentValue,
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      sent: sentCount,
      overtakeEvents,
    });
  } catch (error) {
    console.error("notify workout save failed", error);
    return res.status(500).json({ error: "通知送信に失敗しました。" });
  }
}
