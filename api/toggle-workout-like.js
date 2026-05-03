import {
  adminSupabase,
  authenticateRequest,
  getAcceptedFriendIds,
  sendPushToUser,
} from "./_lib/pushServer.js";

const getDisplayName = (username) => {
  const trimmed = String(username || "").trim();
  return trimmed || "友達";
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!adminSupabase) {
    return res.status(500).json({ error: "通知設定またはDB設定が不足しています。" });
  }

  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const sessionId = String(req.body?.sessionId || "").trim();
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId が必要です" });
  }

  try {
    const { data: sessionRow, error: sessionError } = await adminSupabase
      .from("workout_sessions")
      .select("id, user_id, visibility")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!sessionRow?.id) {
      return res.status(404).json({ error: "セッションが見つかりません。" });
    }

    if (sessionRow.user_id === user.id) {
      return res.status(403).json({ error: "自分の投稿にはいいねできません。" });
    }

    if (sessionRow.visibility !== "friends") {
      return res.status(403).json({ error: "この投稿にはいいねできません。" });
    }

    const acceptedFriendIds = await getAcceptedFriendIds(user.id);
    if (!acceptedFriendIds.includes(sessionRow.user_id)) {
      return res.status(403).json({ error: "この投稿にはいいねできません。" });
    }

    const { data: existingLike, error: existingLikeError } = await adminSupabase
      .from("workout_session_likes")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingLikeError) throw existingLikeError;

    let liked = false;

    if (existingLike?.id) {
      const { error: deleteError } = await adminSupabase
        .from("workout_session_likes")
        .delete()
        .eq("id", existingLike.id)
        .eq("user_id", user.id);

      if (deleteError) throw deleteError;
    } else {
      const { error: insertError } = await adminSupabase
        .from("workout_session_likes")
        .insert({
          session_id: sessionId,
          user_id: user.id,
        });

      if (insertError) {
        if (insertError.code === "23505") {
          liked = true;
        } else {
          throw insertError;
        }
      } else {
        liked = true;
      }
    }

    const { count, error: countError } = await adminSupabase
      .from("workout_session_likes")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (countError) throw countError;

    if (liked) {
      try {
        const { data: likerProfile, error: likerProfileError } = await adminSupabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();

        if (likerProfileError) throw likerProfileError;

        await sendPushToUser({
          userId: sessionRow.user_id,
          title: "PUMP",
          body: `${getDisplayName(likerProfile?.username)}さんがあなたのワークアウトにいいねしました`,
          url: "/?screen=friends",
          type: "workout_like",
          dedupeKey: `workout_like:${sessionId}:${user.id}`,
          payload: {
            sessionId,
            likerUserId: user.id,
          },
        });
      } catch (pushError) {
        console.error("workout like push failed", pushError);
      }
    }

    return res.status(200).json({
      success: true,
      liked,
      likeCount: count || 0,
    });
  } catch (error) {
    console.error("toggle workout like failed", error);
    return res.status(500).json({ error: "いいねの更新に失敗しました。" });
  }
}
