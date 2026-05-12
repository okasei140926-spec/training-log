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
    mergeHistoryMaps,
    sanitizeWorkoutSets,
} from "../utils/helpers";
import {
    buildWorkoutSessionEntriesFromHistory,
    buildWorkoutSessionPayloadFromEntries,
} from "../utils/workoutSessions";
import {
    getSetCountByBodyPart,
} from "../utils/setCountByBodyPart";
import EditUsernameModal from "./friends/EditUsernameModal";
import InviteCard from "./friends/InviteCard";
import NotificationSettings from "./NotificationSettings";
import WorkoutCommentsModal from "./modals/WorkoutCommentsModal";

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
const RANKING_TABS = [
    { key: "big3", label: "BIG3" },
    { key: "consistency", label: "継続" },
    { key: "monthly", label: "今月" },
];

const parseDateKey = (value) => {
    if (!value) return new Date();
    return new Date(`${String(value).slice(0, 10)}T00:00:00`);
};

const shiftDateKey = (dateKey, days) => {
    const date = parseDateKey(dateKey);
    date.setDate(date.getDate() + days);
    return formatDateKey(date);
};

const formatRelativeWorkoutDate = (workoutDate, todayKey) => {
    const normalizedDate = String(workoutDate || "").slice(0, 10);
    if (!normalizedDate) return "";

    const target = parseDateKey(normalizedDate).getTime();
    const today = parseDateKey(todayKey).getTime();
    if (!Number.isFinite(target) || !Number.isFinite(today)) return normalizedDate;

    const diffDays = Math.round((today - target) / 86400000);
    if (diffDays <= 0) return "今日";
    if (diffDays < 7) return `${diffDays}日前`;

    const [, month = "", day = ""] = normalizedDate.split("-");
    return `${month}/${day}`;
};

export default function FriendsScreen({ history, manualBests = [], sessionSyncVersion = 0, user, onLogin, onLogout, onOpenRecord, mode = "all" }) {
    const [copied, setCopied] = useState(false);
    const [friends, setFriends] = useState([]);
    const [friendIds, setFriendIds] = useState([]);
    const [, setTodayActiveMap] = useState({});
    const [showEditName, setShowEditName] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [usernameError, setUsernameError] = useState("");
    const [avatarUrl, setAvatarUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [myUsername, setMyUsername] = useState("");
    const [activityFeed, setActivityFeed] = useState([]);
    const [activityFeedLoading, setActivityFeedLoading] = useState(false);
    const [activityFeedAction, setActivityFeedAction] = useState(null);
    const [activityFeedStatusMessage, setActivityFeedStatusMessage] = useState("");
    const [likePendingMap, setLikePendingMap] = useState({});
    const [commentsSessionTarget, setCommentsSessionTarget] = useState(null);
    const [rankingTab, setRankingTab] = useState("big3");
    const [expandedFeedItems, setExpandedFeedItems] = useState({});
    const activityFeedStatusTimeoutRef = useRef(null);
    const today = formatDateKey();
    const currentMonthPrefix = today.slice(0, 7);
    const recentSevenStart = shiftDateKey(today, -6);
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

    const formatSessionSetDisplay = useCallback((set) => {
        if (!set) return "";
        const reps = Number(set.reps || 0);
        const repLabel = `${reps}rep`;
        if (String(set.weight || "").toUpperCase() === "BW") {
            return `自重 × ${repLabel}`;
        }
        const weight = Math.round(Number(set.weight || 0) * 10) / 10;
        return `${weight}kg × ${repLabel}`;
    }, []);

    const buildFeedItemFromHistoryDate = useCallback(({
        feedUserId,
        workoutDate,
        workoutRow,
        sourceHistory = {},
        profile = {},
        sessionMeta = null,
    }) => {
        if (!feedUserId || !workoutDate) return null;

        const entries = buildWorkoutSessionEntriesFromHistory(sourceHistory, workoutDate);
        const payload = entries.length
            ? buildWorkoutSessionPayloadFromEntries(entries, workoutDate)
            : null;

        const detailedItems = entries.length
            ? entries.map((entry) => ({
                exercise_name: entry.exerciseName,
                body_part: String(entry.bodyPart || "").trim(),
                set_count: entry.sets.length,
                order: Number.isFinite(entry.order) ? entry.order : 999,
                sets: entry.sets,
            }))
            : [];

        const timestampBase = workoutRow?.ended_at || workoutRow?.started_at || `${workoutDate}T12:00:00+09:00`;
        const payloadSummary = payload?.session?.summary_json || {};
        const sessionSummary = sessionMeta?.summary_json || {};
        const summary = {
            ...payloadSummary,
            ...sessionSummary,
            prCount: Number(sessionSummary?.prCount || payloadSummary?.prCount || 0),
        };
        const summaryItems = Array.isArray(summary.items) ? summary.items : [];

        if (!payload?.session && !summaryItems.length) return null;

        return {
            id: sessionMeta?.id || `feed-${feedUserId}-${workoutDate}`,
            sessionId: sessionMeta?.id || null,
            user_id: feedUserId,
            workout_date: workoutDate,
            started_at: workoutRow?.started_at || null,
            ended_at: workoutRow?.ended_at || null,
            created_at: sessionMeta?.created_at || timestampBase,
            updated_at: sessionMeta?.updated_at || workoutRow?.ended_at || workoutRow?.started_at || timestampBase,
            duration_sec: Number(sessionMeta?.duration_sec || workoutRow?.duration_sec || 0),
            total_volume: Number(sessionMeta?.total_volume || payload?.session?.total_volume || 0),
            exercise_count: Number(sessionMeta?.exercise_count || payload?.session?.exercise_count || 0),
            summary_json: summary,
            summary,
            summaryItems,
            detailedItems: detailedItems.length ? detailedItems : summaryItems.map((exercise) => ({
                exercise_name: exercise.exercise_name,
                body_part: exercise.body_part,
                set_count: Number(exercise.set_count || 0),
                order: Number(exercise.order || 999),
                sets: Array.isArray(exercise.sets) ? exercise.sets : [],
            })),
            likeCount: Number(sessionMeta?.likeCount || 0),
            likedByMe: Boolean(sessionMeta?.likedByMe),
            commentCount: Number(sessionMeta?.commentCount || 0),
            profile,
            photoUrl: sessionMeta?.photoUrl || null,
        };
    }, []);

    const fetchActivityFeed = useCallback(async ({ reset = false } = {}) => {
        if (!user?.id) {
            setActivityFeed([]);
            return false;
        }

        const feedUserIds = [...new Set([user.id, ...friendIds])];

        setActivityFeedLoading(true);

        try {
            let sessionsQuery = supabase
                .from("workout_sessions")
                .select("id, user_id, workout_date, created_at, updated_at, duration_sec, total_volume, exercise_count, summary_json, photo_id, photo_visibility, visibility")
                .in("user_id", feedUserIds)
                .order("workout_date", { ascending: false })
                .order("updated_at", { ascending: false });

            sessionsQuery = sessionsQuery
                .gte("workout_date", recentSevenStart)
                .lte("workout_date", today);

            const { data: sessions, error: sessionsError } = await sessionsQuery;

            if (sessionsError) throw sessionsError;
            const rawSessions = sessions || [];

            const profileIds = [...new Set(feedUserIds.filter(Boolean))];
            const photoIds = [...new Set(
                rawSessions
                    .filter((session) => session.photo_visibility === "friends" && session.photo_id)
                    .map((session) => session.photo_id)
            )];
            const sessionIds = [...new Set(rawSessions.map((session) => session.id).filter(Boolean))];

            const [profilesRes, photosRes, likesRes, commentsRes, workoutsRes] = await Promise.all([
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
                feedUserIds.length
                    ? supabase
                        .from("workouts")
                        .select("user_id, date, data, started_at, ended_at, duration_sec")
                        .in("user_id", feedUserIds)
                        .gte("date", recentSevenStart)
                        .lte("date", today)
                    : Promise.resolve({ data: [], error: null }),
            ]);

            if (profilesRes.error) throw profilesRes.error;
            if (photosRes.error) throw photosRes.error;
            if (likesRes.error) throw likesRes.error;
            if (commentsRes.error) throw commentsRes.error;
            if (workoutsRes.error) throw workoutsRes.error;

            const profileMap = new Map((profilesRes.data || []).map((profile) => [profile.id, profile]));
            const photoRows = photosRes.data || [];
            const likeRows = likesRes.data || [];
            const commentRows = commentsRes.data || [];
            const workoutRowMap = new Map(
                (workoutsRes.data || []).map((row) => [`${row.user_id}::${row.date}`, row])
            );
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

            const excludedItems = [];
            const workoutRowsByUser = new Map();
            (workoutsRes.data || []).forEach((row) => {
                const current = workoutRowsByUser.get(row.user_id) || [];
                current.push(row);
                workoutRowsByUser.set(row.user_id, current);
            });

            const sessionMetaMap = new Map();
            rawSessions.forEach((session) => {
                const isOwnWorkout = session.user_id === user.id;
                const isFriendWorkout = !isOwnWorkout && friendIds.includes(session.user_id);

                if (!session.workout_date) {
                    excludedItems.push({
                        workoutId: session.id,
                        workoutDate: session.workout_date,
                        created_at: session.created_at,
                        shared_at: session.updated_at,
                        visibility: session.visibility,
                        isShared: true,
                        isOwnWorkout,
                        isFriendWorkout,
                        includedInFeed: false,
                        excludedReason: "invalid_date",
                    });
                    return;
                }

                if (!isOwnWorkout && !isFriendWorkout) {
                    excludedItems.push({
                        workoutId: session.id,
                        workoutDate: session.workout_date,
                        created_at: session.created_at,
                        shared_at: session.updated_at,
                        visibility: session.visibility,
                        isShared: true,
                        isOwnWorkout,
                        isFriendWorkout,
                        includedInFeed: false,
                        excludedReason: "not_friend",
                    });
                    return;
                }
                const sessionKey = `${session.user_id}::${session.workout_date}`;
                const nextMeta = {
                    ...session,
                    photoUrl: session.photo_id ? photoUrlMap.get(session.photo_id) || null : null,
                    likeCount: likeCountMap.get(session.id) || 0,
                    likedByMe: likedSessionIds.has(session.id),
                    commentCount: commentCountMap.get(session.id) || 0,
                };
                const existingMeta = sessionMetaMap.get(sessionKey);
                const existingTime = new Date(existingMeta?.updated_at || existingMeta?.created_at || 0).getTime();
                const nextTime = new Date(nextMeta.updated_at || nextMeta.created_at || 0).getTime();
                if (!existingMeta || nextTime >= existingTime) {
                    sessionMetaMap.set(sessionKey, nextMeta);
                }
            });

            const buildItemsForUser = (targetUserId, sourceHistory = {}) => {
                const historyDates = getValidWorkoutDatesFromHistory(sourceHistory, { since: recentSevenStart })
                    .filter((dateKey) => dateKey <= today);
                const sessionDates = Array.from(sessionMetaMap.keys())
                    .map((key) => {
                        const [userId, date] = String(key).split("::");
                        return userId === targetUserId ? date : null;
                    })
                    .filter((dateKey) => dateKey && dateKey >= recentSevenStart && dateKey <= today);
                const validDates = [...new Set([...historyDates, ...sessionDates])];

                return validDates.map((workoutDate) => {
                    const workoutKey = `${targetUserId}::${workoutDate}`;
                    const item = buildFeedItemFromHistoryDate({
                        feedUserId: targetUserId,
                        workoutDate,
                        workoutRow: workoutRowMap.get(workoutKey),
                        sourceHistory,
                        profile: profileMap.get(targetUserId) || {},
                        sessionMeta: sessionMetaMap.get(workoutKey) || null,
                    });

                    if (!item) {
                        excludedItems.push({
                            workoutId: workoutKey,
                            workoutDate,
                            created_at: null,
                            shared_at: null,
                            visibility: null,
                            isShared: false,
                            isOwnWorkout: targetUserId === user.id,
                            isFriendWorkout: targetUserId !== user.id,
                            includedInFeed: false,
                            excludedReason: "no_valid_sets",
                        });
                    }

                    return item;
                }).filter(Boolean);
            };

            const ownWorkoutRows = workoutRowsByUser.get(user.id) || [];
            const mergedOwnHistory = mergeHistoryMaps(
                buildHistoryFromWorkoutRows(ownWorkoutRows),
                history || {}
            );
            const ownItems = buildItemsForUser(user.id, mergedOwnHistory);
            const friendItems = friendIds.flatMap((friendId) =>
                buildItemsForUser(friendId, buildHistoryFromWorkoutRows(workoutRowsByUser.get(friendId) || []))
            );

            const allItems = [...ownItems, ...friendItems]
                .sort((a, b) => {
                    const dateCompare = String(b.workout_date || "").localeCompare(String(a.workout_date || ""));
                    if (dateCompare !== 0) return dateCompare;
                    const timeA = new Date(a.started_at || a.created_at || a.updated_at || 0).getTime();
                    const timeB = new Date(b.started_at || b.created_at || b.updated_at || 0).getTime();
                    return timeA - timeB;
                });

            console.log("[feed] normalized feed items", {
                currentUserId: user.id,
                friendIds,
                ownWorkoutsLast7DaysCount: ownItems.length,
                friendWorkoutsLast7DaysCount: friendItems.length,
                feedItemsLength: allItems.length,
                headerActivityCount: allItems.length,
                displayedCardsCount: allItems.length,
                todayLocalDate: today,
                last7StartDate: recentSevenStart,
                excludedReason: excludedItems,
            });

            setActivityFeed(allItems);
            return true;
        } catch (error) {
            console.error("activity feed fetch failed", error);
            if (reset) {
                setActivityFeed([]);
            }
            return false;
        } finally {
            setActivityFeedLoading(false);
        }
    }, [buildFeedItemFromHistoryDate, friendIds, history, recentSevenStart, today, user?.id]);

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

    const handleOpenComments = useCallback((sessionItem) => {
        setCommentsSessionTarget(sessionItem);
    }, []);

    const closeCommentsModal = useCallback(() => {
        setCommentsSessionTarget(null);
    }, []);

    const handleCommentCountChange = useCallback((sessionId, nextCount) => {
        setActivityFeed((prev) => prev.map((item) => (
            item.sessionId === sessionId
                ? { ...item, commentCount: Number(nextCount || 0) }
                : item
        )));
        setCommentsSessionTarget((prev) => (
            prev?.id === sessionId
                ? { ...prev, commentCount: Number(nextCount || 0) }
                : prev
        ));
    }, []);

    const handleToggleSessionLike = useCallback(async (sessionId) => {
        if (!user?.id || !sessionId || likePendingMap[sessionId]) return;

        const currentItem = activityFeed.find((item) => item.sessionId === sessionId);
        if (!currentItem || currentItem.user_id === user.id) return;

        const previousLiked = Boolean(currentItem.likedByMe);
        const previousCount = Number(currentItem.likeCount || 0);
        const optimisticLiked = !previousLiked;
        const optimisticCount = Math.max(0, previousCount + (optimisticLiked ? 1 : -1));

        setLikePendingMap((prev) => ({ ...prev, [sessionId]: true }));
        setActivityFeed((prev) => prev.map((item) => (
            item.sessionId === sessionId
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
                item.sessionId === sessionId
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
                item.sessionId === sessionId
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
        const fetchProfile = async () => {
            const { data } = await supabase
                .from("profiles")
                .select("avatar1_url, username")
                .eq("id", user.id)
                .single();
            setAvatarUrl(data?.avatar1_url || null);
            setMyUsername(data?.username || "");
        };
        fetchProfile();
    }, [user]);

    const myBig3 = mergeBig3Bests(
        computeBig3FromHistory(history),
        computeBig3FromManualBests(manualBests)
    );
    const big3Ranking = [
        {
            id: user?.id || "me",
            name: getDisplayUsername(myUsername, { isMe: true }),
            isMe: true,
            bench: myBig3.bench || 0,
            squat: myBig3.squat || 0,
            deadlift: myBig3.deadlift || 0,
            value: myBig3.total || 0,
        },
        ...friends.map((friend) => {
            const bests = computeBig3FromHistory(friend.history);
            return {
                id: friend.id,
                name: getDisplayUsername(friend.username),
                isMe: false,
                bench: bests.bench || 0,
                squat: bests.squat || 0,
                deadlift: bests.deadlift || 0,
                value: bests.total || 0,
            };
        }),
    ].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ja"));

    const recentSevenRanking = [
        {
            id: user?.id || "me",
            name: getDisplayUsername(myUsername, { isMe: true }),
            isMe: true,
            value: getValidWorkoutDatesFromHistory(history, { since: recentSevenStart }).length,
        },
        ...friends.map((friend) => ({
            id: friend.id,
            name: getDisplayUsername(friend.username),
            isMe: false,
            value: getValidWorkoutDatesFromHistory(friend.history, { since: recentSevenStart }).length,
        })),
    ].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ja"));

    const monthlyWorkoutRanking = [
        {
            id: user?.id || "me",
            name: getDisplayUsername(myUsername, { isMe: true }),
            isMe: true,
            value: getValidWorkoutDatesFromHistory(history, { prefix: currentMonthPrefix }).length,
        },
        ...friends.map((friend) => ({
            id: friend.id,
            name: getDisplayUsername(friend.username),
            isMe: false,
            value: countMonthlyWorkoutDays(friend.history),
        })),
    ].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ja"));

    const rankingConfig = {
        big3: {
            label: "BIG3",
            emptyValue: "0kg",
            unit: "kg",
            description: "BIG3合計ランキング",
            data: big3Ranking,
            detailLabel: (entry) => `ベンチ ${entry.bench} / スクワット ${entry.squat} / デッド ${entry.deadlift}`,
            metricLabel: (entry) => `${entry.value}kg`,
            mySummary: (rankIndex, myEntry, aboveEntry) => {
                if (!myEntry) return null;
                if (rankIndex === 0) {
                    return {
                        headline: "あなたは 1位",
                        metric: `BIG3 ${myEntry.value}kg`,
                        note: "今のところトップです",
                    };
                }
                return {
                    headline: `あなたは ${rankIndex + 1}位`,
                    metric: `BIG3 ${myEntry.value}kg`,
                    note: `${rankIndex}位まであと${Math.max(0, aboveEntry.value - myEntry.value)}kg`,
                };
            },
        },
        consistency: {
            label: "継続",
            emptyValue: "0日",
            unit: "日",
            description: "直近7日ランキング",
            data: recentSevenRanking,
            detailLabel: () => "直近7日のトレーニング日数",
            metricLabel: (entry) => `${entry.value}日`,
            mySummary: (rankIndex, myEntry, aboveEntry) => {
                if (!myEntry) return null;
                if (rankIndex === 0) {
                    return {
                        headline: "あなたは 1位",
                        metric: `7日中${myEntry.value}日`,
                        note: myEntry.value > 0 ? "この調子で継続中" : "まずは1回記録してみましょう",
                    };
                }
                return {
                    headline: `あなたは ${rankIndex + 1}位`,
                    metric: `7日中${myEntry.value}日`,
                    note: `${rankIndex}位まであと${Math.max(0, aboveEntry.value - myEntry.value)}日`,
                };
            },
        },
        monthly: {
            label: "今月",
            emptyValue: "0回",
            unit: "回",
            description: "今月のワークアウト回数ランキング",
            data: monthlyWorkoutRanking,
            detailLabel: () => "今月のワークアウト回数",
            metricLabel: (entry) => `${entry.value}回`,
            mySummary: (rankIndex, myEntry, aboveEntry) => {
                if (!myEntry) return null;
                if (rankIndex === 0) {
                    return {
                        headline: "あなたは 1位",
                        metric: `${myEntry.value}回`,
                        note: myEntry.value > 0 ? "今月トップです" : "まだ今月の記録はありません",
                    };
                }
                return {
                    headline: `あなたは ${rankIndex + 1}位`,
                    metric: `${myEntry.value}回`,
                    note: `${rankIndex}位まであと${Math.max(0, aboveEntry.value - myEntry.value)}回`,
                };
            },
        },
    };

    const activeRanking = rankingConfig[rankingTab];
    const myRankingIndex = activeRanking?.data.findIndex((entry) => entry.isMe) ?? -1;
    const myRankingEntry = myRankingIndex >= 0 ? activeRanking.data[myRankingIndex] : null;
    const aboveRankingEntry = myRankingIndex > 0 ? activeRanking.data[myRankingIndex - 1] : null;
    const myRankingSummary = activeRanking?.mySummary?.(myRankingIndex, myRankingEntry, aboveRankingEntry) || null;

    const getSessionSetCount = useCallback((item) => {
        const summary = item.summary || {};
        if (Number.isFinite(Number(summary.setCount))) return Number(summary.setCount);
        return (item.summaryItems || []).reduce((sum, exercise) => sum + Number(exercise.set_count || 0), 0);
    }, []);

    const getSessionBodyParts = useCallback((item) => {
        return [...new Set(
            (item.summaryItems || [])
                .map((summaryItem) => String(summaryItem.body_part || "").trim())
                .filter(Boolean)
        )];
    }, []);

    const getSessionSetCountByBodyPart = useCallback((item) => {
        const summaryCounts = Array.isArray(item?.summary?.setCountByBodyPart)
            ? item.summary.setCountByBodyPart
            : Array.isArray(item?.summary_json?.setCountByBodyPart)
                ? item.summary_json.setCountByBodyPart
                : null;

        if (summaryCounts?.length) {
            return getSetCountByBodyPart(summaryCounts, { sort: "fixed" });
        }

        const sourceItems = item?.detailedItems?.length
            ? item.detailedItems.map((exercise) => ({
                bodyPart: String(exercise.body_part || "").trim() || "その他",
                exerciseName: exercise.exercise_name,
                sets: exercise.sets || [],
                setCount: Number(exercise.set_count || 0),
            }))
            : (item?.summaryItems || []).map((exercise) => ({
                bodyPart: String(exercise.body_part || "").trim() || "その他",
                exerciseName: exercise.exercise_name,
                sets: exercise.sets || [],
                setCount: Number(exercise.set_count || 0),
            }));

        return getSetCountByBodyPart(sourceItems, { sort: "fixed" });
    }, []);

    const getSessionPrCount = useCallback((item) => {
        const summary = item.summary || {};
        return Math.max(0, Number(summary.prCount || 0));
    }, []);

    const activityCount = activityFeed.length;
    const activeFriendCount = new Set(
        activityFeed
            .filter((item) => item.user_id !== user?.id)
            .map((item) => item.user_id)
            .filter(Boolean)
    ).size;
    const activityHeadline = `直近7日で ${activityCount}件 のワークアウト`;
    const feedEmptyState = {
        title: "まだアクティビティはありません",
        body: "ワークアウトを記録すると、ここに表示されます。友達を招待すると、お互いの記録も見られます。",
        action: "ワークアウトを記録",
        onClick: onOpenRecord,
    };

    const profileInitial = getDisplayUsername(myUsername, { isMe: true })?.[0]?.toUpperCase() || "Y";

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
    return (
        <div className="fade-in" style={{ ...S.page, paddingBottom: 120 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                <button onClick={onLogout} style={{ ...S.pillBtn, padding: "8px 14px", fontSize: 12, color: "var(--text2)" }}>
                    ログアウト
                </button>
            </div>

            {showFeedSections && (
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
                            </div>
                            <button
                                type="button"
                                onClick={handleRefreshActivityFeed}
                                disabled={activityFeedLoading}
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
                                {activityFeedLoading && activityFeedAction === "refresh" ? "更新中..." : "更新"}
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

                    {activityFeed.length === 0 && !activityFeedLoading ? (
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
                        <div style={{ display: "grid", gap: 14, marginBottom: 14 }}>
                            {activityFeed.map((item) => {
                                const profileName = item.user_id === user.id
                                    ? getDisplayUsername(myUsername, { isMe: true })
                                    : getDisplayUsername(item.profile?.username);
                                const bodyParts = getSessionBodyParts(item);
                                const setCount = getSessionSetCount(item);
                                const prCount = getSessionPrCount(item);
                                const setCountByBodyPart = getSessionSetCountByBodyPart(item);
                                const isExpanded = Boolean(expandedFeedItems[item.id]);
                                const detailedExercises = item.detailedItems?.length ? item.detailedItems : (item.summaryItems || []);
                                const hasExtraExercises = detailedExercises.length > 3;
                                const visibleExercises = isExpanded ? detailedExercises : detailedExercises.slice(0, 3);
                                const isOwnWorkout = item.user_id === user.id;
                                const canInteract = Boolean(item.sessionId);

                                return (
                                    <div
                                        key={item.id}
                                        id={`feed-session-${item.id}`}
                                        style={{
                                            background: "var(--card)",
                                            borderRadius: 22,
                                            padding: 16,
                                            border: "1px solid var(--border2)",
                                            boxShadow: "var(--shadow-card)",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                                            <div style={{ width: 46, height: 46, borderRadius: 23, background: "linear-gradient(135deg, var(--accent), var(--accent2))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, overflow: "hidden", flexShrink: 0 }}>
                                                {item.profile?.avatar1_url
                                                    ? <img src={item.profile.avatar1_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                    : profileName?.[0]?.toUpperCase()
                                                }
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 15, fontWeight: 900, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {profileName}
                                                </div>
                                                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                                                    {formatRelativeWorkoutDate(item.workout_date, today)}
                                                </div>
                                {bodyParts.length > 0 && (
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                                                        {bodyParts.map((bodyPart) => (
                                                            <span
                                                                key={`${item.id}-${bodyPart}`}
                                                                style={{
                                                                    padding: "4px 9px",
                                                                    borderRadius: 999,
                                                                    background: "rgba(18, 199, 194, 0.06)",
                                                                    border: "1px solid rgba(18, 199, 194, 0.14)",
                                                                    color: "var(--text2)",
                                                                    fontSize: 11,
                                                                    fontWeight: 700,
                                                                }}
                                                            >
                                                                {bodyPart}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {item.photoUrl && (
                                            <img
                                                src={item.photoUrl}
                                                alt={`${item.workout_date} session`}
                                                style={{ width: "100%", borderRadius: 16, objectFit: "cover", aspectRatio: "16 / 9", display: "block", marginBottom: 14 }}
                                            />
                                        )}

                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 14 }}>
                                            {[
                                                { label: "Volume", value: `${Math.round(Number(item.total_volume || 0)).toLocaleString("ja-JP")}kg` },
                                                { label: "セット数", value: `${setCount}` },
                                                {
                                                    label: "部位別セット",
                                                    valueNode: setCountByBodyPart.length > 0 ? (
                                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                                            {setCountByBodyPart.map((countItem) => (
                                                                <span
                                                                    key={`${item.id}-set-count-${countItem.bodyPart}`}
                                                                    style={{
                                                                        display: "inline-flex",
                                                                        alignItems: "center",
                                                                        justifyContent: "center",
                                                                        padding: "4px 7px",
                                                                        borderRadius: 999,
                                                                        background: "rgba(18, 199, 194, 0.08)",
                                                                        border: "1px solid rgba(18, 199, 194, 0.12)",
                                                                        color: "var(--accent-strong, var(--accent))",
                                                                        fontSize: 10,
                                                                        fontWeight: 800,
                                                                        lineHeight: 1.2,
                                                                    }}
                                                                >
                                                                    {countItem.bodyPart} {countItem.count}セット
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>
                                                            まだありません
                                                        </div>
                                                    ),
                                                },
                                                { label: "PR", value: `${prCount}件` },
                                            ].map((stat) => (
                                                <div
                                                    key={`${item.id}-${stat.label}`}
                                                    style={{
                                                        padding: "11px 12px",
                                                        borderRadius: 16,
                                                        background: "linear-gradient(180deg, rgba(18, 199, 194, 0.05), rgba(18, 199, 194, 0.015))",
                                                        border: "1px solid rgba(18, 199, 194, 0.12)",
                                                    }}
                                                >
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", letterSpacing: 0.4 }}>{stat.label}</div>
                                                    {stat.valueNode ? (
                                                        <div style={{ marginTop: 8 }}>
                                                            {stat.valueNode}
                                                        </div>
                                                    ) : (
                                                        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", marginTop: 4 }}>{stat.value}</div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        <div style={{ display: "grid", gap: 8 }}>
                                            {visibleExercises.map((summaryItem) => (
                                                <div
                                                    key={`${summaryItem.body_part || ""}-${summaryItem.exercise_name}`}
                                                    style={{
                                                        padding: "11px 12px",
                                                        borderRadius: 16,
                                                        background: "var(--card2)",
                                                        border: "1px solid rgba(217, 228, 239, 0.9)",
                                                    }}
                                                >
                                                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                                                        {summaryItem.exercise_name}
                                                    </div>
                                                    <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                                                        {Array.isArray(summaryItem.sets) && summaryItem.sets.length
                                                            ? summaryItem.sets.map(formatSessionSetDisplay).join(" / ")
                                                            : `${Math.round(Number(summaryItem.max_weight || 0) * 10) / 10 || 0}kg × ${summaryItem.set_count}セット`}
                                                    </div>
                                                </div>
                                            ))}
                                            {hasExtraExercises && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setExpandedFeedItems((prev) => ({
                                                            ...prev,
                                                            [item.id]: !prev[item.id],
                                                        }));
                                                    }}
                                                    style={{
                                                        justifySelf: "start",
                                                        padding: 0,
                                                        border: "none",
                                                        background: "transparent",
                                                        fontSize: 11,
                                                        color: "var(--accent)",
                                                        fontWeight: 800,
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    {isExpanded ? "表示を減らす" : `さらに${detailedExercises.length - 3}種目を見る`}
                                                </button>
                                            )}
                                        </div>

                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                gap: 10,
                                                marginTop: 14,
                                                paddingTop: 12,
                                                borderTop: "1px solid rgba(217, 228, 239, 0.75)",
                                            }}
                                        >
                                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                {isOwnWorkout && canInteract ? (
                                                    <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 800 }}>
                                                        ♥ {Number(item.likeCount || 0)}
                                                    </div>
                                                ) : !isOwnWorkout && canInteract ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleSessionLike(item.sessionId)}
                                                        disabled={Boolean(likePendingMap[item.sessionId])}
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 6,
                                                            padding: "9px 12px",
                                                            borderRadius: 14,
                                                            border: "1px solid var(--border2)",
                                                            background: item.likedByMe ? "var(--danger-soft, #fee2e2)" : "var(--card2)",
                                                            color: item.likedByMe ? "var(--danger, #dc2626)" : "var(--text2)",
                                                            fontSize: 12,
                                                            fontWeight: 800,
                                                            opacity: likePendingMap[item.sessionId] ? 0.7 : 1,
                                                        }}
                                                    >
                                                        <span>{item.likedByMe ? "♥" : "♡"}</span>
                                                            <span>{Number(item.likeCount || 0)}</span>
                                                        </button>
                                                ) : null}
                                                {canInteract && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenComments({ ...item, id: item.sessionId })}
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
                                                        <span>{Number(item.commentCount || 0)}</span>
                                                    </button>
                                                )}
                                            </div>
                                            {canInteract && likePendingMap[item.sessionId] && (
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
                                        }}
                                        onClick={() => document.getElementById("friends-avatar-input")?.click()}
                                    >
                                        {avatarUrl
                                            ? <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                            : profileInitial
                                        }
                                        <input
                                            id="friends-avatar-input"
                                            type="file"
                                            accept="image/*"
                                            style={{ display: "none" }}
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
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
                        <NotificationSettings user={user} />
                    </div>
                </>
            )}

            {showRankingSections && (
                <>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, marginBottom: 14 }}>
                        {RANKING_TABS.map((tab) => {
                            const selected = rankingTab === tab.key;
                            return (
                                <button
                                    key={tab.key}
                                    type="button"
                                    onClick={() => setRankingTab(tab.key)}
                                    style={{
                                        padding: "11px 18px",
                                        borderRadius: 999,
                                        border: selected ? "1px solid transparent" : "1px solid var(--border2)",
                                        background: selected ? "linear-gradient(135deg, #0F5E63, #12C7C2)" : "var(--card2)",
                                        color: selected ? "#fff" : "var(--text2)",
                                        fontSize: 13,
                                        fontWeight: 800,
                                        flexShrink: 0,
                                        boxShadow: selected ? "0 12px 26px rgba(18, 199, 194, 0.18)" : "none",
                                    }}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {myRankingSummary && (
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
                            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text3)", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 }}>
                                あなたの順位
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", marginBottom: 6 }}>
                                {myRankingSummary.headline}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 900, color: "var(--accent)", marginBottom: 6 }}>
                                {myRankingSummary.metric}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text2)" }}>
                                {myRankingSummary.note}
                            </div>
                        </div>
                    )}

                    <div
                        style={{
                            background: "var(--card)",
                            borderRadius: 22,
                            padding: 16,
                            border: "1px solid var(--border2)",
                            boxShadow: "var(--shadow-card)",
                        }}
                    >
                        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)", marginBottom: 4 }}>
                            {activeRanking.description}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
                            自分の位置と友達との差をチェック
                        </div>

                        {loading ? (
                            <div style={{ textAlign: "center", padding: 26, color: "var(--text2)", fontSize: 14 }}>読み込み中...</div>
                        ) : (
                            <div style={{ display: "grid", gap: 10 }}>
                                {activeRanking.data.map((entry, index) => (
                                    <div
                                        key={`${rankingTab}-${entry.id}`}
                                        style={{
                                            padding: index === 0 ? "14px 14px 13px" : "12px 14px",
                                            borderRadius: 18,
                                            background: entry.isMe
                                                ? "linear-gradient(180deg, rgba(18, 199, 194, 0.07), rgba(18, 199, 194, 0.02))"
                                                : "linear-gradient(180deg, var(--card2), var(--card))",
                                            border: index === 0
                                                ? "1px solid rgba(18, 199, 194, 0.22)"
                                                : entry.isMe
                                                    ? "1px solid rgba(18, 199, 194, 0.2)"
                                                    : "1px solid rgba(217, 228, 239, 0.9)",
                                            boxShadow: index === 0 ? "0 12px 26px rgba(18, 199, 194, 0.14)" : "none",
                                            opacity: entry.value > 0 ? 1 : 0.78,
                                        }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 6 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                                <div style={{ minWidth: 32, fontSize: 12, fontWeight: 900, color: index === 0 ? "#C26B1E" : "var(--text3)" }}>
                                                    {index + 1}位
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {entry.name}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>
                                                {activeRanking.metricLabel(entry)}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>
                                            {activeRanking.detailLabel(entry)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

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
