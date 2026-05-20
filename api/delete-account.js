import { adminSupabase, authenticateRequest } from "./_lib/pushServer.js";

const deleteWhere = async (table, column, value) => {
  const { error } = await adminSupabase
    .from(table)
    .delete()
    .eq(column, value);
  if (error) throw error;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!adminSupabase) {
    return res.status(500).json({ error: "DB設定が不足しています。" });
  }

  const { user, error: authError } = await authenticateRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const userId = user.id;

  try {
    const { data: photoRows, error: photosFetchError } = await adminSupabase
      .from("progress_photos")
      .select("storage_path")
      .eq("user_id", userId);
    if (photosFetchError) throw photosFetchError;

    const storagePaths = (photoRows || [])
      .map((row) => row.storage_path)
      .filter(Boolean);
    if (storagePaths.length > 0) {
      const { error: storageError } = await adminSupabase.storage
        .from("progress-photos-private")
        .remove(storagePaths);
      if (storageError) throw storageError;
    }

    const { data: sessionRows, error: sessionsFetchError } = await adminSupabase
      .from("workout_sessions")
      .select("id")
      .eq("user_id", userId);
    if (sessionsFetchError) throw sessionsFetchError;

    const sessionIds = (sessionRows || []).map((session) => session.id).filter(Boolean);
    if (sessionIds.length > 0) {
      const { error: commentsError } = await adminSupabase
        .from("workout_session_comments")
        .delete()
        .in("session_id", sessionIds);
      if (commentsError) throw commentsError;

      const { error: likesError } = await adminSupabase
        .from("workout_session_likes")
        .delete()
        .in("session_id", sessionIds);
      if (likesError) throw likesError;

      const { error: exercisesError } = await adminSupabase
        .from("workout_session_exercises")
        .delete()
        .in("session_id", sessionIds);
      if (exercisesError) throw exercisesError;
    }

    await deleteWhere("workout_session_comments", "user_id", userId);
    await deleteWhere("workout_session_likes", "user_id", userId);
    await deleteWhere("workout_sessions", "user_id", userId);
    await deleteWhere("workouts", "user_id", userId);
    await deleteWhere("manual_bests", "user_id", userId);
    await deleteWhere("progress_photos", "user_id", userId);
    await deleteWhere("push_subscriptions", "user_id", userId);
    await deleteWhere("notification_events", "user_id", userId);

    const { error: friendshipsError } = await adminSupabase
      .from("friendships")
      .delete()
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);
    if (friendshipsError) throw friendshipsError;

    await deleteWhere("profiles", "id", userId);

    const { error: deleteUserError } = await adminSupabase.auth.admin.deleteUser(userId);
    if (deleteUserError) throw deleteUserError;

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("delete account failed", error);
    return res.status(500).json({ error: "アカウント削除に失敗しました。" });
  }
}
