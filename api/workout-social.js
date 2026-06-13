import {
  adminSupabase,
  authenticateRequest,
  getAcceptedFriendIds,
  sendPushToUser,
} from "./_lib/pushServer.js";

const APP_URL = "/?screen=feed";

const getDisplayName = (username) => {
  const trimmed = String(username || "").trim();
  return trimmed || "友達";
};

const getCommentConfigError = (error) => {
  const message = String(error?.message || error || "");
  if (message.includes("comment_content_empty")) return "コメントを入力してください。";
  if (message.includes("comment_content_too_long")) return "コメントは300文字以内で入力してください。";
  if (message.includes("parent_comment_not_found")) return "返信先コメントが見つかりません。";
  if (message.includes("parent_comment_wrong_session")) return "返信先コメントが不正です。";
  if (message.includes("reply_depth_exceeded")) return "返信は1階層までです。";
  return null;
};

// POST /api/workout-social?action=add-comment
async function handleAddComment(req, res) {
  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user?.id) return res.status(401).json({ error: "ログインが必要です" });

  const sessionId = String(req.body?.sessionId || "").trim();
  const content = String(req.body?.content || "");
  const parentIdRaw = String(req.body?.parentId || "").trim();
  const parentId = parentIdRaw || null;

  if (!sessionId) return res.status(400).json({ error: "sessionId が必要です" });

  try {
    const { data: sessionRow, error: sessionError } = await adminSupabase
      .from("workout_sessions")
      .select("id, user_id, visibility")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!sessionRow?.id) return res.status(404).json({ error: "セッションが見つかりません。" });

    const isOwnSession = sessionRow.user_id === user.id;

    if (!isOwnSession) {
      const acceptedFriendIds = await getAcceptedFriendIds(user.id);
      if (!acceptedFriendIds.includes(sessionRow.user_id)) {
        return res.status(403).json({ error: "この投稿にはコメントできません。" });
      }
    }

    if (parentId) {
      const { data: parentComment, error: parentError } = await adminSupabase
        .from("workout_session_comments")
        .select("id, session_id, parent_id")
        .eq("id", parentId)
        .maybeSingle();

      if (parentError) throw parentError;
      if (!parentComment?.id || parentComment.session_id !== sessionId) {
        return res.status(400).json({ error: "返信先コメントが見つかりません。" });
      }
      if (parentComment.parent_id) {
        return res.status(400).json({ error: "返信は1階層までです。" });
      }
    }

    const { data: insertedComment, error: insertError } = await adminSupabase
      .from("workout_session_comments")
      .insert({ session_id: sessionId, user_id: user.id, content, parent_id: parentId })
      .select("id, session_id, user_id, content, parent_id, created_at")
      .single();

    if (insertError) {
      const configError = getCommentConfigError(insertError);
      if (configError) return res.status(400).json({ error: configError });
      throw insertError;
    }

    const { count, error: countError } = await adminSupabase
      .from("workout_session_comments")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (countError) throw countError;

    if (!isOwnSession) {
      try {
        const { data: commenterProfile } = await adminSupabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();

        await sendPushToUser({
          userId: sessionRow.user_id,
          title: "PUMP",
          body: `${getDisplayName(commenterProfile?.username)}さんがあなたのワークアウトにコメントしました`,
          url: APP_URL,
          type: "workout_comment",
          dedupeKey: `workout_comment:${sessionId}:${insertedComment.id}`,
          payload: { sessionId, commentId: insertedComment.id, commenterUserId: user.id, parentId },
        });
      } catch (pushError) {
        console.error("workout comment push failed", pushError);
      }
    }

    return res.status(200).json({ success: true, comment: insertedComment, commentCount: count || 0 });
  } catch (error) {
    console.error("add workout comment failed", error);
    const configError = getCommentConfigError(error);
    if (configError) return res.status(400).json({ error: configError });
    return res.status(500).json({ error: "コメントの投稿に失敗しました。" });
  }
}

// POST /api/workout-social?action=delete-comment
async function handleDeleteComment(req, res) {
  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user?.id) return res.status(401).json({ error: "ログインが必要です" });

  const commentId = String(req.body?.commentId || "").trim();
  if (!commentId) return res.status(400).json({ error: "commentId が必要です" });

  try {
    const { data: commentRow, error: commentError } = await adminSupabase
      .from("workout_session_comments")
      .select("id, user_id, session_id")
      .eq("id", commentId)
      .maybeSingle();

    if (commentError) throw commentError;
    if (!commentRow?.id) return res.status(404).json({ error: "コメントが見つかりません。" });
    if (commentRow.user_id !== user.id) {
      return res.status(403).json({ error: "自分のコメントのみ削除できます。" });
    }

    const { error: deleteError } = await adminSupabase
      .from("workout_session_comments")
      .delete()
      .eq("id", commentId);

    if (deleteError) throw deleteError;

    const { count, error: countError } = await adminSupabase
      .from("workout_session_comments")
      .select("id", { count: "exact", head: true })
      .eq("session_id", commentRow.session_id);

    if (countError) throw countError;

    return res.status(200).json({ success: true, sessionId: commentRow.session_id, commentCount: count || 0 });
  } catch (error) {
    console.error("delete workout comment failed", error);
    return res.status(500).json({ error: "コメントの削除に失敗しました。" });
  }
}

// POST /api/workout-social?action=toggle-like
async function handleToggleLike(req, res) {
  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user?.id) return res.status(401).json({ error: "ログインが必要です" });

  const sessionId = String(req.body?.sessionId || "").trim();
  if (!sessionId) return res.status(400).json({ error: "sessionId が必要です" });

  try {
    const { data: sessionRow, error: sessionError } = await adminSupabase
      .from("workout_sessions")
      .select("id, user_id, visibility")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!sessionRow?.id) return res.status(404).json({ error: "セッションが見つかりません。" });
    if (sessionRow.user_id === user.id) {
      return res.status(403).json({ error: "自分の投稿にはいいねできません。" });
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
        .insert({ session_id: sessionId, user_id: user.id });

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
        const { data: likerProfile } = await adminSupabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();

        await sendPushToUser({
          userId: sessionRow.user_id,
          title: "PUMP",
          body: `${getDisplayName(likerProfile?.username)}さんがあなたのワークアウトにいいねしました`,
          url: "/?screen=friends",
          type: "workout_like",
          dedupeKey: `workout_like:${sessionId}:${user.id}`,
          payload: { sessionId, likerUserId: user.id },
        });
      } catch (pushError) {
        console.error("workout like push failed", pushError);
      }
    }

    return res.status(200).json({ success: true, liked, likeCount: count || 0 });
  } catch (error) {
    console.error("toggle workout like failed", error);
    return res.status(500).json({ error: "いいねの更新に失敗しました。" });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!adminSupabase) {
    return res.status(500).json({ error: "DB設定が不足しています。" });
  }

  const action = req.query.action;

  switch (action) {
    case "add-comment":
      return handleAddComment(req, res);
    case "delete-comment":
      return handleDeleteComment(req, res);
    case "toggle-like":
      return handleToggleLike(req, res);
    default:
      return res.status(404).json({ error: "Unknown action" });
  }
}
