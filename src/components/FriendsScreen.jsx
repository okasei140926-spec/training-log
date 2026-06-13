import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { S } from "../utils/styles";
import { useFriendsData } from "../hooks/useFriendsData";
import EditUsernameModal from "./friends/EditUsernameModal";
import WorkoutCommentsModal from "./modals/WorkoutCommentsModal";
import Big3DetailModal from "./friends/Big3DetailModal";
import RankingSection from "./friends/RankingSection";
import FeedSection from "./friends/FeedSection";
import ModeTabBar from "./friends/ModeTabBar";
import LoginPrompt from "./friends/LoginPrompt";

const EMPTY_DELETED_WORKOUT_DATES = [];

const RESERVED_USERNAMES = [
    "あなた",
    "自分",
    "自分自身",
    "me",
    "you",
    "admin",
    "運営",
    "管理者",
];

export default function FriendsScreen({
    history,
    manualBests = [],
    sessionSyncVersion = 0,
    user,
    onLogin,
    onLogout,
    onOpenRecord,
    mode = "all",
    deletedWorkoutDates = EMPTY_DELETED_WORKOUT_DATES,
}) {
    const [copied, setCopied] = useState(false);
    const [showEditName, setShowEditName] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [usernameError, setUsernameError] = useState("");
    const [commentsSessionTarget, setCommentsSessionTarget] = useState(null);
    const [rankingTab, setRankingTab] = useState("big3");
    const [selectedBig3Entry, setSelectedBig3Entry] = useState(null);
    const [volumePeriod, setVolumePeriod] = useState("thisMonth");
    const [expandedFeedDates, setExpandedFeedDates] = useState({});
    const [localMode, setLocalMode] = useState(mode === "ranking" ? "ranking" : "feed");
    const showFeedSections = localMode === "feed";
    const showRankingSections = localMode === "ranking";

    const {
        avatarUrl,
        setAvatarUrl,
        friendsRefreshing,
        myUsername,
        setMyUsername,
        activityFeedLoading,
        feedRefreshing,
        activityFeedAction,
        activityFeedStatusMessage,
        likePendingMap,
        today,
        handleRefreshActivityFeed,
        handleCommentCountChange: handleCommentCountChangeBase,
        handleToggleSessionLike,
        formatSessionSetDisplay,
        getDisplayUsername,
        visibleActivityFeed,
        groupedActivityFeed,
        activityCount,
        activeFriendCount,
        activityHeadline,
        feedEmptyState,
        profileInitial,
        hasVisibleFeedUsers,
        activeRanking,
        myRankingSummary,
        shouldShowRankingLoading,
        topThreeRanking,
        podiumOrder,
        compactRankingRows,
        volumePeriodRange,
    } = useFriendsData({
        user,
        history,
        manualBests,
        deletedWorkoutDates,
        sessionSyncVersion,
        showFeedSections,
        showRankingSections,
        rankingTab,
        volumePeriod,
        onOpenRecord,
    });

    useEffect(() => {
        if (rankingTab !== "big3" || !showRankingSections) {
            setSelectedBig3Entry(null);
        }
    }, [rankingTab, showRankingSections]);

    const isReservedUsername = useCallback((rawUsername) => {
        const trimmed = String(rawUsername || "").trim();
        if (!trimmed) return false;

        return RESERVED_USERNAMES.some((reserved) => {
            const isAsciiWord = /^[A-Za-z]+$/.test(reserved);
            return isAsciiWord
                ? trimmed.toLowerCase() === reserved.toLowerCase()
                : trimmed === reserved;
        });
    }, []);

    const validateUsername = useCallback((rawUsername) => {
        const trimmed = rawUsername.trim();
        if (!trimmed) return "ユーザー名を入力してください";

        if (isReservedUsername(trimmed)) {
            return "そのユーザー名は使用できません";
        }

        return "";
    }, [isReservedUsername]);

    const handleCopyInvite = async () => {
        const url = `${window.location.origin}/invite?code=${encodeURIComponent(user.id)}`;
        const text = "一緒にトレーニングを記録しよう！ PUMP";
        if (navigator.share) {
            try { await navigator.share({ title: "PUMP", text, url }); return; } catch { }
        }
        try { await navigator.clipboard.writeText(url); } catch {
            const el = document.createElement("textarea");
            el.value = url;
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            document.body.removeChild(el);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleOpenComments = useCallback((sessionItem) => {
        setCommentsSessionTarget(sessionItem);
    }, []);

    const closeCommentsModal = useCallback(() => {
        setCommentsSessionTarget(null);
    }, []);

    const handleCommentCountChange = useCallback((sessionId, nextCount) => {
        handleCommentCountChangeBase(sessionId, nextCount);
        setCommentsSessionTarget((prev) => (
            prev?.id === sessionId
                ? { ...prev, commentCount: Number(nextCount || 0) }
                : prev
        ));
    }, [handleCommentCountChangeBase]);

    if (!user) {
        return <LoginPrompt onLogin={onLogin} />;
    }
    return (
        <div
            className="fade-in"
            style={{
                ...S.page,
                paddingBottom: "var(--bottom-nav-scroll-padding)",
            }}
        >
            <ModeTabBar localMode={localMode} setLocalMode={setLocalMode} />
            {showFeedSections && (
                <FeedSection
                    activityHeadline={activityHeadline}
                    activityCount={activityCount}
                    activeFriendCount={activeFriendCount}
                    feedRefreshing={feedRefreshing}
                    activityFeedAction={activityFeedAction}
                    activityFeedLoading={activityFeedLoading}
                    handleRefreshActivityFeed={handleRefreshActivityFeed}
                    activityFeedStatusMessage={activityFeedStatusMessage}
                    hasVisibleFeedUsers={hasVisibleFeedUsers}
                    visibleActivityFeed={visibleActivityFeed}
                    feedEmptyState={feedEmptyState}
                    groupedActivityFeed={groupedActivityFeed}
                    expandedFeedDates={expandedFeedDates}
                    setExpandedFeedDates={setExpandedFeedDates}
                    today={today}
                    formatSessionSetDisplay={formatSessionSetDisplay}
                    handleToggleSessionLike={handleToggleSessionLike}
                    likePendingMap={likePendingMap}
                    handleOpenComments={handleOpenComments}
                    user={user}
                    avatarUrl={avatarUrl}
                    setAvatarUrl={setAvatarUrl}
                    profileInitial={profileInitial}
                    getDisplayUsername={getDisplayUsername}
                    myUsername={myUsername}
                    setShowEditName={setShowEditName}
                    setUsernameError={setUsernameError}
                    copied={copied}
                    handleCopyInvite={handleCopyInvite}
                />
            )}

            {showRankingSections && (
                <RankingSection
                    rankingTab={rankingTab}
                    setRankingTab={setRankingTab}
                    myRankingSummary={myRankingSummary}
                    activeRanking={activeRanking}
                    friendsRefreshing={friendsRefreshing}
                    volumePeriod={volumePeriod}
                    setVolumePeriod={setVolumePeriod}
                    volumePeriodRange={volumePeriodRange}
                    shouldShowRankingLoading={shouldShowRankingLoading}
                    topThreeRanking={topThreeRanking}
                    podiumOrder={podiumOrder}
                    setSelectedBig3Entry={setSelectedBig3Entry}
                    compactRankingRows={compactRankingRows}
                />
            )}

            <Big3DetailModal
                selectedBig3Entry={selectedBig3Entry}
                setSelectedBig3Entry={setSelectedBig3Entry}
            />

            <EditUsernameModal
                isOpen={showEditName}
                value={newUsername}
                error={usernameError}
                onChange={(nextValue) => {
                    setNewUsername(nextValue);
                    if (usernameError) setUsernameError("");
                }}
                onSave={async () => {
                    const trimmed = newUsername.trim();
                    const errorMessage = validateUsername(trimmed);
                    if (errorMessage) {
                        setUsernameError(errorMessage);
                        return;
                    }
                    await supabase.from("profiles").update({ username: trimmed }).eq("id", user.id);
                    setMyUsername(trimmed);
                    setUsernameError("");
                    setShowEditName(false);
                    setNewUsername("");
                }}
                onCancel={() => {
                    setShowEditName(false);
                    setNewUsername("");
                    setUsernameError("");
                }}
            />

            <WorkoutCommentsModal
                isOpen={Boolean(commentsSessionTarget)}
                sessionItem={commentsSessionTarget}
                user={user}
                myUsername={myUsername}
                onClose={closeCommentsModal}
                onCommentCountChange={handleCommentCountChange}
            />

        </div >
    );
}
