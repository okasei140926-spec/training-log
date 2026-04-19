import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { S } from "../utils/styles";
import { calc1RM } from "../utils/helpers";
import FriendDetailModal from "./modals/FriendDetailModal";



const KEY_EXERCISES = ["ベンチプレス", "デッドリフト", "スクワット"];

export default function FriendsScreen({ history, onCopyMenu, user, onLogin, onLogout }) {

    const [selectedFriend, setSelectedFriend] = useState(null);
    const [openDates, setOpenDates] = useState({});
    const [copied, setCopied] = useState(false);
    // eslint-disable-next-line no-unused-vars
    const [friends, setFriends] = useState([]);
    const [showEditName, setShowEditName] = useState(false);
    const [newUsername, setNewUsername] = useState("");


    const handleCopyInvite = async () => {
        const url = `${window.location.origin}?ref=${user.id}`;
        const text = "一緒にトレーニングを記録しよう！ IRON LOG";
        if (navigator.share) {
            try {
                await navigator.share({ title: "IRON LOG", text, url });
                return;
            } catch { }
        }
        try {
            await navigator.clipboard.writeText(url);
        } catch {
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

    useEffect(() => {
        if (!user) return;
        const fetchFriends = async () => {
            try {
                const { data: friendships, error: e1 } = await supabase
                    .from("friendships")
                    .select("requester_id, receiver_id")
                    .eq("status", "accepted")
                    .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`);

                console.log("friendships:", friendships, e1);

                if (!friendships || friendships.length === 0) {
                    setFriends([]);
                    return;
                }

                const friendIds = friendships.map(f =>
                    f.requester_id === user.id ? f.receiver_id : f.requester_id
                );

                const { data: profiles, error: e2 } = await supabase
                    .from("profiles")
                    .select("id, username")
                    .in("id", friendIds);

                console.log("profiles:", profiles, e2);

                const friendsWithHistory = await Promise.all((profiles || []).map(async p => {
                    const { data: workouts } = await supabase
                        .from("workouts")
                        .select("data")
                        .eq("user_id", p.id)
                        .maybeSingle();
                    return { ...p, history: workouts?.data || {} };
                }));

                setFriends(friendsWithHistory);
            } catch (err) {
                console.error("fetchFriends error:", err);
                setFriends([]);
            }
        };


        fetchFriends();
    }, [user]);



    if (!user) {
        return (
            <div style={{ padding: 32, textAlign: "center" }}>
                <p style={{ marginBottom: 24 }}>Friends機能を使うにはログインが必要です</p>
                <button
                    onClick={onLogin}
                    style={{ padding: "12px 32px", borderRadius: 8, background: "#4ade80", border: "none", fontWeight: 700, fontSize: 16 }}
                >
                    ログイン / 新規登録
                </button>
            </div>
        );
    }



    const today = new Date().toISOString().split("T")[0];
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - 7);
    const thresholdStr = thresholdDate.toISOString().split("T")[0];

    const myRecentExercises = Object.entries(history)
        .filter(([, recs]) => recs[recs.length - 1]?.date >= thresholdStr)
        .map(([name, recs]) => {
            const last = recs[recs.length - 1];
            const topSet = last.sets?.reduce((best, s) => Number(s.weight) > Number(best.weight) ? s : best, last.sets[0]);
            return { name, weight: topSet?.weight || last.weight, reps: topSet?.reps || last.reps, date: last.date };
        })
        .sort((a, b) => b.date.localeCompare(a.date));

    const myTodayExercises = myRecentExercises.filter(e => e.date === today);

    const activeRecently = myRecentExercises.length > 0;

    const myBests = KEY_EXERCISES.reduce((acc, ex) => {
        const recs = history[ex];
        if (recs?.length) acc[ex] = Math.round(calc1RM(recs[recs.length - 1].sets));
        return acc;
    }, {});

    const activeToday = myTodayExercises.length > 0;

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

            {/* 自分のカード */}
            <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: "1px solid var(--border2)", position: "relative" }}>
                <button onClick={() => setShowEditName(true)} style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 4 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: activeRecently ? 14 : 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 22, background: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "var(--bg)", flexShrink: 0 }}>
                        YOU
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>自分</div>
                            {activeToday && (
                                <div style={{ padding: "2px 8px", borderRadius: 10, background: "#4ade8022", border: "1px solid #4ade8044", fontSize: 10, color: "#4ade80", fontWeight: 700 }}>
                                    完了 ✓
                                </div>
                            )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
                            {activeRecently ? `直近7日 ${myRecentExercises.length}種目` : "直近7日の記録なし"}
                        </div>
                    </div>
                </div>
                {activeRecently && (() => {
                    const byDate = {};
                    myRecentExercises.forEach(ex => {
                        if (!byDate[ex.date]) byDate[ex.date] = [];
                        byDate[ex.date].push(ex);
                    });
                    return Object.entries(byDate)
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([date, exs]) => {
                            const isOpen = openDates[date] === true;
                            return (
                                <div key={date} style={{ marginBottom: 6 }}>
                                    <button onClick={() => setOpenDates(p => ({ ...p, [date]: !isOpen }))}
                                        style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "var(--border)", borderRadius: 8, border: "none", marginBottom: 4 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)" }}>{date === today ? "今日" : date}</div>
                                        <div style={{ fontSize: 11, color: "var(--text3)" }}>{isOpen ? "▲" : "▼"}</div>
                                    </button>
                                    {isOpen && exs.map((ex, i) => (
                                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--card2)", borderRadius: 10, marginBottom: 4 }}>
                                            <div style={{ fontSize: 13, color: "var(--text3)" }}>{ex.name}</div>
                                            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                                                {ex.weight === "BW" ? "自重" : `${ex.weight}kg`} × {ex.reps}rep
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        });
                })()}
            </div>

            {friends.length === 0 ? (
                <div style={{ textAlign: "center", padding: 32, color: "var(--text2)", fontSize: 14 }}>
                    まだ友達がいません。招待リンクを送ろう！
                </div>
            ) : (
                friends.map(f => {
                    const friendHistory = f.history || {};
                    const today = new Date().toISOString().split("T")[0];
                    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

                    // 直近7日の日付リスト
                    const recentDates = Object.entries(friendHistory)
                        .flatMap(([exName, recs]) => recs.map(r => ({ date: r.date, exName, ...r })))
                        .filter(r => r.date >= sevenDaysAgo)
                        .reduce((acc, r) => {
                            if (!acc[r.date]) acc[r.date] = [];
                            acc[r.date].push(r);
                            return acc;
                        }, {});

                    const sortedDates = Object.keys(recentDates).sort((a, b) => b.localeCompare(a));
                    const totalExercises = Object.values(recentDates).flat().length;

                    return (
                        <div key={f.id} style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: "1px solid var(--border2)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: sortedDates.length ? 14 : 0 }}>
                                <div style={{ width: 44, height: 44, borderRadius: 22, background: "#4ade80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#000", flexShrink: 0 }}>
                                    {f.username?.[0]?.toUpperCase()}
                                </div>
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>@{f.username}</div>
                                    <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>直近7日 {totalExercises}種目</div>
                                </div>
                            </div>
                            {sortedDates.map(date => {
                                const isOpen = openDates[`${f.id}-${date}`] === true;
                                const exs = recentDates[date];
                                return (
                                    <div key={date} style={{ marginBottom: 6 }}>
                                        <button onClick={() => setOpenDates(p => ({ ...p, [`${f.id}-${date}`]: !isOpen }))}
                                            style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "var(--border)", borderRadius: 8, border: "none", marginBottom: 4 }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)" }}>{date === today ? "今日" : date}</div>
                                            <div style={{ fontSize: 11, color: "var(--text3)" }}>{isOpen ? "▲" : "▼"}</div>
                                        </button>
                                        {isOpen && exs.map((ex, i) => (
                                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--card2)", borderRadius: 10, marginBottom: 4 }}>
                                                <div style={{ fontSize: 13, color: "var(--text3)" }}>{ex.exName}</div>
                                                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                                                    {ex.weight === "BW" ? "自重" : `${ex.weight}kg`} × {ex.reps}rep
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                            {sortedDates.length === 0 && (
                                <div style={{ fontSize: 12, color: "var(--text3)" }}>直近7日間の記録なし</div>
                            )}
                        </div>
                    );
                })

            )}

            < div style={{ ...S.sLabel, marginTop: 20 }}>強さ比較（推定1RM）</div>
            {
                KEY_EXERCISES.map(ex => {
                    const entries = [
                        { name: "自分", color: "var(--text)", value: myBests[ex] || 0 },
                        ...friends.map(f => ({ name: f.username, color: "#4ade80", value: 0 })),
                    ].filter(e => e.value > 0);
                    if (!entries.length) return null;
                    const maxVal = Math.max(...entries.map(e => e.value));
                    return (
                        <div key={ex} style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 10, border: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: "var(--text)" }}>{ex}</div>
                            {entries.sort((a, b) => b.value - a.value).map((e, i) => (
                                <CompareBar key={e.name} rank={i + 1} name={e.name} value={e.value} max={maxVal} color={e.color} />
                            ))}
                            {!myBests[ex] && (
                                <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 8 }}>この種目を記録すると比較できます</div>
                            )}
                        </div>
                    );
                })
            }

            <div style={{ background: "var(--card)", borderRadius: 16, padding: "20px", border: "1px dashed var(--border2)", textAlign: "center", marginTop: 8 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>👥</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>友達を招待</div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>一緒にトレーニングを記録しよう</div>
                <button onClick={handleCopyInvite}
                    style={{ padding: "10px 28px", borderRadius: 20, background: copied ? "#4ade80" : "var(--text)", color: copied ? "#000" : "var(--bg)", fontWeight: 700, fontSize: 13, border: "none", transition: "background 0.2s" }}>
                    {copied ? "コピーしました ✓" : "招待リンクをコピー 🔗"}
                </button>
            </div>


            {showEditName && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#00000066", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
                    <div style={{ background: "var(--card)", borderRadius: 16, padding: 24, width: "100%" }}>
                        <h3 style={{ marginBottom: 16, color: "var(--text)" }}>ユーザー名を変更</h3>
                        <input
                            placeholder="新しいユーザー名"
                            value={newUsername}
                            onChange={e => setNewUsername(e.target.value)}
                            style={{ display: "block", width: "100%", padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border2)", background: "var(--card2)", color: "var(--text)", fontSize: 15, boxSizing: "border-box", marginBottom: 12 }}
                        />
                        <button onClick={async () => {
                            if (!newUsername.trim()) return;
                            await supabase.from("profiles").update({ username: newUsername }).eq("id", user.id);
                            setShowEditName(false);
                            setNewUsername("");
                        }} style={{ width: "100%", padding: 14, borderRadius: 10, background: "#4ade80", border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 8 }}>
                            保存
                        </button>
                        <button onClick={() => { setShowEditName(false); setNewUsername(""); }} style={{ width: "100%", padding: 14, borderRadius: 10, background: "none", border: "1px solid var(--border2)", fontSize: 15, cursor: "pointer", color: "var(--text2)" }}>
                            キャンセル
                        </button>
                    </div>
                </div>
            )}


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
                    <div style={{ fontSize: 10, color: rank === 1 ? "#FFD700" : "var(--text3)", fontWeight: 800, width: 14 }}>
                        {rank === 1 ? "👑" : `${rank}`}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text3)" }}>{name}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color }}>{value}kg</div>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: "var(--border)" }}>
                <div style={{ height: "100%", borderRadius: 4, background: color, width: `${pct}%`, transition: "width 0.5s ease" }} />
            </div>
        </div>
    );
}
