import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../utils/supabase";
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

const debugLog = (...args) => {
    if (process.env.NODE_ENV !== "production") console.debug(...args);
};
const debugWarn = (...args) => {
    if (process.env.NODE_ENV !== "production") console.warn(...args);
};
const debugTime = (label) => {
    if (process.env.NODE_ENV !== "production") console.time(label);
};
const debugTimeEnd = (label) => {
    if (process.env.NODE_ENV !== "production") console.timeEnd(label);
};

const MAX_RANKING_SET_WEIGHT_KG = 1000;
const MAX_RANKING_SET_REPS = 1000;
const MAX_RANKING_MONTHLY_VOLUME_KG = 1000000;
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
const EMPTY_DELETED_WORKOUT_DATES = [];
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

const getCachedFriendIdsForUser = (userId) => (
    FRIENDS_SCREEN_CACHE.friendsData.userId === userId
        ? (FRIENDS_SCREEN_CACHE.friendsData.friendIds || [])
        : []
);

const areStringArraysEqual = (a = [], b = []) => {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
};

const buildFeedItemsSignature = (items = []) => (
    items.map((item) => [
        item?.id || "",
        item?.sessionId || "",
        item?.user_id || "",
        item?.workout_date || "",
        item?.updated_at || "",
        item?.photoUrl || "",
        item?.likeCount ?? "",
        item?.commentCount ?? "",
        item?.likedByMe ? 1 : 0,
    ].join("|")).join("::")
);

const parseDateKey = (value) => {
    if (!value) return new Date();
    return new Date(`${String(value).slice(0, 10)}T00:00:00`);
};

const shiftDateKey = (dateKey, days) => {
    const date = parseDateKey(dateKey);
    date.setDate(date.getDate() + days);
    return formatDateKey(date);
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

const buildHistoryFromSessionRows = (sessions = []) => {
    const historyMap = {};

    (sessions || []).forEach((session) => {
        const workoutDate = String(session?.workout_date || "").slice(0, 10);
        const summaryItems = Array.isArray(session?.summary_json?.items)
            ? session.summary_json.items
            : [];
        if (!workoutDate || !summaryItems.length) return;

        summaryItems.forEach((item, index) => {
            const exerciseName = String(item?.exercise_name || item?.exerciseName || "").trim();
            if (!exerciseName) return;

            const sets = sanitizeWorkoutSets(item?.sets || [], { allowBodyweight: true });
            if (!sets.length) return;

            if (!historyMap[exerciseName]) historyMap[exerciseName] = [];
            historyMap[exerciseName].push({
                date: workoutDate,
                bodyPart: String(item?.body_part || item?.bodyPart || "").trim(),
                order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
                sets,
                source: "workout_session",
            });
        });
    });

    return historyMap;
};

export function useFriendsData({
    user,
    history,
    manualBests = [],
    deletedWorkoutDates = EMPTY_DELETED_WORKOUT_DATES,
    sessionSyncVersion = 0,
    showFeedSections,
    showRankingSections,
    rankingTab,
    volumePeriod,
    onOpenRecord,
}) {
    const [friends, setFriends] = useState(() => FRIENDS_SCREEN_CACHE.friendsData.friends || []);
    const [friendIds, setFriendIds] = useState(() => FRIENDS_SCREEN_CACHE.friendsData.friendIds || []);
    const [, setTodayActiveMap] = useState({});
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
    const [friendSessionInsights, setFriendSessionInsights] = useState(() => (
        FRIENDS_SCREEN_CACHE.friendsData.friendSessionInsights || EMPTY_FRIEND_SESSION_INSIGHTS
    ));
    const activityFeedStatusTimeoutRef = useRef(null);
    const latestFeedRequestIdRef = useRef(0);
    const friendIdsRef = useRef(friendIds);
    const activityFeedRef = useRef(activityFeed);
    const visibleDatesByUserRef = useRef(friendSessionInsights.visibleDatesByUser || {});
    const today = formatDateKey();
    const currentMonthPrefix = today.slice(0, 7);
    const recentSevenStart = shiftDateKey(today, -6);
    const ownDeletedWorkoutDateSet = useMemo(
        () => new Set((deletedWorkoutDates || []).map((date) => String(date || "").slice(0, 10)).filter(Boolean)),
        [deletedWorkoutDates]
    );
    const hasOwnHistorySnapshot = useMemo(
        () => Boolean(history && typeof history === "object" && Object.keys(history).length > 0),
        [history]
    );
    const ownHistoryDateSet = useMemo(() => new Set(
        getValidWorkoutDatesFromHistory(history || {}, { since: recentSevenStart })
            .filter((dateKey) => dateKey <= today)
    ), [history, recentSevenStart, today]);
    const shouldHideOwnWorkoutDate = useCallback((ownerId, workoutDate) => {
        if (!user?.id || ownerId !== user.id) return false;
        const dateKey = String(workoutDate || "").slice(0, 10);
        if (!dateKey) return false;
        if (ownDeletedWorkoutDateSet.has(dateKey)) return true;
        return hasOwnHistorySnapshot
            && dateKey >= recentSevenStart
            && dateKey <= today
            && !ownHistoryDateSet.has(dateKey);
    }, [hasOwnHistorySnapshot, ownDeletedWorkoutDateSet, ownHistoryDateSet, recentSevenStart, today, user?.id]);
    const shouldHideFeedItem = useCallback((item) => (
        shouldHideOwnWorkoutDate(item?.user_id || item?.userId, item?.workout_date || item?.date)
    ), [shouldHideOwnWorkoutDate]);
    const volumePeriodRange = useMemo(() => {
        const todayDate = parseDateKey(today);
        const thisMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
        const lastMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
        const lastMonthEnd = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0);
        const range = volumePeriod === "lastMonth"
            ? {
                key: "lastMonth",
                label: "先月",
                start: formatDateKey(lastMonthStart),
                end: formatDateKey(lastMonthEnd),
            }
            : {
                key: "thisMonth",
                label: "今月",
                start: formatDateKey(thisMonthStart),
                end: today,
            };

        return {
            ...range,
            display: `${Number(range.start.slice(5, 7))}/${Number(range.start.slice(8, 10))} - ${Number(range.end.slice(5, 7))}/${Number(range.end.slice(8, 10))}`,
        };
    }, [today, volumePeriod]);
    const visibleFriendDatesCount = useMemo(
        () => Object.values(friendSessionInsights.visibleDatesByUser || {}).reduce(
            (sum, dates) => sum + (Array.isArray(dates) ? dates.length : 0),
            0
        ),
        [friendSessionInsights.visibleDatesByUser]
    );

    useEffect(() => {
        friendIdsRef.current = friendIds;
    }, [friendIds]);

    useEffect(() => {
        activityFeedRef.current = activityFeed;
    }, [activityFeed]);

    useEffect(() => {
        visibleDatesByUserRef.current = friendSessionInsights.visibleDatesByUser || {};
    }, [friendSessionInsights.visibleDatesByUser]);

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

    const computeVolumeFromHistoryForRange = useCallback((historyData, range) => {
        const totalVolume = Object.values(historyData || {}).reduce((total, records) => (
                total + (records || []).reduce((recordTotal, record) => {
                    const recordDate = String(record?.date || "").slice(0, 10);
                    if (!recordDate || recordDate < range.start || recordDate > range.end) return recordTotal;

                    const setVolume = getRecordSets(record).reduce((sum, set) => {
                        const weight = Number(set?.weight);
                        const reps = Number(set?.reps);
                        if (!Number.isFinite(weight) || weight <= 0) return sum;
                        if (!Number.isFinite(reps) || reps <= 0) return sum;
                        if (weight > MAX_RANKING_SET_WEIGHT_KG) return sum;
                        if (reps > MAX_RANKING_SET_REPS) return sum;

                        const volume = weight * reps;
                        if (!Number.isFinite(volume) || volume < 0) return sum;

                        const nextSum = sum + volume;
                        if (!Number.isFinite(nextSum)) return sum;
                        return nextSum;
                    }, 0);

                    return recordTotal + setVolume;
                }, 0)
        ), 0);

        if (!Number.isFinite(totalVolume) || totalVolume < 0) return 0;
        if (totalVolume > MAX_RANKING_MONTHLY_VOLUME_KG) return null;

        return Math.round(totalVolume);
    }, [getRecordSets]);

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

    const isReservedUsername = useCallback((rawUsername) => {
        const trimmed = String(rawUsername || "").trim();
        if (!trimmed) return false;

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
            setFriendIds((prev) => (prev.length ? [] : prev));
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
                setFriendIds((prev) => (prev.length ? [] : prev));
                setFriends([]);
                setFriendSessionInsights(EMPTY_FRIEND_SESSION_INSIGHTS);
                FRIENDS_SCREEN_CACHE.friendsData = {
                    ...FRIENDS_SCREEN_CACHE.friendsData,
                    userId: user.id,
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

            debugLog("[feed] accepted friend ids", {
                currentUserId: user.id,
                friendIds: nextFriendIds,
            });

            setFriendIds((prev) => (areStringArraysEqual(prev, nextFriendIds) ? prev : nextFriendIds));

            const currentMonthStart = `${currentMonthPrefix}-01`;
            const prevMonthDate = new Date();
            prevMonthDate.setDate(1);
            prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
            const previousMonthStart = prevMonthDate.toISOString().slice(0, 10).slice(0, 7) + "-01";
            const [profilesRes, workoutsRes, friendSessionsRes] = await Promise.all([
                supabase
                    .from("profiles")
                    .select("id, username, avatar1_url")
                    .in("id", nextFriendIds),
                supabase
                    .from("workouts")
                    .select("user_id, date, data")
                    .in("user_id", nextFriendIds)
                    .gte("date", previousMonthStart)
                    .order("date", { ascending: false })
                    .limit(50),
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

            debugLog("[feed] friend workouts count", {
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
            const visibleFriendSessionsByUser = new Map();
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
                    debugWarn("[ranking] session excluded", {
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
                const visibleRows = visibleFriendSessionsByUser.get(session.user_id) || [];
                visibleRows.push(session);
                visibleFriendSessionsByUser.set(session.user_id, visibleRows);
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
                const workoutHistory = buildHistoryFromWorkoutRows(friendWorkoutRows);
                const sessionHistory = buildHistoryFromSessionRows(visibleFriendSessionsByUser.get(friendId) || []);
                return {
                    ...profile,
                    workoutRows: friendWorkoutRows,
                    history: mergeHistoryMaps(workoutHistory, sessionHistory),
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
            setFriendIds((prev) => (prev.length ? [] : prev));
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
            photoId: sessionMeta?.photo_id || null,
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

    const resolveAcceptedFriendIds = useCallback(async () => {
        const directIds = Array.isArray(friendIdsRef.current) ? friendIdsRef.current.filter(Boolean) : [];
        if (directIds.length) return directIds;

        const cachedIds = getCachedFriendIdsForUser(user?.id).filter(Boolean);
        if (cachedIds.length) return cachedIds;

        if (!user?.id) return [];

        const { data: friendships, error } = await supabase
            .from("friendships")
            .select("requester_id, receiver_id")
            .eq("status", "accepted")
            .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`);

        if (error) {
            console.error("[feed] friendships fetch failed", error);
            return [];
        }

        const resolvedIds = [...new Set(
            (friendships || []).map((f) => (
                f.requester_id === user.id ? f.receiver_id : f.requester_id
            ))
        )].filter(Boolean);

        if (resolvedIds.length) {
            setFriendIds((prev) => (areStringArraysEqual(prev, resolvedIds) ? prev : resolvedIds));
            FRIENDS_SCREEN_CACHE.friendsData = {
                ...FRIENDS_SCREEN_CACHE.friendsData,
                userId: user.id,
                friendIds: resolvedIds,
                fetchedAt: FRIENDS_SCREEN_CACHE.friendsData.fetchedAt || Date.now(),
            };
        }

        return resolvedIds;
    }, [user?.id]);

    const fetchActivityFeed = useCallback(async ({ reset = false, force = false, background = false } = {}) => {
        if (!user?.id) {
            setActivityFeed([]);
            return false;
        }
        const requestId = latestFeedRequestIdRef.current + 1;
        latestFeedRequestIdRef.current = requestId;
        debugTime("[feed] load total");

        debugLog("[feed] current user id", user?.id);
        const effectiveFriendIds = await resolveAcceptedFriendIds();
        const feedUserIds = [...new Set([user.id, ...effectiveFriendIds])];

        const now = Date.now();
        const hasCache = FRIENDS_SCREEN_CACHE.feedData.fetchedAt > 0
            && FRIENDS_SCREEN_CACHE.feedData.userId === user.id;
        const cachedItems = hasCache ? (FRIENDS_SCREEN_CACHE.feedData.activityFeed || []) : [];
        const cachedFriendCount = cachedItems.filter((item) => item?.user_id && item.user_id !== user.id).length;
        const visibleDatesByUser = visibleDatesByUserRef.current || {};
        const expectedFriendCount = effectiveFriendIds.reduce(
            (sum, friendId) => sum + ((visibleDatesByUser?.[friendId] || []).length),
            0
        );
        const shouldBypassFreshCache = hasCache
            && effectiveFriendIds.length > 0
            && expectedFriendCount > 0
            && cachedFriendCount < expectedFriendCount;

        if (!force && hasCache && !shouldBypassFreshCache && now - FRIENDS_SCREEN_CACHE.feedData.fetchedAt < STALE_MS) {
            debugTimeEnd("[feed] load total");
            return true;
        }

        if (hasCache && cachedItems.length) {
            const shouldPruneOwnCache = ownDeletedWorkoutDateSet.size > 0 || hasOwnHistorySnapshot;
            const visibleCachedItems = shouldPruneOwnCache
                ? cachedItems.filter((item) => !shouldHideFeedItem(item))
                : cachedItems;
            setActivityFeed((prev) => {
                if (prev.length) return prev;
                activityFeedRef.current = visibleCachedItems;
                return visibleCachedItems;
            });
        }

        const currentActivityFeed = activityFeedRef.current || [];
        if (!hasCache && !background && currentActivityFeed.length === 0) {
            setActivityFeedLoading(true);
        } else {
            setFeedRefreshing(true);
        }

        try {
            const previousItems = hasCache ? cachedItems : (activityFeedRef.current || []);
            const beforeCount = previousItems.length;
            const beforeFriendCount = previousItems.filter((item) => item?.user_id && item.user_id !== user.id).length;
            const profileIds = [...new Set(feedUserIds.filter(Boolean))];
            debugTime("[feed] fetch own");
            debugTime("[feed] fetch friends");
            const [sessionsRes, workoutsRes, profilesRes] = await Promise.all([
                supabase
                    .from("workout_sessions")
                    .select("id, user_id, workout_date, created_at, updated_at, duration_sec, total_volume, exercise_count, summary_json, photo_id, photo_visibility, visibility")
                    .in("user_id", feedUserIds)
                    .gte("workout_date", recentSevenStart)
                    .lte("workout_date", today)
                    .order("workout_date", { ascending: false })
                    .order("updated_at", { ascending: false }),
                feedUserIds.length
                    ? supabase
                        .from("workouts")
                        .select("user_id, date, data")
                        .in("user_id", feedUserIds)
                        .gte("date", recentSevenStart)
                        .lte("date", today)
                    : Promise.resolve({ data: [], error: null }),
                profileIds.length
                    ? supabase.from("profiles").select("id, username, avatar1_url").in("id", profileIds)
                    : Promise.resolve({ data: [], error: null }),
            ]);
            debugTimeEnd("[feed] fetch own");
            debugTimeEnd("[feed] fetch friends");

            const sessions = sessionsRes.data;
            const sessionsError = sessionsRes.error;
            if (sessionsError) {
                console.error("[feed] workout_sessions fetch failed", {
                    error: sessionsError,
                    currentUserId: user.id,
                    friendIds: effectiveFriendIds,
                    recentSevenStart,
                    today,
                });
            }
            const rawSessions = (sessions || []).filter((session) => !shouldHideOwnWorkoutDate(session?.user_id, session?.workout_date));
            const friendSessions = rawSessions.filter((session) => session?.user_id && effectiveFriendIds.includes(session.user_id));
            const friendVisibilityStats = friendSessions.reduce((stats, session) => {
                const visibility = String(session?.visibility || "unknown");
                stats[visibility] = (stats[visibility] || 0) + 1;
                return stats;
            }, {});
            debugLog("[feed] accepted friend ids", effectiveFriendIds);
            debugLog("[feed] friend visibility stats", {
                currentUserId: user.id,
                friendIds: effectiveFriendIds,
                count: friendSessions.length,
                stats: friendVisibilityStats,
            });

            const photoIds = [...new Set(
                rawSessions
                    .filter((session) => session.photo_visibility === "friends" && session.photo_id)
                    .map((session) => session.photo_id)
            )];
            const sessionIds = [...new Set(rawSessions.map((session) => session.id).filter(Boolean))];

            if (profilesRes.error) {
                console.error("[feed] profiles fetch failed", {
                    error: profilesRes.error,
                    currentUserId: user.id,
                    friendIds: effectiveFriendIds,
                });
            }
            if (workoutsRes.error) {
                console.error("[feed] workouts fetch failed", {
                    error: workoutsRes.error,
                    currentUserId: user.id,
                    friendIds: effectiveFriendIds,
                });
            }

            const profileMap = new Map((profilesRes.data || []).map((profile) => [profile.id, profile]));
            const visibleWorkoutRows = (workoutsRes.data || []).filter((row) => !shouldHideOwnWorkoutDate(row?.user_id, row?.date));
            const workoutRowMap = new Map(
                visibleWorkoutRows.map((row) => [`${row.user_id}::${row.date}`, row])
            );

            const excludedItems = [];
            const workoutRowsByUser = new Map();
            visibleWorkoutRows.forEach((row) => {
                const current = workoutRowsByUser.get(row.user_id) || [];
                current.push(row);
                workoutRowsByUser.set(row.user_id, current);
            });

            const sessionMetaMap = new Map();
            rawSessions.forEach((session) => {
                const isOwnWorkout = session.user_id === user.id;
                const isFriendWorkout = !isOwnWorkout && effectiveFriendIds.includes(session.user_id);

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
                    photoUrl: null,
                    likeCount: 0,
                    likedByMe: false,
                    commentCount: 0,
                };
                const existingMeta = sessionMetaMap.get(sessionKey);
                const existingTime = new Date(existingMeta?.updated_at || existingMeta?.created_at || 0).getTime();
                const nextTime = new Date(nextMeta.updated_at || nextMeta.created_at || 0).getTime();
                if (!existingMeta || nextTime >= existingTime) {
                    sessionMetaMap.set(sessionKey, nextMeta);
                }
            });

            const buildItemsForUser = (targetUserId, sourceHistory = {}, preferredDates = []) => {
                const isOwnTarget = targetUserId === user.id;
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
                const validDates = [
                    ...new Set(isOwnTarget ? historyDates : [...historyDates, ...sessionDates, ...visibleDates]),
                ]
                    .filter((dateKey) => !shouldHideOwnWorkoutDate(targetUserId, dateKey));

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
            const remoteOwnHistory = buildHistoryFromWorkoutRows(ownWorkoutRows);
            const localOwnHistory = history && Object.keys(history).length ? history : remoteOwnHistory;
            const ownItems = buildItemsForUser(user.id, localOwnHistory);
            const visibleDatesByUser = visibleDatesByUserRef.current || {};
            const friendItems = effectiveFriendIds.flatMap((friendId) =>
                buildItemsForUser(
                    friendId,
                    buildHistoryFromWorkoutRows(workoutRowsByUser.get(friendId) || []),
                    visibleDatesByUser?.[friendId] || []
                )
            );

            debugLog("[feed] own sessions count", {
                currentUserId: user.id,
                count: ownItems.length,
            });
            debugLog("[feed] own sessions count", ownItems.length);
            debugLog("[feed] friend sessions count", {
                currentUserId: user.id,
                friendIds: effectiveFriendIds,
                count: friendSessions.length,
            });
            debugLog("[feed] friend sessions count", friendSessions.length);
            debugLog("[feed] friend workouts count", {
                currentUserId: user.id,
                friendIds: effectiveFriendIds,
                count: visibleWorkoutRows.filter((row) => effectiveFriendIds.includes(row.user_id)).length,
            });
            debugLog("[feed] friend workouts count", visibleWorkoutRows.filter((row) => effectiveFriendIds.includes(row.user_id)).length);
            excludedItems
                .filter((item) => item.isFriendWorkout)
                .forEach((item) => {
                    debugWarn("[feed] friend workout excluded reason", {
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

            debugLog("[feed] normalized feed items", {
                currentUserId: user.id,
                friendIds: effectiveFriendIds,
                ownWorkoutsLast7DaysCount: ownItems.length,
                friendWorkoutsLast7DaysCount: friendItems.length,
                sessionsCount: rawSessions.length,
                workoutsCount: visibleWorkoutRows.length,
                feedItemsLength: allItems.length,
                headerActivityCount: allItems.length,
                displayedCardsCount: allItems.length,
                todayLocalDate: today,
                last7StartDate: recentSevenStart,
                excludedReason: excludedItems,
            });
            debugLog("[feed] displayed cards count", {
                currentUserId: user.id,
                displayedCardsCount: allItems.length,
            });
            debugLog("[feed] displayed cards count", allItems.length);
            debugLog("[feed] final cards", {
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

            if (latestFeedRequestIdRef.current !== requestId) {
                return true;
            }
            setActivityFeed((prev) => {
                const nextItems = buildFeedItemsSignature(prev) === buildFeedItemsSignature(allItems)
                    ? prev
                    : allItems;
                activityFeedRef.current = nextItems;
                return nextItems;
            });
            FRIENDS_SCREEN_CACHE.feedData = {
                userId: user.id,
                activityFeed: allItems,
                fetchedAt: Date.now(),
            };
            if (background) {
                const afterFriendCount = allItems.filter((item) => item?.user_id && item.user_id !== user.id).length;
                debugLog("[feed] auto refresh result", {
                    beforeCount,
                    afterCount: allItems.length,
                    beforeFriendCount,
                    afterFriendCount,
                    updatedFromAutoRefresh: true,
                });
            }
            if (sessionIds.length || photoIds.length) {
                Promise.all([
                    photoIds.length
                        ? supabase.from("progress_photos").select("id, storage_path").in("id", photoIds)
                        : Promise.resolve({ data: [], error: null }),
                    sessionIds.length
                        ? supabase.from("workout_session_likes").select("session_id, user_id").in("session_id", sessionIds)
                        : Promise.resolve({ data: [], error: null }),
                    sessionIds.length
                        ? supabase.from("workout_session_comments").select("id, session_id").in("session_id", sessionIds)
                        : Promise.resolve({ data: [], error: null }),
                ]).then(async ([photosRes, likesRes, commentsRes]) => {
                    if (latestFeedRequestIdRef.current !== requestId) return;
                    if (photosRes.error) {
                        console.error("[feed] photos fetch failed", { error: photosRes.error, currentUserId: user.id });
                    }
                    if (likesRes.error) {
                        console.error("[feed] likes fetch failed", { error: likesRes.error, currentUserId: user.id });
                    }
                    if (commentsRes.error) {
                        console.error("[feed] comments fetch failed", { error: commentsRes.error, currentUserId: user.id });
                    }

                    const signedEntries = await Promise.all(((photosRes.data || [])).map(async (row) => {
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

                    (likesRes.data || []).forEach((row) => {
                        if (!row?.session_id) return;
                        likeCountMap.set(row.session_id, (likeCountMap.get(row.session_id) || 0) + 1);
                        if (row.user_id === user.id) likedSessionIds.add(row.session_id);
                    });
                    (commentsRes.data || []).forEach((row) => {
                        if (!row?.session_id) return;
                        commentCountMap.set(row.session_id, (commentCountMap.get(row.session_id) || 0) + 1);
                    });

                    setActivityFeed((prev) => {
                        const enrichedItems = prev
                        .filter((item) => !shouldHideFeedItem(item))
                        .map((item) => (
                            item?.sessionId
                                ? {
                                    ...item,
                                    photoUrl: item.photoUrl || photoUrlMap.get(item.photoId) || item.photoUrl || null,
                                    likeCount: likeCountMap.get(item.sessionId) ?? item.likeCount ?? 0,
                                    likedByMe: likedSessionIds.has(item.sessionId) || item.likedByMe || false,
                                    commentCount: commentCountMap.get(item.sessionId) ?? item.commentCount ?? 0,
                                }
                                : item
                        ));
                        const nextItems = buildFeedItemsSignature(prev) === buildFeedItemsSignature(enrichedItems)
                            ? prev
                            : enrichedItems;
                        activityFeedRef.current = nextItems;
                        return nextItems;
                    });
                    FRIENDS_SCREEN_CACHE.feedData = {
                        userId: user.id,
                        activityFeed: (FRIENDS_SCREEN_CACHE.feedData.activityFeed || [])
                            .filter((item) => !shouldHideFeedItem(item))
                            .map((item) => (
                                item?.sessionId
                                    ? {
                                        ...item,
                                        photoUrl: item.photoUrl || photoUrlMap.get(item.photoId) || item.photoUrl || null,
                                        likeCount: likeCountMap.get(item.sessionId) ?? item.likeCount ?? 0,
                                        likedByMe: likedSessionIds.has(item.sessionId) || item.likedByMe || false,
                                        commentCount: commentCountMap.get(item.sessionId) ?? item.commentCount ?? 0,
                                    }
                                    : item
                            )),
                        fetchedAt: FRIENDS_SCREEN_CACHE.feedData.fetchedAt,
                    };
                }).catch((error) => {
                    console.error("[feed] async enrichment failed", { error, currentUserId: user.id });
                });
            }
            debugTimeEnd("[feed] load total");
            return true;
        } catch (error) {
            console.error("[feed] RLS or Supabase error", {
                error,
                currentUserId: user?.id,
                friendIds: effectiveFriendIds,
                recentSevenStart,
                today,
            });
            console.error("[feed] fetch failed", {
                error,
                currentUserId: user?.id,
                friendIds: effectiveFriendIds,
                sessionsCount: 0,
                workoutsCount: 0,
                feedItemsLength: 0,
                displayedCardsCount: 0,
            });
            debugTimeEnd("[feed] load total");
            return false;
        } finally {
            setActivityFeedLoading(false);
            setFeedRefreshing(false);
        }
    }, [buildFeedItemFromHistoryDate, getDisplayUsername, hasOwnHistorySnapshot, history, ownDeletedWorkoutDateSet, recentSevenStart, resolveAcceptedFriendIds, shouldHideFeedItem, shouldHideOwnWorkoutDate, today, user?.id]);

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

    const handleCommentCountChange = useCallback((sessionId, nextCount) => {
        setActivityFeed((prev) => prev.map((item) => (
            item.sessionId === sessionId
                ? { ...item, commentCount: Number(nextCount || 0) }
                : item
        )));
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

            const response = await fetch("/api/workout-social?action=toggle-like", {
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
        if (!user || !showRankingSections) return;
        fetchFriendsData({ background: Boolean(FRIENDS_SCREEN_CACHE.friendsData.fetchedAt) });
    }, [user, fetchFriendsData, sessionSyncVersion, showRankingSections]);

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
        if (!user || !showFeedSections) return;
        const hasCachedFriends = FRIENDS_SCREEN_CACHE.friendsData.userId === user.id
            && Array.isArray(FRIENDS_SCREEN_CACHE.friendsData.friends)
            && FRIENDS_SCREEN_CACHE.friendsData.fetchedAt > 0;
        fetchFriendsData({
            background: hasCachedFriends,
        }).catch(console.error);
    }, [user, showFeedSections, fetchFriendsData]);

    useEffect(() => {
        if (!user || !showFeedSections) return;
        const visibleCachedItems = (FRIENDS_SCREEN_CACHE.feedData.activityFeed || []).filter((item) => !shouldHideFeedItem(item));
        FRIENDS_SCREEN_CACHE.feedData = {
            ...FRIENDS_SCREEN_CACHE.feedData,
            activityFeed: visibleCachedItems,
        };
        setActivityFeed((prev) => {
            const nextItems = prev.filter((item) => !shouldHideFeedItem(item));
            const stableItems = buildFeedItemsSignature(prev) === buildFeedItemsSignature(nextItems)
                ? prev
                : nextItems;
            activityFeedRef.current = stableItems;
            return stableItems;
        });
        const hasCachedFeed = FRIENDS_SCREEN_CACHE.feedData.userId === user.id
            && Array.isArray(FRIENDS_SCREEN_CACHE.feedData.activityFeed)
            && FRIENDS_SCREEN_CACHE.feedData.activityFeed.length > 0;
        fetchActivityFeed({
            reset: true,
            background: hasCachedFeed,
            force: true,
        }).catch(console.error);
    }, [user, fetchActivityFeed, showFeedSections, sessionSyncVersion, shouldHideFeedItem]);

    useEffect(() => {
        if (!user || !showFeedSections) return;
        if (!friendIds.length && visibleFriendDatesCount === 0) return;
        const cachedItems = FRIENDS_SCREEN_CACHE.feedData.userId === user.id
            ? (FRIENDS_SCREEN_CACHE.feedData.activityFeed || [])
            : [];
        const cachedFriendCount = cachedItems.filter((item) => item?.user_id && item.user_id !== user.id).length;
        if (cachedFriendCount >= visibleFriendDatesCount && visibleFriendDatesCount > 0) return;
        fetchActivityFeed({ reset: true, background: true, force: true }).catch(console.error);
    }, [user, showFeedSections, friendIds, visibleFriendDatesCount, fetchActivityFeed]);

    useEffect(() => {
        if (!user) return undefined;

        const refreshVisibleData = () => {
            if (showRankingSections) {
                fetchFriendsData({ background: true }).catch(console.error);
            }
            if (showFeedSections) {
                fetchActivityFeed({ reset: true, background: true }).catch(console.error);
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
    }, [user, fetchActivityFeed, fetchFriendsData, showFeedSections, showRankingSections]);

    useEffect(() => {
        if (!user) return undefined;
        const intervalId = setInterval(() => {
            fetchActivityFeed({ reset: true, background: true }).catch(console.error);
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
            avatarUrl,
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
                avatarUrl: friend.avatar1_url || null,
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
            avatarUrl,
        },
        ...friends.map((friend) => ({
            id: friend.id,
            name: getDisplayUsername(friend.username),
            isMe: false,
            value: Number(
                friendSessionInsights.recentSevenCountByUser?.[friend.id]
                ?? getValidWorkoutDatesFromHistory(friend.history, { since: recentSevenStart }).length
            ),
            avatarUrl: friend.avatar1_url || null,
        })),
    ].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ja"));

    const volumeRanking = [
        {
            id: user?.id || "me",
            name: getDisplayUsername(myUsername, { isMe: true }),
            isMe: true,
            value: computeVolumeFromHistoryForRange(history, volumePeriodRange),
            avatarUrl,
        },
        ...friends.map((friend) => ({
            id: friend.id,
            name: getDisplayUsername(friend.username),
            isMe: false,
            value: computeVolumeFromHistoryForRange(friend.history, volumePeriodRange),
            avatarUrl: friend.avatar1_url || null,
        })),
    ]
        .filter((entry) => entry.value !== null)
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ja"));

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
        debugLog("[ranking] current user id", user?.id);
        debugLog("[ranking] accepted friend ids", friendIds);
        debugLog("[ranking] self monthly sessions count", selfMonthlySessions?.length);
        debugLog("[ranking] friend monthly sessions raw", friendMonthlySessionsRaw);
        debugLog("[ranking] friend monthly sessions count by user", friendSessionCountByUser);
        debugLog("[ranking] visibility by user/date", friendSessionInsights.visibilityByUserDate || {});
        debugLog("[ranking] excluded monthly sessions", friendSessionInsights.excludedSessions || []);
        debugLog("[ranking] final ranking rows", volumeRanking);
        debugLog("[profile] viewed user id", user?.id);
        debugLog("[profile] current user id", user?.id);
        debugLog("[profile] accepted friend ids", friendIds);
        debugLog("[profile] self visible training days", selfMonthlySessions);
        debugLog("[profile] friend visible training days", friendSessionInsights.visibleDatesByUser || {});
        debugLog("[profile] missing dates for friend", friendSessionInsights.missingDates || {});
        debugLog("[profile] visibility by date", friendSessionInsights.visibilityByUserDate || {});
        debugLog("[profile] workout_sessions by date", friendSessionInsights.sessionsByDate || {});
        debugLog("[profile] workouts by date", friendSessionInsights.workoutsByDate || {});
        debugLog("[profile] valid sets by date", friendSessionInsights.validSetsByDate || {});
    }, [
        countMonthlyWorkoutDays,
        computeVolumeFromHistoryForRange,
        friendIds,
        friendSessionInsights,
        friends,
        volumeRanking,
        volumePeriodRange,
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
            label: "Volume",
            emptyValue: "0kg",
            unit: "kg",
            description: `${volumePeriodRange.label}のVolumeランキング`,
            data: volumeRanking,
            detailLabel: () => `${volumePeriodRange.label}の総重量`,
            metricLabel: (entry) => `${entry.value.toLocaleString("ja-JP")}kg`,
            mySummary: (rankIndex, myEntry, aboveEntry) => {
                if (!myEntry) return null;
                if (rankIndex === 0) {
                    return {
                        headline: "あなたは 1位",
                        metric: `${myEntry.value.toLocaleString("ja-JP")}kg`,
                        note: myEntry.value > 0 ? `${volumePeriodRange.label}トップです` : `まだ${volumePeriodRange.label}の記録はありません`,
                    };
                }
                return {
                    headline: `あなたは ${rankIndex + 1}位`,
                    metric: `${myEntry.value.toLocaleString("ja-JP")}kg`,
                    note: `${rankIndex}位まであと${Math.max(0, aboveEntry.value - myEntry.value).toLocaleString("ja-JP")}kg`,
                };
            },
        },
    };

    const activeRanking = rankingConfig[rankingTab];
    const myRankingIndex = activeRanking?.data.findIndex((entry) => entry.isMe) ?? -1;
    const myRankingEntry = myRankingIndex >= 0 ? activeRanking.data[myRankingIndex] : null;
    const aboveRankingEntry = myRankingIndex > 0 ? activeRanking.data[myRankingIndex - 1] : null;
    const myRankingSummary = activeRanking?.mySummary?.(myRankingIndex, myRankingEntry, aboveRankingEntry) || null;

    const visibleActivityFeed = useMemo(
        () => activityFeed.filter((item) => !shouldHideFeedItem(item)),
        [activityFeed, shouldHideFeedItem]
    );
    const activityCount = visibleActivityFeed.length;
    const shouldShowRankingLoading = loading && activeRanking.data.length === 0;
    const activeFriendCount = new Set(
        visibleActivityFeed
            .filter((item) => item.user_id !== user?.id)
            .map((item) => item.user_id)
            .filter(Boolean)
    ).size;
    const activityHeadline = `直近7日 ${activityCount}記録`;
    const feedEmptyState = {
        title: "まだアクティビティはありません",
        body: "ワークアウトを記録すると、ここに表示されます。友達を招待すると、お互いの記録も見られます。",
        action: "ワークアウトを記録",
        onClick: onOpenRecord,
    };

    const groupedActivityFeed = useMemo(() => {
        debugTime("[feed] build grouped");
        const userMap = new Map();
        const ownItemsCount = visibleActivityFeed.filter((item) => item?.user_id === user?.id).length;
        const friendItemsCount = visibleActivityFeed.filter((item) => item?.user_id && item.user_id !== user?.id).length;

        const ensureUserGroup = ({ userId, username, avatar1Url, profile }) => {
            if (!userId || userMap.has(userId)) return;
            const isMe = userId === user?.id;
            const displayName = isMe
                ? getDisplayUsername(myUsername, { isMe: true })
                : getDisplayUsername(username);
            const rawHandle = isMe
                ? (myUsername || "")
                : (username || displayName || "");

            userMap.set(userId, {
                userId,
                userName: displayName,
                handle: rawHandle ? `@${String(rawHandle).replace(/^@+/, "")}` : "",
                profile: profile || (avatar1Url ? { avatar1_url: avatar1Url } : null),
                latestDate: "",
                datesMap: new Map(),
            });
        };

        ensureUserGroup({
            userId: user?.id,
            username: myUsername,
            avatar1Url: avatarUrl,
            profile: avatarUrl ? { avatar1_url: avatarUrl, username: myUsername } : { username: myUsername },
        });

        friends.forEach((friend) => {
            ensureUserGroup({
                userId: friend?.id,
                username: friend?.username,
                avatar1Url: friend?.avatar1_url,
                profile: friend,
            });
        });

        visibleActivityFeed.forEach((item) => {
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
                    latestDate: dates[0]?.date || group.latestDate || "",
                    activityDayCount: dates.length,
                    dates,
                };
            })
            .sort((a, b) => {
                if (a.userId === user?.id && b.userId !== user?.id) return -1;
                if (b.userId === user?.id && a.userId !== user?.id) return 1;
                const aHasActivity = a.activityDayCount > 0;
                const bHasActivity = b.activityDayCount > 0;
                if (aHasActivity !== bHasActivity) return aHasActivity ? -1 : 1;
                const dateCompare = String(b.latestDate || "").localeCompare(String(a.latestDate || ""));
                if (dateCompare !== 0) return dateCompare;
                return String(a.userName || "").localeCompare(String(b.userName || ""));
            });
        debugLog("[feed grouped] source counts", {
            ownItemsCount,
            friendItemsCount,
            totalItemsCount: visibleActivityFeed.length,
            acceptedFriendIds: friendIds,
        });
        debugLog("[feed grouped] users", groupedUsers.map((u) => ({
            userId: u.userId,
            userName: u.userName,
            dateCount: u.dates.length,
            latestDate: u.latestDate,
        })));
        debugTimeEnd("[feed] build grouped");
        return groupedUsers;
    }, [avatarUrl, friendIds, friends, getDisplayUsername, myUsername, user?.id, visibleActivityFeed]);

    const profileInitial = getDisplayUsername(myUsername, { isMe: true })?.[0]?.toUpperCase() || "Y";
    const hasVisibleFeedUsers = groupedActivityFeed.length > 0;
    const rankedRankingData = activeRanking.data.filter((e) => e.value > 0);
    const unrankedRows = activeRanking.data.filter((e) => e.value === 0);
    const topThreeRanking = rankedRankingData.slice(0, 3);
    const podiumOrder = [topThreeRanking[1], topThreeRanking[0], topThreeRanking[2]].filter(Boolean);
    const compactRankingRows = rankingTab === "big3" ? rankedRankingData.slice(3) : rankedRankingData;

    const removeFriend = useCallback(async (friendId) => {
        if (!user?.id || !friendId) return false;
        const { error } = await supabase
            .from("friendships")
            .delete()
            .or(
                `and(requester_id.eq.${user.id},receiver_id.eq.${friendId}),and(requester_id.eq.${friendId},receiver_id.eq.${user.id})`
            );
        if (error) {
            console.error("[friends] removeFriend failed", error);
            return false;
        }
        setFriendIds((prev) => prev.filter((id) => id !== friendId));
        setFriends((prev) => prev.filter((f) => f.id !== friendId));
        FRIENDS_SCREEN_CACHE.friendsData = {
            ...FRIENDS_SCREEN_CACHE.friendsData,
            friendIds: (FRIENDS_SCREEN_CACHE.friendsData.friendIds || []).filter((id) => id !== friendId),
            friends: (FRIENDS_SCREEN_CACHE.friendsData.friends || []).filter((f) => f.id !== friendId),
        };
        return true;
    }, [user?.id]);

    return {
        // State
        friends,
        friendIds,
        avatarUrl,
        setAvatarUrl,
        loading,
        friendsRefreshing,
        myUsername,
        setMyUsername,
        activityFeed,
        activityFeedLoading,
        feedRefreshing,
        activityFeedAction,
        activityFeedStatusMessage,
        likePendingMap,
        friendSessionInsights,
        // Computed date values
        today,
        currentMonthPrefix,
        recentSevenStart,
        // Functions
        fetchFriendsData,
        fetchActivityFeed,
        handleRefreshActivityFeed,
        handleCommentCountChange,
        handleToggleSessionLike,
        formatSessionSetDisplay,
        getDisplayUsername,
        showActivityFeedStatusMessage,
        removeFriend,
        // Computed/derived data
        visibleActivityFeed,
        groupedActivityFeed,
        activityCount,
        activeFriendCount,
        activityHeadline,
        feedEmptyState,
        profileInitial,
        hasVisibleFeedUsers,
        // Ranking data
        rankingConfig,
        activeRanking,
        myRankingSummary,
        shouldShowRankingLoading,
        topThreeRanking,
        podiumOrder,
        compactRankingRows,
        unrankedRows,
        volumePeriodRange,
    };
}
