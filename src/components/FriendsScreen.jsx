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
    const [friends, setFriends] = useState([]);
    const [showEditName, setShowEditName] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [avatarUrl, setAvatarUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [kudos, setKudos] = useState({});
    const [receivedKudos, setReceivedKudos] = useState([]);
    const [myUsername, setMyUsername] = useState("");



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
                    setFriends([]);
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
                        .select("user_id, data")
                        .in("user_id", friendIds),
                ]);

                const { data: profiles, error: profilesError } = profilesRes;
                const { data: workouts, error: workoutsError } = workoutsRes;

                if (profilesError) throw profilesError;
                if (workoutsError) throw workoutsError;

                const historyMap = new Map(
                    (workouts || []).map(w => [w.user_id, w.data || {}])
                );

                const friendsWithHistory = (profiles || []).map(p => ({
                    ...p,
                    history: historyMap.get(p.id) || {}
                }));

                setFriends(friendsWithHistory);
                setLoading(false);
            } catch (err) {
                console.error(err);
                setFriends([]);
                setLoading(false);
            }
        };

        fetchFriends();
    }, [user]);

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
            console.log("received kudos:", received);
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


    if (!user) {
        return (
            <div style={{ padding: 32, textAlign: "center" }}>
                <p style={{ marginBottom: 24 }}>Friends機能を使うにはログインが必要です</p>
                <button onClick={onLogin} style={{ padding: "12px 32px", borderRadius: 8, background: "#4ade80", border: "none", fontWeight: 700, fontSize: 16 }}>
                    ログイン / 新規登録
                </button>
            </div>
        );
    }

    const today = new Date().toISOString().split("T")[0];
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - 7);
    const thresholdStr = thresholdDate.toISOString().split("T")[0];

    // 自分の直近データ
    const myRecentGrouped = Object.entries(history || {})
        .flatMap(([name, recs]) => recs.map(r => ({ name, date: r.date, sets: r.sets, order: r.order ?? 999 })))
        .filter(r => r.date >= thresholdStr)
        .reduce((acc, r) => {
            if (!acc[r.date]) acc[r.date] = {};
            if (!acc[r.date][r.name]) acc[r.date][r.name] = { sets: [], order: r.order ?? 999 };
            acc[r.date][r.name].sets.push(...(r.sets || []));
            return acc;
        }, {});

    const myRecentDates = Object.keys(myRecentGrouped).sort((a, b) => b.localeCompare(a));
    const activeRecently = myRecentDates.length > 0;
    const activeToday = myRecentDates.includes(today);
    const myTotalExCount = new Set(
        Object.values(myRecentGrouped).flatMap(d => Object.keys(d))
    ).size;

    const myBests = KEY_EXERCISES.reduce((acc, ex) => {
        const recs = history[ex];
        if (recs?.length) {
            const best = Math.max(...recs.map(r => Math.round(calc1RM(r.sets))));
            acc[ex] = best;
        }
        return acc;
    }, {});


    const renderDateAccordion = (id, date, exMap) => {
        const dateKey = `${id}-${date}`;
        const isOpen = openDates[dateKey] === true;
        return (
            <div key={date} style={{ marginBottom: 6 }}>
                <button onClick={() => setOpenDates(p => ({ ...p, [dateKey]: !isOpen }))}
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "var(--border)", borderRadius: 8, border: "none", marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)" }}>{date === today ? "今日" : date}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>{isOpen ? "▲" : "▼"}</div>
                </button>
                {isOpen && Object.entries(exMap)
                    .sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999))
                    .map(([name, val]) => {
                        const sets = Array.isArray(val) ? val : (val.sets || []);
                        return (
                            <div key={name} style={{ background: "var(--card2)", borderRadius: 10, padding: "8px 12px", marginBottom: 4 }}>
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

            {receivedKudos.length > 0 && (
                <div style={{ background: "#4ade8022", border: "1px solid #4ade8044", borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "var(--text)" }}>
                    🔥 {receivedKudos.map(k => k.profiles?.username).join("、")}から今日クドスをもらった！
                </div>
            )}


            {/* 自分のカード */}
            <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: "1px solid var(--border2)", position: "relative" }}>
                <button onClick={() => setShowEditName(true)} style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 4 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: activeRecently ? 14 : 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 22, background: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "var(--bg)", flexShrink: 0, overflow: "hidden", cursor: "pointer", position: "relative" }}
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
                                const { error: uploadError } = await supabase.storage.from("avatars1").upload(path, file, { upsert: true });
                                console.log("upload error:", uploadError);
                                const { data: { publicUrl } } = supabase.storage.from("avatars1").getPublicUrl(path);
                                console.log("publicUrl:", publicUrl);
                                await supabase.from("profiles").update({ avatar1_url: publicUrl }).eq("id", user.id);
                                setAvatarUrl(publicUrl);
                            }}

                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{myUsername || "自分"}</div>
                            {activeToday && <div style={{ padding: "2px 8px", borderRadius: 10, background: "#4ade8022", border: "1px solid #4ade8044", fontSize: 10, color: "#4ade80", fontWeight: 700 }}>完了 ✓</div>}
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
                friends.map(f => {
                    const friendHistory = f.history || {};
                    const friendGrouped = Object.entries(friendHistory)
                        .flatMap(([name, recs]) => recs.map(r => ({ name, date: r.date, sets: r.sets })))
                        .filter(r => r.date >= thresholdStr)
                        .reduce((acc, r) => {
                            if (!acc[r.date]) acc[r.date] = {};
                            if (!acc[r.date][r.name]) acc[r.date][r.name] = [];
                            acc[r.date][r.name].push(...(r.sets || []));
                            return acc;
                        }, {});
                    const friendDates = Object.keys(friendGrouped).sort((a, b) => b.localeCompare(a));
                    const friendExCount = new Set(Object.values(friendGrouped).flatMap(d => Object.keys(d))).size;

                    return (
                        <div key={f.id} style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: "1px solid var(--border2)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: friendDates.length ? 14 : 0 }}>
                                <div style={{ width: 44, height: 44, borderRadius: 22, background: "#4ade80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#000", flexShrink: 0, overflow: "hidden" }}>
                                    {f.avatar1_url
                                        ? <img src={f.avatar1_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        : f.username?.[0]?.toUpperCase()
                                    }
                                </div>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>@{f.username}</div>
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
                        { name: "自分", color: "var(--text)", value: myBests[ex] || 0 },
                        ...friends.map(f => {
                            const recs = f.history?.[ex];
                            const value = recs?.length ? Math.max(...recs.map(r => Math.round(calc1RM(r.sets)))) : 0;
                            return { name: f.username, color: "#4ade80", value };
                        }),
                    ].filter(e => e.value > 0);
                    if (!entries.length) return null;
                    const maxVal = Math.max(...entries.map(e => e.value));
                    return (
                        <div key={ex} style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 10, border: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: "var(--text)" }}>{ex}</div>
                            {entries.sort((a, b) => b.value - a.value).map((e, i) => (
                                <CompareBar key={e.name} rank={i + 1} name={e.name} value={e.value} max={maxVal} color={e.color} />
                            ))}
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

            {
                showEditName && (
                    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#00000066", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
                        <div style={{ background: "var(--card)", borderRadius: 16, padding: 24, width: "100%" }}>
                            <h3 style={{ marginBottom: 16, color: "var(--text)" }}>ユーザー名を変更</h3>
                            <input placeholder="新しいユーザー名" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                                style={{ display: "block", width: "100%", padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border2)", background: "var(--card2)", color: "var(--text)", fontSize: 15, boxSizing: "border-box", marginBottom: 12 }} />
                            <button onClick={async () => {
                                if (!newUsername.trim()) return;
                                await supabase.from("profiles").update({ username: newUsername }).eq("id", user.id);
                                setMyUsername(newUsername);
                                setShowEditName(false);
                                setNewUsername("");
                            }} style={{ width: "100%", padding: 14, borderRadius: 10, background: "#4ade80", border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 8 }}>保存</button>
                            <button onClick={() => { setShowEditName(false); setNewUsername(""); }}
                                style={{ width: "100%", padding: 14, borderRadius: 10, background: "none", border: "1px solid var(--border2)", fontSize: 15, cursor: "pointer", color: "var(--text2)" }}>キャンセル</button>
                        </div>
                    </div>
                )
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
            <div style={{ height: 6, borderRadius: 4, background: "var(--border)" }}>
                <div style={{ height: "100%", borderRadius: 4, background: color, width: `${pct}%`, transition: "width 0.5s ease" }} />
            </div>
        </div>
    );
}
