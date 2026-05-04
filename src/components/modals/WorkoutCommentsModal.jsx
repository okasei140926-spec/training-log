import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabase";

const formatRelativeTime = (value) => {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return "たった今";
  if (diffMinutes < 60) return `${diffMinutes}分前`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}時間前`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}日前`;

  return new Date(value).toLocaleDateString("ja-JP");
};

const getDisplayUsername = (rawUsername, { isMe = false } = {}) => {
  if (isMe) return "あなた";
  const trimmed = String(rawUsername || "").trim();
  return trimmed || "ユーザー";
};

export default function WorkoutCommentsModal({
  isOpen,
  sessionItem,
  user,
  myUsername,
  onClose,
  onCommentCountChange,
}) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [replyTarget, setReplyTarget] = useState(null);

  const sessionId = sessionItem?.id || null;

  const loadComments = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const { data: commentRows, error: commentsError } = await supabase
        .from("workout_session_comments")
        .select("id, session_id, user_id, content, parent_id, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (commentsError) throw commentsError;

      const userIds = [...new Set((commentRows || []).map((row) => row.user_id).filter(Boolean))];
      const { data: profiles, error: profilesError } = userIds.length
        ? await supabase
            .from("profiles")
            .select("id, username, avatar1_url")
            .in("id", userIds)
        : { data: [], error: null };

      if (profilesError) throw profilesError;

      const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
      const nextComments = (commentRows || []).map((row) => ({
        ...row,
        profile: profileMap.get(row.user_id) || null,
      }));

      setComments(nextComments);
      onCommentCountChange?.(sessionId, nextComments.length);
    } catch (loadError) {
      console.error("load workout comments failed", loadError);
      setError("コメントを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }, [onCommentCountChange, sessionId]);

  useEffect(() => {
    if (!isOpen || !sessionId) return;
    setError("");
    setContent("");
    setReplyTarget(null);
    loadComments();
  }, [isOpen, loadComments, sessionId]);

  const groupedComments = useMemo(() => {
    const parentComments = comments.filter((comment) => !comment.parent_id);
    const repliesMap = comments.reduce((acc, comment) => {
      if (!comment.parent_id) return acc;
      if (!acc[comment.parent_id]) acc[comment.parent_id] = [];
      acc[comment.parent_id].push(comment);
      return acc;
    }, {});

    return parentComments.map((comment) => ({
      ...comment,
      replies: repliesMap[comment.id] || [],
    }));
  }, [comments]);

  if (!isOpen || !sessionItem) return null;

  const handleSubmit = async () => {
    if (!user?.id || !sessionId || posting) return;

    const trimmed = content.trim();
    if (!trimmed) {
      setError("コメントを入力してください。");
      return;
    }
    if (trimmed.length > 300) {
      setError("コメントは300文字以内で入力してください。");
      return;
    }

    setPosting(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        throw new Error("ログインが必要です");
      }

      const response = await fetch("/api/add-workout-comment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sessionId,
          content: trimmed,
          parentId: replyTarget?.id || null,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "コメントの投稿に失敗しました。");
      }

      setContent("");
      setReplyTarget(null);
      await loadComments();
    } catch (submitError) {
      console.error("add workout comment failed on client", submitError);
      setError(submitError?.message || "コメントの投稿に失敗しました。");
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (commentId) => {
    if (!commentId || deletingId) return;

    const confirmed = window.confirm("このコメントを削除しますか？");
    if (!confirmed) return;

    setDeletingId(commentId);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        throw new Error("ログインが必要です");
      }

      const response = await fetch("/api/delete-workout-comment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ commentId }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "コメントの削除に失敗しました。");
      }

      if (replyTarget?.id === commentId) {
        setReplyTarget(null);
      }

      await loadComments();
    } catch (deleteError) {
      console.error("delete workout comment failed on client", deleteError);
      setError(deleteError?.message || "コメントの削除に失敗しました。");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "#00000099",
        zIndex: 1100,
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "min(82vh, calc(100dvh - 72px))",
          background: "var(--bg)",
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          boxShadow: "0 -24px 60px rgba(15, 23, 42, 0.2)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border2)", background: "var(--card)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>コメント</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                {sessionItem.workout_date} · {Number(sessionItem.commentCount ?? comments.length)}件
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "var(--text2)", lineHeight: 1 }}>
              ×
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {loading ? (
            <div style={{ background: "var(--card)", borderRadius: 16, padding: "18px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              コメントを読み込み中...
            </div>
          ) : groupedComments.length === 0 ? (
            <div style={{ background: "var(--card)", borderRadius: 16, padding: "18px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              まだコメントはありません
            </div>
          ) : (
            groupedComments.map((comment) => {
              const isMine = comment.user_id === user?.id;

              return (
                <div key={comment.id} style={{ background: "var(--card)", borderRadius: 16, border: "1px solid var(--border2)", padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                        {getDisplayUsername(comment.profile?.username, { isMe: comment.user_id === user?.id })}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                        {formatRelativeTime(comment.created_at)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        onClick={() => setReplyTarget(comment)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent)",
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        返信
                      </button>
                      {isMine && (
                        <button
                          onClick={() => handleDelete(comment.id)}
                          disabled={deletingId === comment.id}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--text3)",
                            fontSize: 11,
                            fontWeight: 800,
                            opacity: deletingId === comment.id ? 0.6 : 1,
                          }}
                        >
                          {deletingId === comment.id ? "削除中..." : "削除"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {comment.content}
                  </div>

                  {comment.replies.length > 0 && (
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      {comment.replies.map((reply) => {
                        const isReplyMine = reply.user_id === user?.id;

                        return (
                          <div key={reply.id} style={{ marginLeft: 12, paddingLeft: 12, borderLeft: "2px solid var(--border2)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                                  {getDisplayUsername(reply.profile?.username, { isMe: reply.user_id === user?.id })}
                                </div>
                                <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                                  {formatRelativeTime(reply.created_at)}
                                </div>
                              </div>
                              {isReplyMine && (
                                <button
                                  onClick={() => handleDelete(reply.id)}
                                  disabled={deletingId === reply.id}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--text3)",
                                    fontSize: 11,
                                    fontWeight: 800,
                                    opacity: deletingId === reply.id ? 0.6 : 1,
                                  }}
                                >
                                  {deletingId === reply.id ? "削除中..." : "削除"}
                                </button>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                              {reply.content}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div style={{ padding: "12px 16px calc(12px + var(--safe-bottom))", borderTop: "1px solid var(--border2)", background: "var(--card)" }}>
          {replyTarget && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, padding: "8px 10px", borderRadius: 12, background: "var(--card2)", border: "1px solid var(--border2)" }}>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>
                @{getDisplayUsername(replyTarget.profile?.username)} に返信中
              </div>
              <button
                onClick={() => setReplyTarget(null)}
                style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 11, fontWeight: 800 }}
              >
                キャンセル
              </button>
            </div>
          )}

          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (error) setError("");
            }}
            placeholder={replyTarget ? "返信を書く" : "コメントを書く"}
            maxLength={300}
            rows={3}
            style={{
              width: "100%",
              borderRadius: 14,
              border: "1px solid var(--border2)",
              background: "var(--bg)",
              padding: "12px 14px",
              resize: "none",
              color: "var(--text)",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 8 }}>
            <div style={{ fontSize: 11, color: error ? "var(--danger, #dc2626)" : "var(--text3)" }}>
              {error || `${content.trim().length}/300`}
            </div>
            <button
              onClick={handleSubmit}
              disabled={posting}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                background: "linear-gradient(135deg, var(--accent), #4ADE80)",
                border: "1px solid transparent",
                color: "#fff",
                fontSize: 12,
                fontWeight: 800,
                opacity: posting ? 0.7 : 1,
              }}
            >
              {posting ? "投稿中..." : "投稿"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
