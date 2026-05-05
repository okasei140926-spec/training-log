import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { S } from "../utils/styles";
import { getBig3ExerciseKey } from "../utils/exerciseName";
import {
    buildHistoryFromWorkoutRows,
    calc1RM,
    formatDateKey,
    getRecordSourceSets,
    getValidWorkoutDatesFromHistory,
    hasValidWorkoutOnDate,
    sanitizeHistoryRecord,
    sanitizeWorkoutSets,
} from "../utils/helpers";
import MonthlyWorkoutRankingCard from "./friends/MonthlyWorkoutRankingCard";
import Big3RankingCard from "./friends/Big3RankingCard";
import Big3OvertakeAlerts from "./friends/Big3OvertakeAlerts";
import EditUsernameModal from "./friends/EditUsernameModal";
import InviteCard from "./friends/InviteCard";
import NotificationSettings from "./NotificationSettings";
import WorkoutCommentsModal from "./modals/WorkoutCommentsModal";
import WorkoutSessionShareModal from "./modals/WorkoutSessionShareModal";

const BIG3_EXERCISES = [
    { key: "bench", match: "ベンチプレス", shortLabel: "ベンチ" },
    { key: "squat", match: "スクワット", shortLabel: "スクワット" },
    { key: "deadlift", match: "デッドリフト", shortLabel: "デッド" },
];
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
const ACTIVITY_FEED_PAGE_SIZE = 20;

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

export default function FriendsScreen({ history, manualBests = [], sessionSyncVersion = 0, onCopyMenu, user, onLogin, onLogout, mode = "all" }) {
    const [openDates, setOpenDates] = useState({});
    const [copied, setCopied] = useState(false);
    const [friends, setFriends] = useState([]);
    const [friendIds, setFriendIds] = useState([]);
    const [todayActiveMap, setTodayActiveMap] = useState({});
    const [showEditName, setShowEditName] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [usernameError, setUsernameError] = useState("");
    const [avatarUrl, setAvatarUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [kudos, setKudos] = useState({});
    const [receivedKudos, setReceivedKudos] = useState([]);
    const [myUsername, setMyUsername] = useState("");
    const [seenBig3Overtakes, setSeenBig3Overtakes] = useState({});
    const [visibleBig3OvertakeEvents, setVisibleBig3OvertakeEvents] = useState([]);
    const [activityFeed, setActivityFeed] = useState([]);
    const [activityFeedHasMore, setActivityFeedHasMore] = useState(false);
    const [activityFeedLoading, setActivityFeedLoading] = useState(false);
    const [activityFeedAction, setActivityFeedAction] = useState(null);
    const [activityFeedStatusMessage, setActivityFeedStatusMessage] = useState("");
    const [shareSessionTarget, setShareSessionTarget] = useState(null);
    const [sharePhotoRows, setSharePhotoRows] = useState([]);
    const [sharePhotoUrls, setSharePhotoUrls] = useState({});
    const [sharePreparingSessionId, setSharePreparingSessionId] = useState(null);
    const [sessionSettingsUpdatingId, setSessionSettingsUpdatingId] = useState(null);
    const [likePendingMap, setLikePendingMap] = useState({});
    const [commentsSessionTarget, setCommentsSessionTarget] = useState(null);
    const activityFeedOffsetRef = useRef(0);
    const activityFeedStatusTimeoutRef = useRef(null);
    const today = formatDateKey();
    const currentMonthPrefix = today.slice(0, 7);
    const big3SeenStorageKey = "friends_big3_overtake_seen_v1";
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - 7);
    const thresholdStr = formatDateKey(thresholdDate);
    const showFeedSections = mode !== "ranking";
    const showRankingSections = mode !== "feed";

    const hasTodayWorkoutRecord = useCallback((workoutData) => {
        return hasValidWorkoutOnDate(workoutData, today);
    }, [today]);

    const countMonthlyWorkoutDays = useCallback((historyData) => {
        return getValidWorkoutDatesFromHistory(historyData, {
            prefix: currentMonthPrefix,
        }).length;
    }, [currentMonthPrefix]);

    const safeCalc1RM = useCallback((sets) => {
        const validSets = sanitizeWorkoutSets(sets, { allowBodyweight: false }).filter((set) => {
            const weightNum = Number(set.weight);
            const repsNum = Number(set.reps);
            return weightNum <= 1000 && repsNum <= 100;
        });

        if (!validSets.length) return 0;

        return calc1RM(validSets);
    }, []);

    const getRecordSets = useCallback((record) => {
        return sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight: true });
    }, []);

    const matchBig3Exercise = useCallback((name) => {
        return getBig3ExerciseKey(name);
    }, []);

    const computeBig3FromHistory = useCallback((historyData) => {
        const bests = { bench: 0, squat: 0, deadlift: 0 };

        Object.entries(historyData || {}).forEach(([name, records]) => {
            const key = matchBig3Exercise(name);
            if (!key) return;

            (records || []).forEach((record) => {
                const best = Math.round(safeCalc1RM(getRecordSets(record)));
                if (best > bests[key]) bests[key] = best;
            });
        });

        return {
            ...bests,
            total: bests.bench + bests.squat + bests.deadlift,
        };
    }, [getRecordSets, matchBig3Exercise, safeCalc1RM]);

    const computeBig3FromManualBests = useCallback((manualBestRows) => {
        const bests = { bench: 0, squat: 0, deadlift: 0 };

        (manualBestRows || []).forEach((best) => {
            const key = matchBig3Exercise(best?.exercise_name);
            if (!key) return;

            const value = Math.round(safeCalc1RM([{
                weight: best.weight,
                reps: best.reps,
            }]));
            if (value > bests[key]) bests[key] = value;
        });

        return {
            ...bests,
            total: bests.bench + bests.squat + bests.deadlift,
        };
    }, [matchBig3Exercise, safeCalc1RM]);

    const mergeBig3Bests = useCallback((base, manual) => {
        const merged = {
            bench: Math.max(base?.bench || 0, manual?.bench || 0),
            squat: Math.max(base?.squat || 0, manual?.squat || 0),
            deadlift: Math.max(base?.deadlift || 0, manual?.deadlift || 0),
        };

        return {
            ...merged,
            total: merged.bench + merged.squat + merged.deadlift,
        };
    }, []);

    const buildRecentGrouped = useCallback((historyData) => {
        return Object.entries(historyData || {})
            .flatMap(([name, recs]) =>
                (recs || []).map((record) => {
                    const sanitizedRecord = sanitizeHistoryRecord(record, { allowBodyweight: true });
                    if (!sanitizedRecord?.date || !sanitizedRecord.sets?.length) return null;

                    return {
                        name,
                        date: sanitizedRecord.date,
                        sets: sanitizedRecord.sets,
                        order: Number.isFinite(Number(sanitizedRecord.order)) ? Number(sanitizedRecord.order) : 999,
                    };
                }).filter(Boolean)
            )
            .filter((record) => record.date >= thresholdStr)
            .reduce((acc, record) => {
                if (!acc[record.date]) acc[record.date] = {};
                acc[record.date][record.name] = {
                    sets: record.sets,
                    order: record.order,
                };
                return acc;
            }, {});
    }, [thresholdStr]);

    const fetchTodayActive = useCallback(async (ids) => {
        if (!user || !ids.length) {
            setTodayActiveMap({});
            return;
        }

        const { data: todayWorkouts, error } = await supabase
            .from("workouts")
            .select("user_id, date, data")
            .eq("date", today)
            .in("user_id", ids);

        if (error) throw error;

        const nextTodayActiveMap = {};
        (todayWorkouts || []).forEach((workout) => {
            nextTodayActiveMap[workout.user_id] = hasTodayWorkoutRecord(workout.data);
        });
        setTodayActiveMap(nextTodayActiveMap);
    }, [hasTodayWorkoutRecord, today, user]);

    const handleCopyInvite = async () => {
        const url = `${window.location.origin}?ref=${user.id}`;
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

    const getDisplayUsername = useCallback((rawUsername, { isMe = false } = {}) => {
        if (isMe) return "あなた";

        const trimmed = String(rawUsername || "").trim();
        if (!trimmed) return "ユーザー";
        if (isReservedUsername(trimmed)) return "ユーザー";
        return trimmed;
    }, [isReservedUsername]);

    const validateUsername = useCallback((rawUsername) => {
        const trimmed = rawUsername.trim();
        if (!trimmed) return "ユーザー名を入力してください";

        if (isReservedUsername(trimmed)) {
            return "そのユーザー名は使用できません";
        }

        return "";
    }, [isReservedUsername]);

    const showActivityFeedStatusMessage = useCallback((message) => {
        if (activityFeedStatusTimeoutRef.current) {
            window.clearTimeout(activityFeedStatusTimeoutRef.current);
        }
        setActivityFeedStatusMessage(message);
        activityFeedStatusTimeoutRef.current = window.setTimeout(() => {
            setActivityFeedStatusMessage("");
            activityFeedStatusTimeoutRef.current = null;
        }, 2200);
    }, []);

    const fetchFriendsData = useCallback(async () => {
        if (!user) {
            setFriendIds([]);
            setFriends([]);
            setTodayActiveMap({});
            return false;
        }

        setLoading(true);
        try {
            const { data: friendships, error: friendshipsError } = await supabase
                .from("friendships")
                .select("requester_id, receiver_id")
                .eq("status", "accepted")
                .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`);

            if (friendshipsError) throw friendshipsError;

            if (!friendships || friendships.length === 0) {
                setFriendIds([]);
                setFriends([]);
                setTodayActiveMap({});
                setLoading(false);
                return true;
            }

            const nextFriendIds = [...new Set(
                friendships.map((f) =>
                    f.requester_id === user.id ? f.receiver_id : f.requester_id
                )
            )];

            const [profilesRes, workoutsRes] = await Promise.all([
                supabase
                    .from("profiles")
                    .select("id, username, avatar1_url")
                    .in("id", nextFriendIds),
                supabase
                    .from("workouts")
                    .select("user_id, date, data")
                    .in("user_id", nextFriendIds)
                    .order("date", { ascending: false }),
            ]);

            const { data: profiles, error: profilesError } = profilesRes;
            const { data: workouts, error: workoutsError } = workoutsRes;

            if (profilesError) throw profilesError;
            if (workoutsError) throw workoutsError;

            const workoutRowsMap = new Map();
            (workouts || []).forEach((workout) => {
                const current = workoutRowsMap.get(workout.user_id) || [];
                current.push(workout);
                workoutRowsMap.set(workout.user_id, current);
            });

            const friendsWithHistory = (profiles || []).map((p) => ({
                ...p,
                workoutRows: workoutRowsMap.get(p.id) || [],
                history: buildHistoryFromWorkoutRows(workoutRowsMap.get(p.id) || []),
            }));

            setFriendIds(nextFriendIds);
            setFriends(friendsWithHistory);
            await fetchTodayActive(nextFriendIds);
            return true;
        } catch (err) {
            console.error(err);
            setFriendIds([]);
            setFriends([]);
            setTodayActiveMap({});
            return false;
        } finally {
            setLoading(false);
        }
    }, [fetchTodayActive, user]);

    const fetchActivityFeed = useCallback(async ({ reset = false } = {}) => {
        if (!user?.id) {
            setActivityFeed([]);
            activityFeedOffsetRef.current = 0;
            setActivityFeedHasMore(false);
            return false;
        }

        const feedUserIds = [...new Set([user.id, ...friendIds])];
        const offset = reset ? 0 : activityFeedOffsetRef.current;

        setActivityFeedLoading(true);

        try {
            const { data: sessions, error: sessionsError } = await supabase
                .from("workout_sessions")
                .select("id, user_id, workout_date, created_at, updated_at, duration_sec, total_volume, exercise_count, summary_json, photo_id, photo_visibility, visibility")
                .in("user_id", feedUserIds)
                .eq("workout_date", today)
                .order("created_at", { ascending: false })
                .range(offset, offset + ACTIVITY_FEED_PAGE_SIZE - 1);

            if (sessionsError) throw sessionsError;

            const profileIds = [...new Set((sessions || []).map((session) => session.user_id).filter(Boolean))];
            const photoIds = [...new Set(
                (sessions || [])
                    .filter((session) => session.photo_visibility === "friends" && session.photo_id)
                    .map((session) => session.photo_id)
            )];
            const sessionIds = [...new Set((sessions || []).map((session) => session.id).filter(Boolean))];

            const [profilesRes, photosRes, likesRes, commentsRes] = await Promise.all([
                profileIds.length
                    ? supabase.from("profiles").select("id, username, avatar1_url").in("id", profileIds)
                    : Promise.resolve({ data: [], error: null }),
                photoIds.length
                    ? supabase.from("progress_photos").select("id, storage_path").in("id", photoIds)
                    : Promise.resolve({ data: [], error: null }),
                sessionIds.length
                    ? supabase.from("workout_session_likes").select("session_id, user_id").in("session_id", sessionIds)
                    : Promise.resolve({ data: [], error: null }),
                sessionIds.length
                    ? supabase.from("workout_session_comments").select("id, session_id").in("session_id", sessionIds)
                    : Promise.resolve({ data: [], error: null }),
            ]);

            if (profilesRes.error) throw profilesRes.error;
            if (photosRes.error) throw photosRes.error;
            if (likesRes.error) throw likesRes.error;
            if (commentsRes.error) throw commentsRes.error;

            const profileMap = new Map((profilesRes.data || []).map((profile) => [profile.id, profile]));
            const photoRows = photosRes.data || [];
            const likeRows = likesRes.data || [];
            const commentRows = commentsRes.data || [];
            const signedEntries = await Promise.all(photoRows.map(async (row) => {
                try {
                    const { data: signedData, error: signedError } = await supabase
                        .storage
                        .from("progress-photos-private")
                        .createSignedUrl(row.storage_path, 3600);
                    if (signedError) return null;
                    return [row.id, signedData?.signedUrl || null];
                } catch (error) {
                    console.error("activity feed photo signed url failed", error);
                    return null;
                }
            }));
            const photoUrlMap = new Map(signedEntries.filter(Boolean));
            const likeCountMap = new Map();
            const likedSessionIds = new Set();
            const commentCountMap = new Map();

            likeRows.forEach((row) => {
                if (!row?.session_id) return;
                likeCountMap.set(row.session_id, (likeCountMap.get(row.session_id) || 0) + 1);
                if (row.user_id === user.id) {
                    likedSessionIds.add(row.session_id);
                }
            });

            commentRows.forEach((row) => {
                if (!row?.session_id) return;
                commentCountMap.set(row.session_id, (commentCountMap.get(row.session_id) || 0) + 1);
            });

            const items = (sessions || []).map((session) => {
                const profile = profileMap.get(session.user_id) || {};
                const summary = session.summary_json || {};
                const summaryItems = Array.isArray(summary.items) ? summary.items : [];

                return {
                    ...session,
                    profile,
                    summary,
                    summaryItems,
                    photoUrl: session.photo_visibility === "friends" ? photoUrlMap.get(session.photo_id) || null : null,
                    likeCount: likeCountMap.get(session.id) || 0,
                    likedByMe: likedSessionIds.has(session.id),
                    commentCount: commentCountMap.get(session.id) || 0,
                };
            });

            setActivityFeed((prev) => {
                const next = reset ? items : [...prev, ...items];
                return next.filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index);
            });
            activityFeedOffsetRef.current = offset + items.length;
            setActivityFeedHasMore(items.length === ACTIVITY_FEED_PAGE_SIZE);
            return true;
        } catch (error) {
            console.error("activity feed fetch failed", error);
            if (reset) {
                setActivityFeed([]);
                activityFeedOffsetRef.current = 0;
                setActivityFeedHasMore(false);
            }
            return false;
        } finally {
            setActivityFeedLoading(false);
        }
    }, [friendIds, today, user?.id]);

    const handleRefreshActivityFeed = useCallback(async () => {
        if (activityFeedLoading) return;
        setActivityFeedAction("refresh");
        setActivityFeedStatusMessage("");
        const [feedOk, friendsOk] = await Promise.all([
            fetchActivityFeed({ reset: true }),
            fetchFriendsData(),
        ]);
        setActivityFeedAction(null);
        showActivityFeedStatusMessage(feedOk && friendsOk ? "更新しました" : "更新できませんでした");
    }, [activityFeedLoading, fetchActivityFeed, fetchFriendsData, showActivityFeedStatusMessage]);

    const handleLoadMoreActivityFeed = useCallback(async () => {
        if (activityFeedLoading) return;
        setActivityFeedAction("more");
        await fetchActivityFeed({ reset: false });
        setActivityFeedAction(null);
    }, [activityFeedLoading, fetchActivityFeed]);

    const closeShareSessionModal = useCallback(() => {
        setShareSessionTarget(null);
        setSharePhotoRows([]);
        setSharePhotoUrls({});
        setSharePreparingSessionId(null);
    }, []);

    const handleOpenComments = useCallback((sessionItem) => {
        setCommentsSessionTarget(sessionItem);
    }, []);

    const closeCommentsModal = useCallback(() => {
        setCommentsSessionTarget(null);
    }, []);

    const handleCommentCountChange = useCallback((sessionId, nextCount) => {
        setActivityFeed((prev) => prev.map((item) => (
            item.id === sessionId
                ? { ...item, commentCount: Number(nextCount || 0) }
                : item
        )));
        setCommentsSessionTarget((prev) => (
            prev?.id === sessionId
                ? { ...prev, commentCount: Number(nextCount || 0) }
                : prev
        ));
    }, []);

    const handleOpenSessionShare = useCallback(async (sessionItem) => {
        if (!user?.id || !sessionItem?.workout_date || sharePreparingSessionId) return;

        setSharePreparingSessionId(sessionItem.id);
        setSharePhotoRows([]);
        setSharePhotoUrls({});

        try {
            const { data, error } = await supabase
                .from("progress_photos")
                .select("id, storage_path, workout_date")
                .eq("user_id", user.id)
                .eq("workout_date", sessionItem.workout_date);

            if (error) throw error;

            const nextRows = [...(data || [])].sort((a, b) =>
                String(a.storage_path || "").localeCompare(String(b.storage_path || ""))
            );

            const signedEntries = await Promise.all(nextRows.map(async (row) => {
                try {
                    const { data: signedData, error: signedError } = await supabase
                        .storage
                        .from("progress-photos-private")
                        .createSignedUrl(row.storage_path, 3600);
                    return signedError ? null : [row.id, signedData?.signedUrl || null];
                } catch (signedError) {
                    console.error("session share photo signed url failed", signedError);
                    return null;
                }
            }));

            setSharePhotoRows(nextRows);
            setSharePhotoUrls(Object.fromEntries(signedEntries.filter(Boolean)));
        } catch (error) {
            console.error("session share photo load failed", error);
            setSharePhotoRows([]);
            setSharePhotoUrls({});
        } finally {
            setShareSessionTarget(sessionItem);
            setSharePreparingSessionId(null);
        }
    }, [sharePreparingSessionId, user?.id]);

    const handleUpdateSessionVisibility = useCallback(async (sessionId, patch) => {
        if (!user?.id || !sessionId || sessionSettingsUpdatingId) return;

        setSessionSettingsUpdatingId(sessionId);
        setActivityFeedStatusMessage("");

        try {
            const { error } = await supabase
                .from("workout_sessions")
                .update(patch)
                .eq("id", sessionId)
                .eq("user_id", user.id);

            if (error) throw error;

            setActivityFeed((prev) => prev.map((item) => (
                item.id === sessionId
                    ? {
                        ...item,
                        ...patch,
                        photoUrl: patch.photo_visibility === "hidden" ? null : item.photoUrl,
                    }
                    : item
            )));

            await fetchActivityFeed({ reset: true });
            showActivityFeedStatusMessage("公開設定を更新しました");
        } catch (error) {
            console.error("session visibility update failed", error);
            showActivityFeedStatusMessage("公開設定を更新できませんでした");
        } finally {
            setSessionSettingsUpdatingId(null);
        }
    }, [fetchActivityFeed, sessionSettingsUpdatingId, showActivityFeedStatusMessage, user?.id]);

    const handleToggleSessionLike = useCallback(async (sessionId) => {
        if (!user?.id || !sessionId || likePendingMap[sessionId]) return;

        const currentItem = activityFeed.find((item) => item.id === sessionId);
        if (!currentItem || currentItem.user_id === user.id) return;

        const previousLiked = Boolean(currentItem.likedByMe);
        const previousCount = Number(currentItem.likeCount || 0);
        const optimisticLiked = !previousLiked;
        const optimisticCount = Math.max(0, previousCount + (optimisticLiked ? 1 : -1));

        setLikePendingMap((prev) => ({ ...prev, [sessionId]: true }));
        setActivityFeed((prev) => prev.map((item) => (
            item.id === sessionId
                ? { ...item, likedByMe: optimisticLiked, likeCount: optimisticCount }
                : item
        )));

        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const accessToken = session?.access_token;

            if (!accessToken) {
                throw new Error("ログインが必要です");
            }

            const response = await fetch("/api/toggle-workout-like", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ sessionId }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.error || "いいねの更新に失敗しました。");
            }

            setActivityFeed((prev) => prev.map((item) => (
                item.id === sessionId
                    ? {
                        ...item,
                        likedByMe: Boolean(data.liked),
                        likeCount: Number(data.likeCount || 0),
                    }
                    : item
            )));
        } catch (error) {
            console.error("toggle workout like failed on client", error);
            setActivityFeed((prev) => prev.map((item) => (
                item.id === sessionId
                    ? {
                        ...item,
                        likedByMe: previousLiked,
                        likeCount: previousCount,
                    }
                    : item
            )));
            showActivityFeedStatusMessage("いいねを更新できませんでした");
        } finally {
            setLikePendingMap((prev) => {
                const next = { ...prev };
                delete next[sessionId];
                return next;
            });
        }
    }, [activityFeed, likePendingMap, showActivityFeedStatusMessage, user?.id]);

    useEffect(() => {
        if (!user) return;
        fetchFriendsData();
    }, [user, fetchFriendsData, sessionSyncVersion]);

    useEffect(() => {
        if (!user || !friendIds.length) return;

        const intervalId = setInterval(() => {
            fetchTodayActive(friendIds).catch(console.error);
        }, 60000);

        return () => clearInterval(intervalId);
    }, [user, friendIds, fetchTodayActive]);

    useEffect(() => {
        if (!user) return;
        fetchActivityFeed({ reset: true });
    }, [user, friendIds, fetchActivityFeed, sessionSyncVersion]);

    useEffect(() => {
        if (!user) return undefined;
        const intervalId = setInterval(() => {
            fetchActivityFeed({ reset: true }).catch(console.error);
        }, 90000);

        return () => clearInterval(intervalId);
    }, [user, fetchActivityFeed]);

    useEffect(() => {
        return () => {
            if (activityFeedStatusTimeoutRef.current) {
                window.clearTimeout(activityFeedStatusTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!user) return;
        const fetchKudos = async () => {
            const today = formatDateKey();

            // 自分が送ったkudos
            const { data: sent } = await supabase
                .from("kudos")
                .select("to_user_id")
                .eq("from_user_id", user.id)
                .eq("date", today);

            // 自分がもらったkudos
            const { data: received } = await supabase
                .from("kudos")
                .select("from_user_id, profiles(username)")
                .eq("to_user_id", user.id)
                .eq("date", today);

            const sentMap = {};
            (sent || []).forEach(k => { sentMap[k.to_user_id] = true; });
            setKudos(sentMap);
            setReceivedKudos(received || []);
        };
        fetchKudos();
    }, [user]);


    useEffect(() => {
        if (!user) return;
        const fetchProfile = async () => {
            const { data } = await supabase
                .from("profiles")
                .select("avatar1_url, username")
                .eq("id", user.id)
                .single();
            if (data?.avatar1_url) setAvatarUrl(data.avatar1_url);
            if (data?.username) setMyUsername(data.username);
        };
        fetchProfile();
    }, [user]);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(big3SeenStorageKey);
            setSeenBig3Overtakes(raw ? JSON.parse(raw) : {});
        } catch (error) {
            console.error("failed to load big3 overtake seen map", error);
            setSeenBig3Overtakes({});
        }
    }, []);

    // 自分の直近データ
    const myRecentGrouped = buildRecentGrouped(history);

    const myRecentDates = Object.keys(myRecentGrouped).sort((a, b) => b.localeCompare(a));
    const activeRecently = myRecentDates.length > 0;
    const activeToday = myRecentDates.includes(today);
    const myTotalExCount = new Set(
        Object.values(myRecentGrouped).flatMap(d => Object.keys(d))
    ).size;

    const todayActiveFriends = friends.filter((f) => todayActiveMap[f.id]);
    const todayActiveLabel = todayActiveFriends.map((f) => getDisplayUsername(f.username)).join("、");
    const myMonthlyWorkoutDays = getValidWorkoutDatesFromHistory(history, {
        prefix: currentMonthPrefix,
    }).length;
    const monthlyWorkoutRanking = [
        { name: getDisplayUsername(myUsername, { isMe: true }), isMe: true, days: myMonthlyWorkoutDays },
        ...friends.map((friend) => ({
            name: getDisplayUsername(friend.username),
            isMe: false,
            days: countMonthlyWorkoutDays(friend.history),
        })),
    ].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "ja"));
    const myBig3 = mergeBig3Bests(
        computeBig3FromHistory(history),
        computeBig3FromManualBests(manualBests)
    );
    const big3Ranking = [
        {
            id: user?.id || "me",
            name: getDisplayUsername(myUsername, { isMe: true }),
            isMe: true,
            ...myBig3,
        },
        ...friends.map((friend) => ({
            id: friend.id,
            name: getDisplayUsername(friend.username),
            isMe: false,
            ...computeBig3FromHistory(friend.history),
        })),
    ].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));
    const myBig3ByExercise = {
        bench: myBig3.bench || 0,
        squat: myBig3.squat || 0,
        deadlift: myBig3.deadlift || 0,
    };
    const big3OvertakeEvents = friends.flatMap((friend) => {
        const friendBig3 = computeBig3FromHistory(friend.history);

        return BIG3_EXERCISES.flatMap((exercise) => {
            const myValue = myBig3ByExercise[exercise.key] || 0;
            const friendValue = friendBig3[exercise.key] || 0;
            if (!(friendValue > myValue && myValue > 0)) return [];

                return [{
                    type: "big3_overtake",
                    friendId: friend.id,
                    friendName: getDisplayUsername(friend.username),
                    exercise: exercise.key,
                    exerciseLabel: exercise.match,
                    friendValue,
                myValue,
                seenKey: `${friend.id}:${exercise.key}:${friendValue}:${myValue}`,
            }];
        });
    });
    const unseenBig3OvertakeEvents = big3OvertakeEvents
        .filter((event) => !seenBig3Overtakes[event.seenKey])
        .slice(0, 3);
    const sortedFriends = [...friends]
        .map((friend, index) => ({ friend, index }))
        .sort((a, b) => {
            const activeDiff = Number(Boolean(todayActiveMap[b.friend.id])) - Number(Boolean(todayActiveMap[a.friend.id]));
            if (activeDiff !== 0) return activeDiff;
            return a.index - b.index;
        })
        .map(({ friend }) => friend);

    useEffect(() => {
        if (!unseenBig3OvertakeEvents.length) return;
        setVisibleBig3OvertakeEvents(unseenBig3OvertakeEvents);
    }, [unseenBig3OvertakeEvents]);

    useEffect(() => {
        if (!visibleBig3OvertakeEvents.length) return;

        setSeenBig3Overtakes((prev) => {
            const next = { ...prev };
            let changed = false;

            visibleBig3OvertakeEvents.forEach((event) => {
                if (!next[event.seenKey]) {
                    next[event.seenKey] = true;
                    changed = true;
                }
            });

            if (!changed) return prev;

            try {
                window.localStorage.setItem(big3SeenStorageKey, JSON.stringify(next));
            } catch (error) {
                console.error("failed to persist big3 overtake seen map", error);
            }

            return next;
        });
    }, [big3SeenStorageKey, visibleBig3OvertakeEvents]);

    if (!user) {
        return (
            <div style={{ ...S.page, justifyContent: "center", minHeight: "55vh" }}>
                <div
                    style={{
                        ...S.sectionCard,
                        textAlign: "center",
                        padding: 24,
                    }}
                >
                <p style={{ marginBottom: 24, color: "var(--text2)", lineHeight: 1.6 }}>Friends機能を使うにはログインが必要です</p>
                <button onClick={onLogin} style={{ padding: "12px 32px", borderRadius: 14, background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "#fff", border: "1px solid transparent", fontWeight: 700, fontSize: 16, boxShadow: "var(--shadow-soft)" }}>
                    ログイン / 新規登録
                </button>
                </div>
            </div>
        );
    }


    const renderDateAccordion = (id, date, exMap) => {
        const dateKey = `${id}-${date}`;
        const isOpen = openDates[dateKey] === true;
        return (
            <div key={date} style={{ marginBottom: 6 }}>
                <button onClick={() => setOpenDates(p => ({ ...p, [dateKey]: !isOpen }))}
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "linear-gradient(135deg, var(--success-soft), var(--card))", borderRadius: 12, border: "1px solid var(--success-border)", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)" }}>{date === today ? "今日" : date}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>{isOpen ? "▲" : "▼"}</div>
                </button>
                {isOpen && Object.entries(exMap)
                    .sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999))
                    .map(([name, val]) => {
                        const sets = Array.isArray(val) ? val : (val.sets || []);
                        return (
                            <div key={name} style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 14, padding: "8px 12px", marginBottom: 6, border: "1px solid rgba(186, 230, 253, 0.6)" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{name}</div>
                                {sets.map((s, i) => (
                                    <div key={i} style={{ fontSize: 12, color: "var(--text2)", marginBottom: 2 }}>
                                        {i + 1} {s.weight === "BW" ? "自重" : `${s.weight}kg`} × {s.reps}rep
                                    </div>
                                ))}
                            </div>
                        );
                    })}
            </div>
        );
    };


    return (
        <div className="fade-in" style={{ ...S.page, paddingBottom: 24 }}>
            {user && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                    <button onClick={onLogout} style={{ ...S.pillBtn, padding: "8px 14px", fontSize: 12, color: "var(--text2)" }}>
                        ログアウト
                    </button>
                </div>
            )}

            {showFeedSections && (
                <>
            <div style={S.sLabel}>今日のアクティビティ</div>

            <div style={{ background: "var(--card)", borderRadius: 20, padding: "16px", marginBottom: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>みんなの今日のワークアウト</div>
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                            自分と友達の今日のセッションだけを表示します
                        </div>
                        {activityFeedStatusMessage && (
                            <div
                                style={{
                                    fontSize: 11,
                                    marginTop: 6,
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
                    <button
                        type="button"
                        onClick={handleRefreshActivityFeed}
                        disabled={activityFeedLoading}
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
                        {activityFeedLoading && activityFeedAction === "refresh" ? "更新中..." : "更新"}
                    </button>
                </div>

                {activityFeed.length === 0 && !activityFeedLoading ? (
                    <div style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 16, padding: "18px 16px", color: "var(--text3)", fontSize: 13, textAlign: "center", border: "1px solid rgba(217, 228, 239, 0.9)" }}>
                        今日はまだ共有されたワークアウトはありません
                    </div>
                ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                        {activityFeed.map((item) => {
                            const profileName = item.user_id === user.id
                                ? getDisplayUsername(myUsername, { isMe: true })
                                : getDisplayUsername(item.profile?.username);

                            return (
                                <div key={item.id} style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 18, padding: "14px", border: "1px solid rgba(217, 228, 239, 0.85)" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                                        <div style={{ width: 42, height: 42, borderRadius: 21, background: "linear-gradient(135deg, var(--accent), var(--accent2))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, overflow: "hidden", flexShrink: 0 }}>
                                            {item.profile?.avatar1_url
                                                ? <img src={item.profile.avatar1_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                : profileName?.[0]?.toUpperCase()
                                            }
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {profileName}
                                            </div>
                                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                                                {formatRelativeTime(item.created_at)} · {item.workout_date}
                                            </div>
                                        </div>
                                        {item.user_id === user.id && (
                                            <button
                                                type="button"
                                                onClick={() => handleOpenSessionShare(item)}
                                                disabled={Boolean(sharePreparingSessionId)}
                                                style={{
                                                    flexShrink: 0,
                                                    padding: "8px 10px",
                                                    borderRadius: 12,
                                                    border: "1px solid var(--border2)",
                                                    background: "var(--card)",
                                                    color: "var(--text2)",
                                                    fontSize: 11,
                                                    fontWeight: 800,
                                                    opacity: sharePreparingSessionId && sharePreparingSessionId !== item.id ? 0.7 : 1,
                                                }}
                                            >
                                                {sharePreparingSessionId === item.id ? "準備中..." : "シェア"}
                                            </button>
                                        )}
                                    </div>

                                    {item.photoUrl && (
                                        <img
                                            src={item.photoUrl}
                                            alt={`${item.workout_date} session`}
                                            style={{ width: "100%", borderRadius: 14, objectFit: "cover", aspectRatio: "16 / 9", display: "block", marginBottom: 10 }}
                                        />
                                    )}

                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                                        <span style={{ padding: "4px 10px", borderRadius: 999, background: "var(--info-soft)", border: "1px solid var(--info-border)", color: "var(--info-strong)", fontSize: 11, fontWeight: 700 }}>
                                            {item.exercise_count}種目
                                        </span>
                                        <span style={{ padding: "4px 10px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
                                            Volume {Math.round(Number(item.total_volume || 0)).toLocaleString("ja-JP")}kg
                                        </span>
                                    </div>

                                    {item.user_id === user.id && (
                                        <div
                                            style={{
                                                display: "grid",
                                                gap: 8,
                                                marginBottom: 10,
                                                padding: "10px 12px",
                                                borderRadius: 14,
                                                background: "rgba(248, 250, 252, 0.95)",
                                                border: "1px solid rgba(217, 228, 239, 0.95)",
                                            }}
                                        >
                                            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text2)" }}>
                                                公開設定
                                            </div>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                                <div style={{ fontSize: 11, color: "var(--text3)", minWidth: 64 }}>セッション</div>
                                                <button
                                                    type="button"
                                                    disabled={sessionSettingsUpdatingId === item.id || item.visibility === "friends"}
                                                    onClick={() => handleUpdateSessionVisibility(item.id, { visibility: "friends" })}
                                                    style={{
                                                        padding: "7px 10px",
                                                        borderRadius: 999,
                                                        border: "1px solid var(--border2)",
                                                        background: item.visibility === "friends" ? "var(--text)" : "var(--card)",
                                                        color: item.visibility === "friends" ? "var(--bg)" : "var(--text2)",
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        opacity: sessionSettingsUpdatingId === item.id ? 0.7 : 1,
                                                    }}
                                                >
                                                    フレンドに公開
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={sessionSettingsUpdatingId === item.id || item.visibility === "private"}
                                                    onClick={() => handleUpdateSessionVisibility(item.id, { visibility: "private" })}
                                                    style={{
                                                        padding: "7px 10px",
                                                        borderRadius: 999,
                                                        border: "1px solid var(--border2)",
                                                        background: item.visibility === "private" ? "var(--text)" : "var(--card)",
                                                        color: item.visibility === "private" ? "var(--bg)" : "var(--text2)",
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        opacity: sessionSettingsUpdatingId === item.id ? 0.7 : 1,
                                                    }}
                                                >
                                                    非公開
                                                </button>
                                            </div>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                                <div style={{ fontSize: 11, color: "var(--text3)", minWidth: 64 }}>写真</div>
                                                <button
                                                    type="button"
                                                    disabled={sessionSettingsUpdatingId === item.id || item.photo_visibility === "hidden"}
                                                    onClick={() => handleUpdateSessionVisibility(item.id, { photo_visibility: "hidden" })}
                                                    style={{
                                                        padding: "7px 10px",
                                                        borderRadius: 999,
                                                        border: "1px solid var(--border2)",
                                                        background: item.photo_visibility === "hidden" ? "var(--text)" : "var(--card)",
                                                        color: item.photo_visibility === "hidden" ? "var(--bg)" : "var(--text2)",
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        opacity: sessionSettingsUpdatingId === item.id ? 0.7 : 1,
                                                    }}
                                                >
                                                    非表示
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={sessionSettingsUpdatingId === item.id || item.photo_visibility === "friends"}
                                                    onClick={() => handleUpdateSessionVisibility(item.id, { photo_visibility: "friends" })}
                                                    style={{
                                                        padding: "7px 10px",
                                                        borderRadius: 999,
                                                        border: "1px solid var(--border2)",
                                                        background: item.photo_visibility === "friends" ? "var(--text)" : "var(--card)",
                                                        color: item.photo_visibility === "friends" ? "var(--bg)" : "var(--text2)",
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        opacity: sessionSettingsUpdatingId === item.id ? 0.7 : 1,
                                                    }}
                                                >
                                                    フレンドに公開
                                                </button>
                                                {sessionSettingsUpdatingId === item.id && (
                                                    <span style={{ fontSize: 11, color: "var(--text3)" }}>更新中...</span>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ display: "grid", gap: 6 }}>
                                        {(item.summaryItems || []).slice(0, 4).map((summaryItem) => (
                                            <div key={`${summaryItem.body_part || ""}-${summaryItem.exercise_name}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--text2)" }}>
                                                <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {summaryItem.exercise_name}
                                                    {summaryItem.body_part ? ` · ${summaryItem.body_part}` : ""}
                                                </div>
                                                <div style={{ flexShrink: 0 }}>
                                                    {summaryItem.set_count}セット / {Math.round(Number(summaryItem.max_weight || 0) * 10) / 10 || 0}kg
                                                </div>
                                            </div>
                                        ))}
                                        {item.summaryItems.length > 4 && (
                                            <div style={{ fontSize: 11, color: "var(--text3)" }}>
                                                他 {item.summaryItems.length - 4} 種目
                                            </div>
                                        )}
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 10,
                                            marginTop: 12,
                                            paddingTop: 10,
                                            borderTop: "1px solid rgba(217, 228, 239, 0.7)",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                            {item.user_id === user.id ? (
                                                <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 700 }}>
                                                    ♥ {Number(item.likeCount || 0)}
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleSessionLike(item.id)}
                                                    disabled={Boolean(likePendingMap[item.id])}
                                                    style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                        padding: "8px 10px",
                                                        borderRadius: 12,
                                                        border: "1px solid var(--border2)",
                                                        background: item.likedByMe ? "var(--danger-soft, #fee2e2)" : "var(--card)",
                                                        color: item.likedByMe ? "var(--danger, #dc2626)" : "var(--text2)",
                                                        fontSize: 12,
                                                        fontWeight: 800,
                                                        opacity: likePendingMap[item.id] ? 0.7 : 1,
                                                    }}
                                                >
                                                    <span>{item.likedByMe ? "♥" : "♡"}</span>
                                                    <span>{Number(item.likeCount || 0)}</span>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleOpenComments(item)}
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                    padding: "8px 10px",
                                                    borderRadius: 12,
                                                    border: "1px solid var(--border2)",
                                                    background: "var(--card)",
                                                    color: "var(--text2)",
                                                    fontSize: 12,
                                                    fontWeight: 800,
                                                }}
                                            >
                                                <span>💬</span>
                                                <span>{Number(item.commentCount || 0)}</span>
                                            </button>
                                        </div>
                                        {likePendingMap[item.id] && (
                                            <div style={{ fontSize: 11, color: "var(--text3)" }}>
                                                更新中...
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {activityFeedHasMore && (
                    <button
                        type="button"
                        onClick={handleLoadMoreActivityFeed}
                        disabled={activityFeedLoading}
                        style={{
                            width: "100%",
                            marginTop: 12,
                            padding: "12px 14px",
                            borderRadius: 14,
                            border: "1px solid var(--border2)",
                            background: "var(--card2)",
                            color: "var(--text2)",
                            fontSize: 13,
                            fontWeight: 700,
                        }}
                    >
                        {activityFeedLoading && activityFeedAction === "more" ? "読み込み中..." : "もっと見る"}
                    </button>
                )}
            </div>
                </>
            )}

            {showRankingSections && (
                <>
            <Big3RankingCard ranking={big3Ranking} />

            <div style={S.sLabel}>最近のアクティビティ（7日間）</div>

            {todayActiveFriends.length > 0 && (
                <div
                    style={{
                        background: "linear-gradient(135deg, var(--success-soft), var(--card))",
                        border: "1px solid var(--success-border)",
                        borderRadius: 16,
                        padding: "12px 14px",
                        marginBottom: 12,
                        fontSize: 13,
                        color: "var(--text)",
                        boxShadow: "var(--shadow-card)",
                    }}
                >
                    {todayActiveLabel}が今日トレーニングを記録しています！
                </div>
            )}

            <Big3OvertakeAlerts events={visibleBig3OvertakeEvents} />

            {receivedKudos.length > 0 && (
                <div style={{ background: "linear-gradient(135deg, var(--info-soft), var(--card))", border: "1px solid var(--info-border)", borderRadius: 16, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: "var(--text)", boxShadow: "var(--shadow-card)" }}>
                    🔥 {receivedKudos.map(k => getDisplayUsername(k.profiles?.username)).join("、")}から今日クドスをもらった！
                </div>
            )}

            <MonthlyWorkoutRankingCard ranking={monthlyWorkoutRanking} />


            {/* 自分のカード */}
            <div style={{ background: "var(--card)", borderRadius: 20, padding: "16px", marginBottom: 12, border: "1px solid var(--border2)", position: "relative", boxShadow: "var(--shadow-card)" }}>
                <button onClick={() => {
                    setUsernameError("");
                    setShowEditName(true);
                }} style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 4 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: activeRecently ? 14 : 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 22, background: "linear-gradient(135deg, var(--accent2), #7DD3FC)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "#fff", flexShrink: 0, overflow: "hidden", cursor: "pointer", position: "relative", boxShadow: "var(--shadow-soft)" }}
                        onClick={() => document.getElementById("avatar-input").click()}>
                        {avatarUrl
                            ? <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : "YOU"
                        }
                        <input id="avatar-input" type="file" accept="image/*" style={{ display: "none" }}
                            onChange={async (e) => {
                                const file = e.target.files[0];
                                if (!file) return;
                                const ext = file.name.split(".").pop();
                                const path = `${user.id}.${ext}`;
                                await supabase.storage.from("avatars1").upload(path, file, { upsert: true });
                                const { data: { publicUrl } } = supabase.storage.from("avatars1").getPublicUrl(path);
                                await supabase.from("profiles").update({ avatar1_url: publicUrl }).eq("id", user.id);
                                setAvatarUrl(publicUrl);
                            }}

                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{getDisplayUsername(myUsername, { isMe: true })}</div>
                            {activeToday && <div style={{ padding: "2px 8px", borderRadius: 10, background: "var(--success-soft)", border: "1px solid var(--success-border)", fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>完了 ✓</div>}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
                            {activeRecently ? `直近7日 ${myTotalExCount}種目` : "直近7日の記録なし"}
                        </div>
                    </div>
                </div>
                {myRecentDates.map(date => renderDateAccordion("me", date, myRecentGrouped[date]))}
            </div>

            {/* 友達カード */}
            {loading ? (
                <div style={{ textAlign: "center", padding: 32, color: "var(--text2)", fontSize: 14 }}>読み込み中...</div>
            ) : friends.length === 0 ? (
                <div style={{ textAlign: "center", padding: 32, color: "var(--text2)", fontSize: 14 }}>
                    まだ友達がいません。招待リンクを送ろう！
                </div>
            ) : (
                sortedFriends.map(f => {
                    const friendHistory = f.history || {};
                    const friendGrouped = buildRecentGrouped(friendHistory);
                    const friendDates = Object.keys(friendGrouped).sort((a, b) => b.localeCompare(a));
                    const friendExCount = new Set(Object.values(friendGrouped).flatMap(d => Object.keys(d))).size;

                    return (
                        <div key={f.id} style={{ background: "var(--card)", borderRadius: 20, padding: "16px", marginBottom: 12, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: friendDates.length ? 14 : 0 }}>
                                <div style={{ width: 44, height: 44, borderRadius: 22, background: "linear-gradient(135deg, var(--accent), #4ADE80)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#fff", flexShrink: 0, overflow: "hidden", boxShadow: "var(--shadow-soft)" }}>
                                    {f.avatar1_url
                                        ? <img src={f.avatar1_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        : getDisplayUsername(f.username)?.[0]?.toUpperCase()
                                    }
                                </div>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>@{getDisplayUsername(f.username)}</div>
                                        {todayActiveMap[f.id] && (
                                            <div
                                                style={{
                                                    padding: "2px 8px",
                                                    borderRadius: 10,
                                                    background: "var(--success-soft)",
                                                    border: "1px solid var(--success-border)",
                                                    fontSize: 10,
                                                    color: "var(--accent)",
                                                    fontWeight: 700,
                                                }}
                                            >
                                                🟢 今日記録あり
                                            </div>
                                        )}
                                        <button onClick={async () => {
                                            const today = formatDateKey();
                                            await supabase.from("kudos").upsert({
                                                from_user_id: user.id,
                                                to_user_id: f.id,
                                                date: today,
                                            });
                                            setKudos(p => ({ ...p, [f.id]: true }));
                                        }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", opacity: kudos[f.id] ? 0.4 : 1 }}>
                                            🔥
                                        </button>
                                    </div>

                                    <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>直近7日 {friendExCount}種目</div>
                                </div>
                            </div>
                            {friendDates.length === 0
                                ? <div style={{ fontSize: 12, color: "var(--text3)" }}>直近7日間の記録なし</div>
                                : friendDates.map(date => renderDateAccordion(f.id, date, friendGrouped[date]))
                            }
                        </div>
                    );
                })
            )}

            <InviteCard copied={copied} onCopyInvite={handleCopyInvite} />

            <NotificationSettings user={user} />
                </>
            )}

            {
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
            }

            <WorkoutSessionShareModal
                isOpen={Boolean(shareSessionTarget)}
                onClose={closeShareSessionModal}
                workoutDate={shareSessionTarget?.workout_date}
                sessionPayload={shareSessionTarget ? {
                    session: {
                        duration_sec: shareSessionTarget.duration_sec || 0,
                        summary_json: {
                            ...(shareSessionTarget.summary || {}),
                            totalVolume: Number(
                                shareSessionTarget.summary?.totalVolume
                                || shareSessionTarget.total_volume
                                || 0
                            ),
                            items: shareSessionTarget.summaryItems || [],
                        },
                    },
                    exercises: shareSessionTarget.summaryItems || [],
                } : null}
                photoRows={sharePhotoRows}
                photoUrls={sharePhotoUrls}
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
