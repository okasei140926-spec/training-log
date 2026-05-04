import { adminSupabase, authenticateRequest } from "./_lib/pushServer.js";

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

  const commentId = String(req.body?.commentId || "").trim();
  if (!commentId) {
    return res.status(400).json({ error: "commentId が必要です" });
  }

  try {
    const { data: commentRow, error: commentError } = await adminSupabase
      .from("workout_session_comments")
      .select("id, user_id, session_id")
      .eq("id", commentId)
      .maybeSingle();

    if (commentError) throw commentError;
    if (!commentRow?.id) {
      return res.status(404).json({ error: "コメントが見つかりません。" });
    }

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

    return res.status(200).json({
      success: true,
      sessionId: commentRow.session_id,
      commentCount: count || 0,
    });
  } catch (error) {
    console.error("delete workout comment failed", error);
    return res.status(500).json({ error: "コメントの削除に失敗しました。" });
  }
}
