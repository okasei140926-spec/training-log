import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
    PR_UPDATE_TOLERANCE_KG,
    sanitizeWorkoutSets,
    sanitizeHistoryRecord,
    hasMeaningfulPRIncrease,
} from "../utils/helpers";
import {
    buildWorkoutSessionEntriesFromHistory,
    buildWorkoutSessionPayloadFromEntries,
} from "../utils/workoutSessions";
import EditUsernameModal from "./friends/EditUsernameModal";
import InviteCard from "./friends/InviteCard";
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
const STALE_MS = 30000;
const EMPTY_FRIEND_SESSION_INSIGHTS = {
    rawMonthlySessions: [],
    monthlyCountByUser: {},
    recentSevenCountByUser: {},
    visibleDatesByUser: {},
    visibilityByUserDate: {},
    sessionsByDate: {},
    workoutsByDate: {},
    validSetsByDate: {},
    missingDates: {},
    excludedSessions: [],
};
const FRIENDS_SCREEN_CACHE = {
    friendsData: {
        userId: null,
        friendIds: [],
        friends: [],
        friendSessionInsights: EMPTY_FRIEND_SESSION_INSIGHTS,
        myUsername: "",
        avatarUrl: null,
        fetchedAt: 0,
    },
    feedData: {
        userId: null,
        activityFeed: [],
        fetchedAt: 0,
    },
};

const parseDateKey = (value) => {
    if (!value) return new Date();
    return new Date(`${String(value).slice(0, 10)}T00:00:00`);
};

const shiftDateKey = (dateKey, days) => {
    const date = parseDateKey(dateKey);
    date.setDate(date.getDate() + days);
    return formatDateKey(date);
};

const formatFeedDateShort = (workoutDate, todayKey) => {
    const normalizedDate = String(workoutDate || "").slice(0, 10);
    if (!normalizedDate) return "";
    if (todayKey && normalizedDate === String(todayKey).slice(0, 10)) return "今日";
    const [, month = "", day = ""] = normalizedDate.split("-");
    return `${month}-${day}`;
};

const hasValidSummaryItem = (item) => {
    if (!item || typeof item !== "object") return false;
    if (Array.isArray(item.sets)) {
        return item.sets.some((set) => {
            const reps = Number(set?.reps ?? 0);
            const weight = set?.weight;
            if (reps <= 0) return false;
            if (weight === "BW") return true;
            return Number(weight ?? 0) > 0;
        });
    }
    return Number(item.set_count ?? item.setCount ?? 0) > 0;
};

const hasValidSessionData = (session) => {
    if (!session || typeof session !== "object") return false;
    const summaryItems = Array.isArray(session.summary_json?.items) ? session.summary_json.items : [];
    if (summaryItems.some(hasValidSummaryItem)) return true;
    if (Number(session.exercise_count ?? 0) > 0) return true;
    if (Number(session.total_volume ?? 0) > 0) return true;
    return false;
};

export default function FriendsScreen({
    history,
    manualBests = [],
    sessionSyncVersion = 0,
    user,
    onLogin,
    onLogout,
    onOpenRecord,
    mode = "all",
}) {
    const [copied, setCopied] = useState(false);
    const [friends, setFriends] = useState(() => FRIENDS_SCREEN_CACHE.friendsData.friends || []);
    const [friendIds, setFriendIds] = useState(() => FRIENDS_SCREEN_CACHE.friendsData.friendIds || []);
    const [, setTodayActiveMap] = useState({});
    const [showEditName, setShowEditName] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [usernameError, setUsernameError] = useState("");
    const [avatarUrl, setAvatarUrl] = useState(() => FRIENDS_SCREEN_CACHE.friendsData.avatarUrl || null);
    const [loading, setLoading] = useState(() => !FRIENDS_SCREEN_CACHE.friendsData.fetchedAt);
    const [friendsRefreshing, setFriendsRefreshing] = useState(false);
    const [myUsername, setMyUsername] = useState(() => FRIENDS_SCREEN_CACHE.friendsData.myUsername || "");
    const [activityFeed, setActivityFeed] = useState(() => FRIENDS_SCREEN_CACHE.feedData.activityFeed || []);
    const [activityFeedLoading, setActivityFeedLoading] = useState(false);
    const [feedRefreshing, setFeedRefreshing] = useState(false);
    const [activityFeedAction, setActivityFeedAction] = useState(null);
    const [activityFeedStatusMessage, setActivityFeedStatusMessage] = useState("");
    const [likePendingMap, setLikePendingMap] = useState({});
    const [commentsSessionTarget, setCommentsSessionTarget] = useState(null);
    const [rankingTab, setRankingTab] = useState("big3");
    const [expandedFeedDates, setExpandedFeedDates] = useState({});
    const [friendSessionInsights, setFriendSessionInsights] = useState(() => (
        FRIENDS_SCREEN_CACHE.friendsData.friendSessionInsights || EMPTY_FRIEND_SESSION_INSIGHTS
    ));
    const activityFeedStatusTimeoutRef = useRef(null);
    const today = formatDateKey();
    const currentMonthPrefix = today.slice(0, 7);
    const recentSevenStart = shiftDateKey(today, -6);
    const showFeedSections = mode !== "ranking";
    const showRankingSections = mode !== "feed";
    const visibleFriendDatesCount = useMemo(
        () => Object.values(friendSessionInsights.visibleDatesByUser || {}).reduce(
            (sum, dates) => sum + (Array.isArray(dates) ? dates.length : 0),
            0
        ),
        [friendSessionInsights.visibleDatesByUser]
    );

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

    const fetchFriendsData = useCallback(async ({ force = false, background = false } = {}) => {
        if (!user) {
            setFriendIds([]);
            setFriends([]);
            setFriendSessionInsights(EMPTY_FRIEND_SESSION_INSIGHTS);
            setTodayActiveMap({});
            return false;
        }

        const now = Date.now();
        const hasCache = FRIENDS_SCREEN_CACHE.friendsData.fetchedAt > 0
            && FRIENDS_SCREEN_CACHE.friendsData.userId === user.id;
        if (!force && hasCache && now - FRIENDS_SCREEN_CACHE.friendsData.fetchedAt < STALE_MS) {
            return true;
        }

        if (!hasCache && !background) {
            setLoading(true);
        } else {
            setFriendsRefreshing(true);
        }
        try {
            const { data: friendships, error: friendshipsError } = await supabase
                .from("friendships")
                .select("requester_id, receiver_id")
                .eq("status", "accepted")
                .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`);

            if (friendshipsError) {
                console.error("[feed] friendships fetch failed", friendshipsError);
                console.error("[ranking] friendships fetch failed", friendshipsError);
                throw friendshipsError;
            }

            if (!friendships || friendships.length === 0) {
                setFriendIds([]);
                setFriends([]);
                setFriendSessionInsights(EMPTY_FRIEND_SESSION_INSIGHTS);
                FRIENDS_SCREEN_CACHE.friendsData = {
                    userId: user.id,
                    ...FRIENDS_SCREEN_CACHE.friendsData,
                    friendIds: [],
                    friends: [],
                    friendSessionInsights: EMPTY_FRIEND_SESSION_INSIGHTS,
                    fetchedAt: Date.now(),
                };
                setTodayActiveMap({});
                setLoading(false);
                return true;
            }

            const nextFriendIds = [...new Set(
                friendships.map((f) =>
                    f.requester_id === user.id ? f.receiver_id : f.requester_id
                )
            )];

            console.log("[feed] accepted friend ids", {
                currentUserId: user.id,
                friendIds: nextFriendIds,
            });

            setFriendIds(nextFriendIds);

            const currentMonthStart = `${currentMonthPrefix}-01`;
            const [profilesRes, workoutsRes, friendSessionsRes] = await Promise.all([
                supabase
                    .from("profiles")
                    .select("id, username, avatar1_url")
                    .in("id", nextFriendIds),
                supabase
                    .from("workouts")
                    .select("user_id, date, data")
                    .in("user_id", nextFriendIds)
                    .order("date", { ascending: false }),
                supabase
                    .from("workout_sessions")
                    .select("id, user_id, workout_date, created_at, updated_at, visibility, summary_json, total_volume, exercise_count")
                    .in("user_id", nextFriendIds)
                    .gte("workout_date", currentMonthStart)
                    .lte("workout_date", today)
                    .order("workout_date", { ascending: false })
                    .order("created_at", { ascending: true }),
            ]);

            const { data: profiles, error: profilesError } = profilesRes;
            const workoutsError = workoutsRes.error;
            const workouts = workoutsRes.data || [];
            const friendSessionsError = friendSessionsRes.error;
            const rawFriendSessions = friendSessionsRes.data || [];

            if (profilesError) {
                console.error("[feed] friend profiles fetch failed", {
                    error: profilesError,
                    currentUserId: user.id,
                    friendIds: nextFriendIds,
                });
            }
            if (workoutsError) {
                console.error("[feed] friend workouts fetch failed", {
                    error: workoutsError,
                    currentUserId: user.id,
                    friendIds: nextFriendIds,
                });
            }
            if (friendSessionsError) {
                console.error("[ranking] friend sessions fetch failed", {
                    error: friendSessionsError,
                    currentUserId: user.id,
                    friendIds: nextFriendIds,
                    currentMonthStart,
                    today,
                });
                console.error("[feed] friend sessions fetch failed", {
                    error: friendSessionsError,
                    currentUserId: user.id,
                    friendIds: nextFriendIds,
                    currentMonthStart,
                    today,
                });
            }

            console.log("[feed] friend workouts count", {
                currentUserId: user.id,
                friendIds: nextFriendIds,
                count: workouts.length,
            });

            const visibilityByUserDate = {};
            const sessionsByDate = {};
            const workoutsByDate = {};
            const validSetsByDate = {};
            const monthlyCountByUser = {};
            const recentSevenCountByUser = {};
            const missingDates = {};
            const excludedSessions = [];

            rawFriendSessions.forEach((session) => {
                const userDateKey = `${session.user_id}::${session.workout_date}`;
                if (!visibilityByUserDate[userDateKey]) visibilityByUserDate[userDateKey] = [];
                visibilityByUserDate[userDateKey].push(String(session.visibility || "unknown"));
                if (!sessionsByDate[userDateKey]) sessionsByDate[userDateKey] = [];
                sessionsByDate[userDateKey].push(session.id);

                const isAcceptedFriend = nextFriendIds.includes(session.user_id);
                const visibility = String(session.visibility || "");
                const isVisibleToFriends = !visibility || visibility === "friends" || visibility === "public";
                const hasValidSets = hasValidSessionData(session);
                let reason = null;
                if (!session.workout_date) reason = "invalid_date";
                else if (!isAcceptedFriend) reason = "not_friend";
                else if (!isVisibleToFriends) reason = "friend_not_shared";
                else if (!hasValidSets) reason = "no_valid_sets";

                if (reason) {
                    excludedSessions.push({
                        userId: session.user_id,
                        sessionId: session.id,
                        workoutDate: session.workout_date,
                        visibility: session.visibility,
                        hasValidSets,
                        isAcceptedFriend,
                        reason,
                    });
                    console.warn("[ranking] session excluded", {
                        userId: session.user_id,
                        sessionId: session.id,
                        workoutDate: session.workout_date,
                        visibility: session.visibility,
                        hasValidSets,
                        isAcceptedFriend,
                        reason,
                    });
                    return;
                }

                monthlyCountByUser[session.user_id] = monthlyCountByUser[session.user_id] || new Set();
                monthlyCountByUser[session.user_id].add(session.workout_date);
                if (session.workout_date >= recentSevenStart) {
                    recentSevenCountByUser[session.user_id] = recentSevenCountByUser[session.user_id] || new Set();
                    recentSevenCountByUser[session.user_id].add(session.workout_date);
                }
            });

            const workoutRowsMap = new Map();
            (workouts || []).forEach((workout) => {
                const current = workoutRowsMap.get(workout.user_id) || [];
                current.push(workout);
                workoutRowsMap.set(workout.user_id, current);

                const userDateKey = `${workout.user_id}::${workout.date}`;
                workoutsByDate[userDateKey] = true;
                const historyMap = buildHistoryFromWorkoutRows([workout]);
                const hasValidSets = getValidWorkoutDatesFromHistory(historyMap, { prefix: workout.date }).includes(workout.date);
                if (hasValidSets) validSetsByDate[userDateKey] = true;
            });

            const friendsWithHistory = nextFriendIds.map((friendId) => {
                const profile = (profiles || []).find((item) => item.id === friendId) || {
                    id: friendId,
                    username: "ユーザー",
                    avatar1_url: null,
                };
                const friendWorkoutRows = workoutRowsMap.get(friendId) || [];
                return {
                    ...profile,
                    workoutRows: friendWorkoutRows,
                    history: buildHistoryFromWorkoutRows(friendWorkoutRows),
                };
            });

            friendsWithHistory.forEach((friend) => {
                const visibleDates = monthlyCountByUser[friend.id] ? Array.from(monthlyCountByUser[friend.id]) : [];
                const workoutDates = getValidWorkoutDatesFromHistory(friend.history, { prefix: currentMonthPrefix });
                const visibleDateSet = new Set([...visibleDates, ...workoutDates]);
                monthlyCountByUser[friend.id] = visibleDateSet;
                const recentWorkoutDates = getValidWorkoutDatesFromHistory(friend.history, { since: recentSevenStart })
                    .filter((dateKey) => dateKey <= today);
                recentSevenCountByUser[friend.id] = new Set([
                    ...(recentSevenCountByUser[friend.id] ? Array.from(recentSevenCountByUser[friend.id]) : []),
                    ...recentWorkoutDates,
                ]);
                missingDates[friend.id] = workoutDates.filter((dateKey) => !new Set(visibleDates).has(dateKey));
            });

            const nextInsights = {
                rawMonthlySessions: rawFriendSessions,
                monthlyCountByUser: Object.fromEntries(
                    Object.entries(monthlyCountByUser).map(([userId, dates]) => [userId, dates.size])
                ),
                recentSevenCountByUser: Object.fromEntries(
                    Object.entries(recentSevenCountByUser).map(([userId, dates]) => [userId, dates.size])
                ),
                visibleDatesByUser: Object.fromEntries(
                    Object.entries(monthlyCountByUser).map(([userId, dates]) => [userId, Array.from(dates).sort()])
                ),
                visibilityByUserDate,
                sessionsByDate,
                workoutsByDate,
                validSetsByDate,
                missingDates,
                excludedSessions,
            };

            setFriendSessionInsights(nextInsights);
            setFriends(friendsWithHistory);
            FRIENDS_SCREEN_CACHE.friendsData = {
                userId: user.id,
                friendIds: nextFriendIds,
                friends: friendsWithHistory,
                friendSessionInsights: nextInsights,
                myUsername,
                avatarUrl,
                fetchedAt: Date.now(),
            };
            await fetchTodayActive(nextFriendIds);
            return true;
        } catch (err) {
            console.error("[feed] friendships/profile fetch failed", {
                error: err,
                currentUserId: user?.id,
            });
            setFriendIds([]);
            setFriends([]);
            setFriendSessionInsights(EMPTY_FRIEND_SESSION_INSIGHTS);
            setTodayActiveMap({});
            return false;
        } finally {
            setLoading(false);
            setFriendsRefreshing(false);
        }
    }, [avatarUrl, currentMonthPrefix, fetchTodayActive, myUsername, recentSevenStart, today, user]);

    const formatSessionSetDisplay = useCallback((set) => {
        if (!set) return "";
        const reps = Number(set.reps || 0);
        const repLabel = `${reps}`;
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

        const timestampBase = `${workoutDate}T12:00:00+09:00`;
        const payloadSummary = payload?.session?.summary_json || {};
        const sessionSummary = sessionMeta?.summary_json || {};
        const fallbackPrCount = entries.reduce((count, entry) => {
            const previousSets = (sourceHistory?.[entry.exerciseName] || []).reduce((sets, record) => {
                const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: false });
                if (!sanitized?.date || sanitized.date >= workoutDate) return sets;
                const recordBodyPart = String(sanitized.bodyPart || sanitized.body_part || "").trim();
                if (recordBodyPart && entry.bodyPart && recordBodyPart !== entry.bodyPart) {
                    return sets;
                }
                sets.push(...sanitizeWorkoutSets(getRecordSourceSets(sanitized), { allowBodyweight: false }));
                return sets;
            }, []);

            if (!previousSets.length) return count;
            if (!hasMeaningfulPRIncrease(entry.sets, previousSets, null, PR_UPDATE_TOLERANCE_KG)) {
                return count;
            }
            return count + 1;
        }, 0);
        const summary = {
            ...payloadSummary,
            ...sessionSummary,
            prCount: Number(sessionSummary?.prCount || payloadSummary?.prCount || fallbackPrCount || 0),
        };
        const summaryItems = Array.isArray(summary.items) ? summary.items : [];
        const hasSessionFallback = hasValidSessionData(sessionMeta);

        if (!payload?.session && !summaryItems.length && !hasSessionFallback) return null;

        return {
            id: sessionMeta?.id || `feed-${feedUserId}-${workoutDate}`,
            sessionId: sessionMeta?.id || null,
            user_id: feedUserId,
            workout_date: workoutDate,
            started_at: null,
            ended_at: null,
            created_at: sessionMeta?.created_at || timestampBase,
            updated_at: sessionMeta?.updated_at || timestampBase,
            duration_sec: Number(sessionMeta?.duration_sec || 0),
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
            source: sessionMeta ? "session" : "workout_fallback",
        };
    }, []);

    const fetchActivityFeed = useCallback(async ({ reset = false, force = false, background = false } = {}) => {
        if (!user?.id) {
            setActivityFeed([]);
            return false;
        }

        console.log("[feed] current user id", user?.id);
        const feedUserIds = [...new Set([user.id, ...friendIds])];

        const now = Date.now();
        const hasCache = FRIENDS_SCREEN_CACHE.feedData.fetchedAt > 0
            && FRIENDS_SCREEN_CACHE.feedData.userId === user.id;
        const cachedItems = hasCache ? (FRIENDS_SCREEN_CACHE.feedData.activityFeed || []) : [];
        const cachedFriendCount = cachedItems.filter((item) => item?.user_id && item.user_id !== user.id).length;
        const expectedFriendCount = friendIds.reduce(
            (sum, friendId) => sum + ((friendSessionInsights.visibleDatesByUser?.[friendId] || []).length),
            0
        );
        const shouldBypassFreshCache = hasCache
            && friendIds.length > 0
            && expectedFriendCount > 0
            && cachedFriendCount < expectedFriendCount;

        if (!force && hasCache && !shouldBypassFreshCache && now - FRIENDS_SCREEN_CACHE.feedData.fetchedAt < STALE_MS) {
            return true;
        }

        if (!hasCache && !background) {
            setActivityFeedLoading(true);
        } else {
            setFeedRefreshing(true);
        }

        try {
            const previousItems = hasCache ? cachedItems : (activityFeed || []);
            const beforeCount = previousItems.length;
            const beforeFriendCount = previousItems.filter((item) => item?.user_id && item.user_id !== user.id).length;
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
            if (sessionsError) {
                console.error("[feed] workout_sessions fetch failed", {
                    error: sessionsError,
                    currentUserId: user.id,
                    friendIds,
                    recentSevenStart,
                    today,
                });
            }
            const rawSessions = sessions || [];
            const friendSessions = rawSessions.filter((session) => session?.user_id && friendIds.includes(session.user_id));
            const friendVisibilityStats = friendSessions.reduce((stats, session) => {
                const visibility = String(session?.visibility || "unknown");
                stats[visibility] = (stats[visibility] || 0) + 1;
                return stats;
            }, {});
            console.log("[feed] accepted friend ids", friendIds);
            console.log("[feed] friend visibility stats", {
                currentUserId: user.id,
                friendIds,
                count: friendSessions.length,
                stats: friendVisibilityStats,
            });

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
                        .select("user_id, date, data")
                        .in("user_id", feedUserIds)
                        .gte("date", recentSevenStart)
                        .lte("date", today)
                    : Promise.resolve({ data: [], error: null }),
            ]);

            if (profilesRes.error) {
                console.error("[feed] profiles fetch failed", {
                    error: profilesRes.error,
                    currentUserId: user.id,
                    friendIds,
                });
            }
            if (photosRes.error) {
                console.error("[feed] photos fetch failed", {
                    error: photosRes.error,
                    currentUserId: user.id,
                });
            }
            if (likesRes.error) {
                console.error("[feed] likes fetch failed", {
                    error: likesRes.error,
                    currentUserId: user.id,
                });
            }
            if (commentsRes.error) {
                console.error("[feed] comments fetch failed", {
                    error: commentsRes.error,
                    currentUserId: user.id,
                });
            }
            if (workoutsRes.error) {
                console.error("[feed] workouts fetch failed", {
                    error: workoutsRes.error,
                    currentUserId: user.id,
                    friendIds,
                });
            }

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
                        userId: session.user_id,
                        workoutId: session.id,
                        sessionId: session.id,
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
                        userId: session.user_id,
                        workoutId: session.id,
                        sessionId: session.id,
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
                if (
                    isFriendWorkout &&
                    session.visibility &&
                    !["friends", "public"].includes(String(session.visibility))
                ) {
                    excludedItems.push({
                        userId: session.user_id,
                        workoutId: session.id,
                        sessionId: session.id,
                        workoutDate: session.workout_date,
                        created_at: session.created_at,
                        shared_at: session.updated_at,
                        visibility: session.visibility,
                        isShared: true,
                        isOwnWorkout,
                        isFriendWorkout,
                        includedInFeed: false,
                        excludedReason: "friend_not_shared",
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

            const buildItemsForUser = (targetUserId, sourceHistory = {}, preferredDates = []) => {
                const historyDates = getValidWorkoutDatesFromHistory(sourceHistory, { since: recentSevenStart })
                    .filter((dateKey) => dateKey <= today);
                const sessionDates = Array.from(sessionMetaMap.keys())
                    .map((key) => {
                        const [userId, date] = String(key).split("::");
                        return userId === targetUserId ? date : null;
                    })
                    .filter((dateKey) => dateKey && dateKey >= recentSevenStart && dateKey <= today);
                const visibleDates = (Array.isArray(preferredDates) ? preferredDates : [])
                    .filter((dateKey) => dateKey >= recentSevenStart && dateKey <= today);
                const validDates = [...new Set([...historyDates, ...sessionDates, ...visibleDates])];

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
                            userId: targetUserId,
                            workoutId: workoutKey,
                            sessionId: sessionMetaMap.get(workoutKey)?.id || null,
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
                buildItemsForUser(
                    friendId,
                    buildHistoryFromWorkoutRows(workoutRowsByUser.get(friendId) || []),
                    friendSessionInsights.visibleDatesByUser?.[friendId] || []
                )
            );

            console.log("[feed] own sessions count", {
                currentUserId: user.id,
                count: ownItems.length,
            });
            console.log("[feed] own sessions count", ownItems.length);
            console.log("[feed] friend sessions count", {
                currentUserId: user.id,
                friendIds,
                count: friendSessions.length,
            });
            console.log("[feed] friend sessions count", friendSessions.length);
            console.log("[feed] friend workouts count", {
                currentUserId: user.id,
                friendIds,
                count: (workoutsRes.data || []).filter((row) => friendIds.includes(row.user_id)).length,
            });
            console.log("[feed] friend workouts count", (workoutsRes.data || []).filter((row) => friendIds.includes(row.user_id)).length);
            excludedItems
                .filter((item) => item.isFriendWorkout)
                .forEach((item) => {
                    console.warn("[feed] friend workout excluded reason", {
                        userId: item.userId || null,
                        workoutId: item.workoutId,
                        sessionId: item.sessionId || item.workoutId || null,
                        workoutDate: item.workoutDate || null,
                        visibility: item.visibility,
                        hasValidSets: item.excludedReason !== "no_valid_sets",
                        isAcceptedFriend: true,
                        reason: item.excludedReason,
                    });
                });

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
                sessionsCount: rawSessions.length,
                workoutsCount: (workoutsRes.data || []).length,
                feedItemsLength: allItems.length,
                headerActivityCount: allItems.length,
                displayedCardsCount: allItems.length,
                todayLocalDate: today,
                last7StartDate: recentSevenStart,
                excludedReason: excludedItems,
            });
            console.log("[feed] displayed cards count", {
                currentUserId: user.id,
                displayedCardsCount: allItems.length,
            });
            console.log("[feed] displayed cards count", allItems.length);
            console.log("[feed] final cards", {
                ownCount: ownItems.length,
                friendCount: friendItems.length,
                totalCount: allItems.length,
                cards: allItems.map((x) => ({
                    userId: x.user_id,
                    userName: getDisplayUsername(x.profile?.username, { isMe: x.user_id === user.id }),
                    date: x.workout_date,
                    source: x.source,
                })),
            });

            setActivityFeed(allItems);
            FRIENDS_SCREEN_CACHE.feedData = {
                userId: user.id,
                activityFeed: allItems,
                fetchedAt: Date.now(),
            };
            if (background) {
                const afterFriendCount = allItems.filter((item) => item?.user_id && item.user_id !== user.id).length;
                console.log("[feed] auto refresh result", {
                    beforeCount,
                    afterCount: allItems.length,
                    beforeFriendCount,
                    afterFriendCount,
                    updatedFromAutoRefresh: true,
                });
            }
            return true;
        } catch (error) {
            console.error("[feed] RLS or Supabase error", {
                error,
                currentUserId: user?.id,
                friendIds,
                recentSevenStart,
                today,
            });
            console.error("[feed] fetch failed", {
                error,
                currentUserId: user?.id,
                friendIds,
                sessionsCount: 0,
                workoutsCount: 0,
                feedItemsLength: 0,
                displayedCardsCount: 0,
            });
            if (reset) {
                setActivityFeed([]);
            }
            return false;
        } finally {
            setActivityFeedLoading(false);
            setFeedRefreshing(false);
        }
    }, [activityFeed, buildFeedItemFromHistoryDate, friendIds, friendSessionInsights.visibleDatesByUser, getDisplayUsername, history, recentSevenStart, today, user?.id]);

    const handleRefreshActivityFeed = useCallback(async () => {
        if (activityFeedLoading) return;
        setActivityFeedAction("refresh");
        setActivityFeedStatusMessage("");
        const [feedOk] = await Promise.all([
            fetchActivityFeed({ reset: true, force: true }),
            fetchFriendsData({ force: true }),
        ]);
        setActivityFeedAction(null);
        showActivityFeedStatusMessage(feedOk ? "更新しました" : "更新できませんでした");
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
        fetchFriendsData({ background: Boolean(FRIENDS_SCREEN_CACHE.friendsData.fetchedAt) });
    }, [user, fetchFriendsData, sessionSyncVersion]);

    useEffect(() => {
        if (!user || !showRankingSections) return;
        fetchFriendsData({ background: true }).catch(console.error);
    }, [user, fetchFriendsData, rankingTab, showRankingSections]);

    useEffect(() => {
        if (!user || !friendIds.length) return;

        const intervalId = setInterval(() => {
            fetchTodayActive(friendIds).catch(console.error);
        }, 60000);

        return () => clearInterval(intervalId);
    }, [user, friendIds, fetchTodayActive]);

    useEffect(() => {
        if (!user) return;
        fetchActivityFeed({
            reset: true,
            background: Boolean(FRIENDS_SCREEN_CACHE.feedData.fetchedAt),
        });
    }, [user, friendIds, fetchActivityFeed, sessionSyncVersion]);

    useEffect(() => {
        if (!user || !showFeedSections) return;
        fetchActivityFeed({ reset: true, background: true, force: true }).catch(console.error);
    }, [user, fetchActivityFeed, showFeedSections, sessionSyncVersion]);

    useEffect(() => {
        if (!user || !showFeedSections) return;
        if (!friendIds.length && visibleFriendDatesCount === 0) return;
        fetchActivityFeed({ reset: true, background: true, force: true }).catch(console.error);
    }, [user, showFeedSections, friendIds, visibleFriendDatesCount, fetchActivityFeed]);

    useEffect(() => {
        if (!user) return undefined;

        const refreshVisibleData = () => {
            fetchFriendsData({ background: true }).catch(console.error);
            if (showFeedSections) {
                fetchActivityFeed({ reset: true, background: true, force: true }).catch(console.error);
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                refreshVisibleData();
            }
        };

        window.addEventListener("focus", refreshVisibleData);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.removeEventListener("focus", refreshVisibleData);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [user, fetchActivityFeed, fetchFriendsData, showFeedSections]);

    useEffect(() => {
        if (!user) return undefined;
        const intervalId = setInterval(() => {
            fetchActivityFeed({ reset: true, background: true, force: true }).catch(console.error);
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
            FRIENDS_SCREEN_CACHE.friendsData = {
                ...FRIENDS_SCREEN_CACHE.friendsData,
                avatarUrl: data?.avatar1_url || null,
                myUsername: data?.username || "",
            };
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

    const selfRecentSevenSessions = getValidWorkoutDatesFromHistory(history, { since: recentSevenStart });
    const selfMonthlySessions = getValidWorkoutDatesFromHistory(history, { prefix: currentMonthPrefix });

    const recentSevenRanking = [
        {
            id: user?.id || "me",
            name: getDisplayUsername(myUsername, { isMe: true }),
            isMe: true,
            value: selfRecentSevenSessions.length,
        },
        ...friends.map((friend) => ({
            id: friend.id,
            name: getDisplayUsername(friend.username),
            isMe: false,
            value: Number(
                friendSessionInsights.recentSevenCountByUser?.[friend.id]
                ?? getValidWorkoutDatesFromHistory(friend.history, { since: recentSevenStart }).length
            ),
        })),
    ].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ja"));

    const monthlyWorkoutRanking = [
        {
            id: user?.id || "me",
            name: getDisplayUsername(myUsername, { isMe: true }),
            isMe: true,
            value: selfMonthlySessions.length,
        },
        ...friends.map((friend) => ({
            id: friend.id,
            name: getDisplayUsername(friend.username),
            isMe: false,
            value: Number(
                friendSessionInsights.monthlyCountByUser?.[friend.id]
                ?? countMonthlyWorkoutDays(friend.history)
            ),
        })),
    ].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ja"));

    useEffect(() => {
        if (!user?.id) return;
        const friendMonthlySessionsRaw = Array.isArray(friendSessionInsights.rawMonthlySessions)
            ? friendSessionInsights.rawMonthlySessions
            : [];
        const friendSessionCountByUser = Object.fromEntries(
            friends.map((friend) => [
                friend.id,
                Number(
                    friendSessionInsights.monthlyCountByUser?.[friend.id]
                    ?? countMonthlyWorkoutDays(friend.history)
                ),
            ])
        );
        console.log("[ranking] current user id", user?.id);
        console.log("[ranking] accepted friend ids", friendIds);
        console.log("[ranking] self monthly sessions count", selfMonthlySessions?.length);
        console.log("[ranking] friend monthly sessions raw", friendMonthlySessionsRaw);
        console.log("[ranking] friend monthly sessions count by user", friendSessionCountByUser);
        console.log("[ranking] visibility by user/date", friendSessionInsights.visibilityByUserDate || {});
        console.log("[ranking] excluded monthly sessions", friendSessionInsights.excludedSessions || []);
        console.log("[ranking] final ranking rows", monthlyWorkoutRanking);
        console.log("[profile] viewed user id", user?.id);
        console.log("[profile] current user id", user?.id);
        console.log("[profile] accepted friend ids", friendIds);
        console.log("[profile] self visible training days", selfMonthlySessions);
        console.log("[profile] friend visible training days", friendSessionInsights.visibleDatesByUser || {});
        console.log("[profile] missing dates for friend", friendSessionInsights.missingDates || {});
        console.log("[profile] visibility by date", friendSessionInsights.visibilityByUserDate || {});
        console.log("[profile] workout_sessions by date", friendSessionInsights.sessionsByDate || {});
        console.log("[profile] workouts by date", friendSessionInsights.workoutsByDate || {});
        console.log("[profile] valid sets by date", friendSessionInsights.validSetsByDate || {});
    }, [
        countMonthlyWorkoutDays,
        friendIds,
        friendSessionInsights,
        friends,
        monthlyWorkoutRanking,
        selfMonthlySessions,
        user?.id,
    ]);


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

    const activityCount = activityFeed.length;
    const shouldShowRankingLoading = loading && activeRanking.data.length === 0;
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

    const groupedActivityFeed = useMemo(() => {
        const userMap = new Map();
        const ownItemsCount = activityFeed.filter((item) => item?.user_id === user?.id).length;
        const friendItemsCount = activityFeed.filter((item) => item?.user_id && item.user_id !== user?.id).length;

        activityFeed.forEach((item) => {
            const userId = item.user_id || item.userId || "unknown";
            const workoutDate = String(item.workout_date || item.date || "").slice(0, 10);
            if (!workoutDate) return;

            if (!userMap.has(userId)) {
                const profileName = userId === user?.id
                    ? getDisplayUsername(myUsername, { isMe: true })
                    : getDisplayUsername(item.profile?.username);
                const rawHandle = userId === user?.id
                    ? (myUsername || "")
                    : (item.profile?.username || profileName || "");

                userMap.set(userId, {
                    userId,
                    userName: profileName,
                    handle: rawHandle ? `@${String(rawHandle).replace(/^@+/, "")}` : "",
                    profile: item.profile || null,
                    latestDate: workoutDate,
                    datesMap: new Map(),
                });
            }

            const group = userMap.get(userId);
            if (workoutDate > group.latestDate) group.latestDate = workoutDate;

            if (!group.datesMap.has(workoutDate)) {
                group.datesMap.set(workoutDate, {
                    date: workoutDate,
                    items: [],
                });
            }

            group.datesMap.get(workoutDate).items.push(item);
        });

        const groupedUsers = Array.from(userMap.values())
            .map((group) => {
                const dates = Array.from(group.datesMap.values())
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((dateGroup) => {
                        const allExercises = dateGroup.items.flatMap((feedItem) => (
                            feedItem.detailedItems?.length ? feedItem.detailedItems : (feedItem.summaryItems || [])
                        ));
                        const primaryItem = dateGroup.items[0] || null;

                        return {
                            ...dateGroup,
                            primaryItem,
                            detailedExercises: allExercises,
                        };
                    });

                return {
                    userId: group.userId,
                    userName: group.userName,
                    handle: group.handle,
                    profile: group.profile,
                    latestDate: group.latestDate,
                    activityDayCount: dates.length,
                    dates,
                };
            })
            .sort((a, b) => b.latestDate.localeCompare(a.latestDate));
        console.log("[feed grouped] source counts", {
            ownItemsCount,
            friendItemsCount,
            totalItemsCount: activityFeed.length,
            acceptedFriendIds: friendIds,
        });
        console.log("[feed grouped] users", groupedUsers.map((u) => ({
            userId: u.userId,
            userName: u.userName,
            dateCount: u.dates.length,
            latestDate: u.latestDate,
        })));
        return groupedUsers;
    }, [activityFeed, friendIds, getDisplayUsername, myUsername, user?.id]);

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
                                {feedRefreshing && activityFeedAction === "refresh" && (
                                    <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>
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

                    {activityFeed.length === 0 && !activityFeedLoading && !feedRefreshing ? (
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
                                            padding: 14,
                                            border: "1px solid var(--border2)",
                                            boxShadow: "var(--shadow-card)",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                                            <div style={{ width: 40, height: 40, borderRadius: 20, background: "linear-gradient(135deg, var(--accent), var(--accent2))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, overflow: "hidden", flexShrink: 0 }}>
                                                {userGroup.profile?.avatar1_url
                                                    ? <img src={userGroup.profile.avatar1_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                    : avatarSeed
                                                }
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)", lineHeight: 1.2 }}>
                                                    {userGroup.userName}
                                                </div>
                                                {userGroup.handle && (
                                                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2, lineHeight: 1.25 }}>
                                                        {userGroup.handle}
                                                    </div>
                                                )}
                                                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontWeight: 700 }}>
                                                    直近7日 {userGroup.activityDayCount}日記録
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: "grid", gap: 6 }}>
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
                                                            borderRadius: 14,
                                                            border: "1px solid rgba(217, 228, 239, 0.75)",
                                                            background: "rgba(255,255,255,0.72)",
                                                            overflow: "hidden",
                                                        }}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                console.log("[feed grouped] expand date", {
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
                                                                gap: 8,
                                                                minHeight: 44,
                                                                padding: "8px 12px",
                                                                border: "none",
                                                                background: "transparent",
                                                                color: "var(--text)",
                                                                fontSize: 13,
                                                                fontWeight: 800,
                                                                textAlign: "left",
                                                                cursor: "pointer",
                                                            }}
                                                        >
                                                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                                                                <span style={{ color: "var(--text2)", fontSize: 11, width: 12 }}>
                                                                    {isExpanded ? "▼" : "▶"}
                                                                </span>
                                                                <span>{formatFeedDateShort(dateGroup.date, today)}</span>
                                                            </span>
                                                        </button>

                                                        {isExpanded && (
                                                            <div style={{ padding: "0 12px 10px" }}>
                                                                <div style={{ display: "grid", gap: 2 }}>
                                                                    {dateGroup.detailedExercises.map((summaryItem, index) => {
                                                                        const showDivider = index !== dateGroup.detailedExercises.length - 1;
                                                                        return (
                                                                            <div
                                                                                key={`${expandedKey}-${summaryItem.body_part || ""}-${summaryItem.exercise_name}-${index}`}
                                                                                style={{
                                                                                    padding: showDivider ? "5px 0 7px" : "5px 0 2px",
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
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                            <div style={{ fontSize: 12, color: "var(--text3)" }}>
                                自分の位置と友達との差をチェック
                            </div>
                            {friendsRefreshing && (
                                <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>
                                    更新中...
                                </div>
                            )}
                        </div>

                        {shouldShowRankingLoading ? (
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
