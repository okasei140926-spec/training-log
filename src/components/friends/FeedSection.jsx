// src/components/friends/FeedSection.jsx
import React, { useRef, useState } from "react";
import { supabase } from "../../utils/supabase";
import { S } from "../../utils/styles";
import InviteCard from "./InviteCard";

const debugLog = (...args) => {
    if (process.env.NODE_ENV !== "production") console.debug(...args);
};

function FeedSection({
    activityHeadline,
    activityCount,
    activeFriendCount,
    feedRefreshing,
    activityFeedAction,
    activityFeedLoading,
    handleRefreshActivityFeed,
    activityFeedStatusMessage,
    hasVisibleFeedUsers,
    visibleActivityFeed,
    feedEmptyState,
    groupedActivityFeed,
    expandedFeedDates,
    setExpandedFeedDates,
    today,
    formatSessionSetDisplay,
    handleToggleSessionLike,
    likePendingMap,
    handleOpenComments,
    user,
    avatarUrl,
    setAvatarUrl,
    profileInitial,
    getDisplayUsername,
    myUsername,
    setShowEditName,
    setUsernameError,
    copied,
    handleCopyInvite,
}) {
    const fileInputRef = useRef(null);
    const [showAvatarSheet, setShowAvatarSheet] = useState(false);
    const [avatarDeleteError, setAvatarDeleteError] = useState("");
    const [avatarDeleteBusy, setAvatarDeleteBusy] = useState(false);

    // Supabase Storage のパスを publicUrl から逆引きする
    const getStoragePathFromUrl = (url) => {
        if (!url) return null;
        try {
            const marker = "/object/public/avatars1/";
            const idx = url.indexOf(marker);
            if (idx === -1) return null;
            return decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
        } catch {
            return null;
        }
    };

    const handleAvatarFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        // タイムスタンプをパスに含めてキャッシュを無効化
        const newPath = `${user.id}-${Date.now()}.${ext}`;
        const oldPath = getStoragePathFromUrl(avatarUrl);

        const { error } = await supabase.storage.from("avatars1").upload(newPath, file, { upsert: false });
        if (error) {
            console.error("[avatar] upload failed", error);
            e.target.value = "";
            return;
        }

        const { data: { publicUrl } } = supabase.storage.from("avatars1").getPublicUrl(newPath);
        await supabase.from("profiles").update({ avatar1_url: publicUrl }).eq("id", user.id);
        setAvatarUrl(publicUrl);
        e.target.value = "";

        // 古いファイルをStorageから削除（失敗しても無視）
        if (oldPath) {
            supabase.storage.from("avatars1").remove([oldPath]).catch(() => {});
        }
    };

    const handleDeleteAvatar = async () => {
        if (!window.confirm("プロフィール写真を削除しますか？")) return;
        setAvatarDeleteError("");
        setAvatarDeleteBusy(true);
        try {
            const oldPath = getStoragePathFromUrl(avatarUrl);
            const { error: dbError } = await supabase
                .from("profiles")
                .update({ avatar1_url: null })
                .eq("id", user.id);
            if (dbError) throw dbError;
            // DB更新成功後にstateとUIを更新
            setAvatarUrl(null);
            setShowAvatarSheet(false);
            // Storageのファイル削除（失敗してもDB/stateは既に更新済みなので無視）
            if (oldPath) {
                supabase.storage.from("avatars1").remove([oldPath]).catch(() => {});
            }
        } catch (err) {
            console.error("[avatar] delete failed", err);
            setAvatarDeleteError("削除に失敗しました。もう一度お試しください。");
        } finally {
            setAvatarDeleteBusy(false);
        }
    };

    return (
        <>
            <div
                style={{
                    background: "var(--card)",
                    borderRadius: 22,
                    padding: 18,
                    marginBottom: 14,
                    border: "1px solid var(--border2)",
                    boxShadow: "var(--shadow-card)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>最近のアクティビティ</div>
                        <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 4 }}>
                            {activityHeadline}
                        </div>
                        {activeFriendCount > 0 && (
                            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
                                友達{activeFriendCount}人が直近7日で記録しています
                            </div>
                        )}
                    </div>
                    <div
                        style={{
                            padding: "8px 12px",
                            borderRadius: 14,
                            background: "rgba(18, 199, 194, 0.06)",
                            border: "1px solid var(--border2)",
                            fontSize: 12,
                            fontWeight: 800,
                            color: "var(--text2)",
                            flexShrink: 0,
                        }}
                    >
                        アクティビティ {activityCount}件
                    </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 700 }}>
                            新しい記録順に表示しています
                        </div>
                        {feedRefreshing && activityFeedAction === "refresh" && (
                            <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 700 }}>
                                更新中...
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={handleRefreshActivityFeed}
                        disabled={activityFeedLoading || feedRefreshing}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 14,
                            border: "1px solid var(--border2)",
                            background: "var(--card2)",
                            color: "var(--text2)",
                            fontSize: 12,
                            fontWeight: 800,
                            flexShrink: 0,
                        }}
                    >
                        {(activityFeedLoading || feedRefreshing) && activityFeedAction === "refresh" ? "更新中..." : "更新"}
                    </button>
                </div>

                {activityFeedStatusMessage && (
                    <div
                        style={{
                            fontSize: 11,
                            marginTop: 10,
                            color: activityFeedStatusMessage.includes("できません")
                                ? "var(--danger, #dc2626)"
                                : "var(--accent)",
                            fontWeight: 700,
                        }}
                    >
                        {activityFeedStatusMessage}
                    </div>
                )}
            </div>

            {!hasVisibleFeedUsers && visibleActivityFeed.length === 0 && !activityFeedLoading && !feedRefreshing ? (
                <div
                    style={{
                        ...S.sectionCard,
                        padding: 22,
                        textAlign: "center",
                        marginBottom: 14,
                    }}
                >
                    <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", marginBottom: 8 }}>
                        {feedEmptyState.title}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, marginBottom: 18 }}>
                        {feedEmptyState.body}
                    </div>
                    <button
                        type="button"
                        onClick={() => feedEmptyState.onClick?.()}
                        style={{
                            padding: "14px 22px",
                            borderRadius: 16,
                            border: "1px solid transparent",
                            background: "linear-gradient(135deg, #12C7C2, #33E1DB)",
                            color: "#fff",
                            fontSize: 14,
                            fontWeight: 900,
                            boxShadow: "0 16px 28px rgba(18, 199, 194, 0.18)",
                        }}
                    >
                        {feedEmptyState.action}
                    </button>
                </div>
            ) : (
                <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
                    {groupedActivityFeed.map((userGroup) => {
                        const avatarSeed = userGroup.userName?.[0]?.toUpperCase() || "?";

                        return (
                            <div
                                key={userGroup.userId}
                                style={{
                                    background: "var(--card)",
                                    borderRadius: 22,
                                    padding: 12,
                                    border: "1px solid var(--border2)",
                                    boxShadow: "var(--shadow-card)",
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                                    <div style={{ width: 38, height: 38, borderRadius: 19, background: "linear-gradient(135deg, var(--accent), var(--accent2))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, overflow: "hidden", flexShrink: 0 }}>
                                        {userGroup.profile?.avatar1_url
                                            ? <img src={userGroup.profile.avatar1_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                            : avatarSeed
                                        }
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)", lineHeight: 1.15 }}>
                                            {userGroup.userName}
                                        </div>
                                        {userGroup.handle && (
                                            <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 1, lineHeight: 1.2 }}>
                                                {userGroup.handle}
                                            </div>
                                        )}
                                    <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 3, fontWeight: 700, lineHeight: 1.15 }}>
                                        直近7日 {userGroup.activityDayCount}日記録
                                    </div>
                                </div>
                            </div>

                                {userGroup.activityDayCount === 0 ? (
                                    <div
                                        style={{
                                            fontSize: 12,
                                            color: "var(--text3)",
                                            lineHeight: 1.5,
                                            padding: "4px 2px 2px",
                                        }}
                                    >
                                        直近7日の記録なし
                                    </div>
                                ) : (
                                    <div style={{ display: "grid", gap: 4 }}>
                                        {userGroup.dates.map((dateGroup) => {
                                        const expandedKey = `${userGroup.userId}:${dateGroup.date}`;
                                        const isExpanded = Boolean(expandedFeedDates[expandedKey]);
                                        const primaryItem = dateGroup.primaryItem;
                                        const canInteract = Boolean(primaryItem?.sessionId);
                                        const isOwnWorkout = primaryItem?.user_id === user.id;

                                        return (
                                            <div
                                                key={expandedKey}
                                                style={{
                                                    borderRadius: 12,
                                                    border: isExpanded
                                                        ? "1px solid rgba(18, 199, 194, 0.16)"
                                                        : "1px solid rgba(18, 199, 194, 0.12)",
                                                    background: isExpanded
                                                        ? "rgba(18, 199, 194, 0.08)"
                                                        : "rgba(18, 199, 194, 0.04)",
                                                    overflow: "hidden",
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        debugLog("[feed grouped] expand date", {
                                                            userId: userGroup.userId,
                                                            date: dateGroup.date,
                                                            exerciseCount: dateGroup.detailedExercises.length,
                                                        });
                                                        setExpandedFeedDates((prev) => ({
                                                            ...prev,
                                                            [expandedKey]: !prev[expandedKey],
                                                        }));
                                                    }}
                                                    style={{
                                                        width: "100%",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        gap: 7,
                                                        minHeight: 44,
                                                        padding: "3px 11px",
                                                        border: "none",
                                                        background: "transparent",
                                                        color: "var(--text)",
                                                        fontSize: 11,
                                                        fontWeight: 800,
                                                        lineHeight: 1.1,
                                                        textAlign: "left",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                                        <span style={{ color: "var(--text2)", fontSize: 9, width: 10 }}>
                                                            {isExpanded ? "▼" : "▶"}
                                                        </span>
                                                        <span>{formatFeedDateShort(dateGroup.date, today)}</span>
                                                    </span>
                                                </button>

                                                {isExpanded && (
                                                    <div style={{ padding: "0 11px 9px" }}>
                                                        <div style={{ display: "grid", gap: 2 }}>
                                                            {dateGroup.detailedExercises.map((summaryItem, index) => {
                                                                const showDivider = index !== dateGroup.detailedExercises.length - 1;
                                                                return (
                                                                    <div
                                                                        key={`${expandedKey}-${summaryItem.body_part || ""}-${summaryItem.exercise_name}-${index}`}
                                                                        style={{
                                                                            padding: showDivider ? "4px 0 6px" : "4px 0 2px",
                                                                            borderBottom: showDivider ? "1px solid rgba(217, 228, 239, 0.85)" : "none",
                                                                        }}
                                                                    >
                                                                        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
                                                                            {summaryItem.exercise_name}
                                                                        </div>
                                                                        <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 2, lineHeight: 1.45 }}>
                                                                            {Array.isArray(summaryItem.sets) && summaryItem.sets.length
                                                                                ? summaryItem.sets.map(formatSessionSetDisplay).join(" / ")
                                                                                : `${Math.round(Number(summaryItem.max_weight || 0) * 10) / 10 || 0}kg × ${summaryItem.set_count}`}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>

                                                        {canInteract && (
                                                            <div
                                                                style={{
                                                                    display: "flex",
                                                                    justifyContent: "space-between",
                                                                    alignItems: "center",
                                                                    gap: 10,
                                                                    marginTop: 8,
                                                                    paddingTop: 8,
                                                                    borderTop: "1px solid rgba(217, 228, 239, 0.75)",
                                                                }}
                                                            >
                                                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                                    {isOwnWorkout ? (
                                                                        <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 800 }}>
                                                                            ♥ {Number(primaryItem.likeCount || 0)}
                                                                        </div>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleToggleSessionLike(primaryItem.sessionId)}
                                                                            disabled={Boolean(likePendingMap[primaryItem.sessionId])}
                                                                            style={{
                                                                                display: "inline-flex",
                                                                                alignItems: "center",
                                                                                gap: 6,
                                                                                padding: "9px 12px",
                                                                                borderRadius: 14,
                                                                                border: "1px solid var(--border2)",
                                                                                background: primaryItem.likedByMe ? "var(--danger-soft, #fee2e2)" : "var(--card2)",
                                                                                color: primaryItem.likedByMe ? "var(--danger, #dc2626)" : "var(--text2)",
                                                                                fontSize: 12,
                                                                                fontWeight: 800,
                                                                                opacity: likePendingMap[primaryItem.sessionId] ? 0.7 : 1,
                                                                            }}
                                                                        >
                                                                            <span>{primaryItem.likedByMe ? "♥" : "♡"}</span>
                                                                            <span>{Number(primaryItem.likeCount || 0)}</span>
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleOpenComments({ ...primaryItem, id: primaryItem.sessionId })}
                                                                        style={{
                                                                            display: "inline-flex",
                                                                            alignItems: "center",
                                                                            gap: 6,
                                                                            padding: "9px 12px",
                                                                            borderRadius: 14,
                                                                            border: "1px solid var(--border2)",
                                                                            background: "var(--card2)",
                                                                            color: "var(--text2)",
                                                                            fontSize: 12,
                                                                            fontWeight: 800,
                                                                        }}
                                                                    >
                                                                        <span>💬</span>
                                                                        <span>{Number(primaryItem.commentCount || 0)}</span>
                                                                    </button>
                                                                </div>
                                                                {likePendingMap[primaryItem.sessionId] && (
                                                                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                                                                        更新中...
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{ display: "grid", gap: 12 }}>
                <div
                    style={{
                        background: "var(--card)",
                        borderRadius: 20,
                        padding: 16,
                        border: "1px solid var(--border2)",
                        boxShadow: "var(--shadow-card)",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div
                                style={{
                                    width: 42,
                                    height: 42,
                                    borderRadius: 21,
                                    background: "linear-gradient(135deg, var(--accent2), #7DD3FC)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 14,
                                    fontWeight: 900,
                                    color: "#fff",
                                    overflow: "hidden",
                                    cursor: "pointer",
                                    flexShrink: 0,
                                }}
                                onClick={() => setShowAvatarSheet(true)}
                            >
                                {avatarUrl
                                    ? <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    : profileInitial
                                }
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={handleAvatarFileChange}
                            />
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                                    {getDisplayUsername(myUsername, { isMe: true })}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                                    友達と記録をつなげよう
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setUsernameError("");
                                setShowEditName(true);
                            }}
                            style={{
                                padding: "8px 12px",
                                borderRadius: 12,
                                border: "1px solid var(--border2)",
                                background: "var(--card2)",
                                color: "var(--text2)",
                                fontSize: 12,
                                fontWeight: 700,
                            }}
                        >
                            名前を編集
                        </button>
                    </div>
                </div>

                <InviteCard copied={copied} onCopyInvite={handleCopyInvite} />
            </div>

            {/* アバター変更アクションシート */}
            {showAvatarSheet && (
                <div
                    onClick={() => setShowAvatarSheet(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 600,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        padding: "0 12px calc(12px + env(safe-area-inset-bottom, 0px))",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 430,
                            borderRadius: 20,
                            background: "var(--card)",
                            border: "1px solid var(--border2)",
                            overflow: "hidden",
                            boxShadow: "0 24px 60px rgba(0,0,0,0.32)",
                        }}
                    >
                        {avatarDeleteError && (
                            <div style={{
                                padding: "12px 20px",
                                fontSize: 12,
                                color: "#EF4444",
                                background: "rgba(239,68,68,0.08)",
                                borderBottom: "1px solid var(--border2)",
                            }}>
                                {avatarDeleteError}
                            </div>
                        )}
                        {[
                            {
                                label: "写真を選択",
                                icon: "🖼️",
                                action: () => { setShowAvatarSheet(false); fileInputRef.current?.click(); },
                                danger: false,
                                disabled: avatarDeleteBusy,
                            },
                            ...(avatarUrl ? [{
                                label: avatarDeleteBusy ? "削除中…" : "写真を削除",
                                icon: "🗑️",
                                action: handleDeleteAvatar,
                                danger: true,
                                disabled: avatarDeleteBusy,
                            }] : []),
                            {
                                label: "キャンセル",
                                icon: null,
                                action: () => { setAvatarDeleteError(""); setShowAvatarSheet(false); },
                                danger: false,
                                cancel: true,
                                disabled: avatarDeleteBusy,
                            },
                        ].map(({ label, icon, action, danger, cancel, disabled }, i) => (
                            <button
                                key={label}
                                type="button"
                                onClick={action}
                                disabled={disabled}
                                style={{
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    padding: "16px 20px",
                                    background: "none",
                                    border: "none",
                                    borderTop: i > 0 ? "1px solid var(--border2)" : "none",
                                    color: disabled ? "var(--text3)" : danger ? "#EF4444" : cancel ? "var(--text2)" : "var(--text)",
                                    fontSize: cancel ? 14 : 15,
                                    fontWeight: cancel ? 700 : 800,
                                    textAlign: "left",
                                    cursor: disabled ? "not-allowed" : "pointer",
                                    opacity: disabled ? 0.6 : 1,
                                }}
                            >
                                {icon && <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{icon}</span>}
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

const formatFeedDateShort = (workoutDate, todayKey) => {
    const normalizedDate = String(workoutDate || "").slice(0, 10);
    if (!normalizedDate) return "";
    if (todayKey && normalizedDate === String(todayKey).slice(0, 10)) return "今日";
    const [, month = "", day = ""] = normalizedDate.split("-");
    return `${month}-${day}`;
};

export default FeedSection;
