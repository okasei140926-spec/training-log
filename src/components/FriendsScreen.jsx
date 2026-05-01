import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { S } from "../utils/styles";
import { getBig3ExerciseKey } from "../utils/exerciseName";
import { buildHistoryFromWorkoutRows, calc1RM, getRecordSourceSets, sanitizeWorkoutSets } from "../utils/helpers";
import FriendDetailModal from "./modals/FriendDetailModal";
import MonthlyWorkoutRankingCard from "./friends/MonthlyWorkoutRankingCard";
import Big3RankingCard from "./friends/Big3RankingCard";
import Big3OvertakeAlerts from "./friends/Big3OvertakeAlerts";
import EditUsernameModal from "./friends/EditUsernameModal";
import InviteCard from "./friends/InviteCard";
import NotificationSettings from "./NotificationSettings";

const KEY_EXERCISES = ["ベンチプレス", "デッドリフト", "スクワット"];
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

export default function FriendsScreen({ history, manualBests = [], onCopyMenu, user, onLogin, onLogout }) {
    const [selectedFriend, setSelectedFriend] = useState(null);
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
    const today = new Date().toISOString().split("T")[0];
    const currentMonthPrefix = today.slice(0, 7);
    const big3SeenStorageKey = "friends_big3_overtake_seen_v1";
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - 7);
    const thresholdStr = thresholdDate.toISOString().split("T")[0];

    const hasValidSet = useCallback((set) => {
        if (!set) return false;
        const repsNum = Number(set.reps);
        const hasValidWeight =
            set.weight === "BW" ||
            (set.weight !== "" && set.weight !== null && set.weight !== undefined && Number.isFinite(Number(set.weight)));
        return hasValidWeight && Number.isFinite(repsNum) && repsNum >= 1;
    }, []);

    const hasTodayWorkoutRecord = useCallback((workoutData) => {
        return Object.values(workoutData || {}).some((records) =>
            (records || []).some((record) => {
                if (!record || record.date !== today) return false;
                return sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight: true })
                    .some(hasValidSet);
            })
        );
    }, [hasValidSet, today]);

    const countMonthlyWorkoutDays = useCallback((rows) => {
        return new Set(
            (rows || [])
                .map((row) => row?.date)
                .filter((date) => typeof date === "string" && date.startsWith(currentMonthPrefix))
        ).size;
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

    const computeBig3FromWorkoutRows = useCallback((rows) => {
        return computeBig3FromHistory(buildHistoryFromWorkoutRows(rows));
    }, [computeBig3FromHistory]);

    const buildRecentGrouped = useCallback((historyData) => {
        return Object.entries(historyData || {})
            .flatMap(([name, recs]) =>
                (recs || []).map((record) => {
                    const sets = sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight: true });
                    if (!record?.date || !sets.length) return null;

                    return {
                        name,
                        date: record.date,
                        sets,
                        order: Number.isFinite(Number(record.order)) ? Number(record.order) : 999,
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
        const text = "一緒にトレーニングを記録しよう！ IRON LOG";
        if (navigator.share) {
            try { await navigator.share({ title: "IRON LOG", text, url }); return; } catch { }
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

    useEffect(() => {
        if (!user) return;

        const fetchFriends = async () => {
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
                    return;
                }

                const friendIds = [...new Set(
                    friendships.map(f =>
                        f.requester_id === user.id ? f.receiver_id : f.requester_id
                    )
                )];

                const [profilesRes, workoutsRes] = await Promise.all([
                    supabase
                        .from("profiles")
                        .select("id, username, avatar1_url")
                        .in("id", friendIds),

                    supabase
                        .from("workouts")
                        .select("user_id, date, data")
                        .in("user_id", friendIds)
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

                const friendsWithHistory = (profiles || []).map(p => ({
                    ...p,
                    workoutRows: workoutRowsMap.get(p.id) || [],
                    history: buildHistoryFromWorkoutRows(workoutRowsMap.get(p.id) || []),
                }));

                setFriendIds(friendIds);
                setFriends(friendsWithHistory);
                await fetchTodayActive(friendIds);
            } catch (err) {
                console.error(err);
                setFriendIds([]);
                setFriends([]);
                setTodayActiveMap({});
            } finally {
                setLoading(false);
            }
        };

        fetchFriends();
    }, [user, fetchTodayActive]);

    useEffect(() => {
        if (!user || !friendIds.length) return;

        const intervalId = setInterval(() => {
            fetchTodayActive(friendIds).catch(console.error);
        }, 60000);

        return () => clearInterval(intervalId);
    }, [user, friendIds, fetchTodayActive]);

    useEffect(() => {
        if (!user) return;
        const fetchKudos = async () => {
            const today = new Date().toISOString().split("T")[0];

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

    const myBests = KEY_EXERCISES.reduce((acc, ex) => {
        const recs = history[ex];
        if (recs?.length) {
            const best = Math.max(...recs.map(r => Math.round(safeCalc1RM(
                Array.isArray(r.sets) && r.sets.length > 0
                    ? r.sets
                    : [{ weight: r.weight, reps: r.reps }]
            ))));
            acc[ex] = best;
        }
        return acc;
    }, {});

    const todayActiveFriends = friends.filter((f) => todayActiveMap[f.id]);
    const todayActiveLabel = todayActiveFriends.map((f) => getDisplayUsername(f.username)).join("、");
    const myMonthlyWorkoutDays = new Set(
        Object.values(history || {})
            .flatMap((recs) => (recs || []).map((record) => record?.date))
            .filter((date) => typeof date === "string" && date.startsWith(currentMonthPrefix))
    ).size;
    const monthlyWorkoutRanking = [
        { name: getDisplayUsername(myUsername, { isMe: true }), isMe: true, days: myMonthlyWorkoutDays },
        ...friends.map((friend) => ({
            name: getDisplayUsername(friend.username),
            isMe: false,
            days: countMonthlyWorkoutDays(friend.workoutRows),
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
            ...computeBig3FromWorkoutRows(friend.workoutRows),
        })),
    ].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));
    const myBig3ByExercise = {
        bench: myBig3.bench || 0,
        squat: myBig3.squat || 0,
        deadlift: myBig3.deadlift || 0,
    };
    const big3OvertakeEvents = friends.flatMap((friend) => {
        const friendBig3 = computeBig3FromWorkoutRows(friend.workoutRows);

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
            <div style={{ padding: 32, textAlign: "center" }}>
                <p style={{ marginBottom: 24 }}>Friends機能を使うにはログインが必要です</p>
                <button onClick={onLogin} style={{ padding: "12px 32px", borderRadius: 14, background: "linear-gradient(135deg, var(--accent), #4ADE80)", color: "#fff", border: "1px solid transparent", fontWeight: 700, fontSize: 16, boxShadow: "var(--shadow-soft)" }}>
                    ログイン / 新規登録
                </button>
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
        <div className="fade-in" style={{ padding: "20px" }}>
            {user && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                    <button onClick={onLogout} style={{ background: "none", border: "1px solid var(--border2)", borderRadius: 8, padding: "6px 12px", fontSize: 13, color: "var(--text2)", cursor: "pointer" }}>
                        ログアウト
                    </button>
                </div>
            )}

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

            <Big3RankingCard ranking={big3Ranking} />


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
                                            const today = new Date().toISOString().split("T")[0];
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

            < div style={{ ...S.sLabel, marginTop: 20 }}>強さ比較（推定1RM）</div>
            {
                KEY_EXERCISES.map(ex => {
                    const entries = [
                        { name: getDisplayUsername(myUsername, { isMe: true }), color: "var(--text)", value: myBests[ex] || 0 },
                        ...friends.map(f => {
                            const recs = f.history?.[ex];
                            const value = recs?.length ? Math.max(...recs.map(r => Math.round(safeCalc1RM(
                                Array.isArray(r.sets) && r.sets.length > 0
                                    ? r.sets
                                    : [{ weight: r.weight, reps: r.reps }]
                            )))) : 0;
                            return { name: getDisplayUsername(f.username), color: "#4ade80", value };
                        }),
                    ].filter(e => e.value > 0);
                    if (!entries.length) return null;
                    const maxVal = Math.max(...entries.map(e => e.value));
                    return (
                        <div key={ex} style={{ background: "var(--card)", borderRadius: 20, padding: "16px", marginBottom: 10, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: "var(--text)" }}>{ex}</div>
                            {entries.sort((a, b) => b.value - a.value).map((e, i) => (
                                <CompareBar key={e.name} rank={i + 1} name={e.name} value={e.value} max={maxVal} color={e.color} />
                            ))}
                        </div>
                    );
                })
            }

            <InviteCard copied={copied} onCopyInvite={handleCopyInvite} />

            <NotificationSettings user={user} />

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

            {
                selectedFriend && (
                    <FriendDetailModal
                        friend={selectedFriend}
                        onClose={() => setSelectedFriend(null)}
                        onCopyMenu={(exercises) => { onCopyMenu(exercises); setSelectedFriend(null); }}
                    />
                )
            }
        </div >
    );
}

function CompareBar({ rank, name, value, max, color }) {
    const pct = Math.round((value / max) * 100);
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ fontSize: 10, color: rank === 1 ? "#FFD700" : "var(--text3)", fontWeight: 800, width: 14 }}>{rank === 1 ? "👑" : `${rank}`}</div>
                    <div style={{ fontSize: 13, color: "var(--text3)" }}>{name}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color }}>{value}kg</div>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--info-soft)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, background: color, width: `${pct}%`, transition: "width 0.5s ease" }} />
            </div>
        </div>
    );
}
