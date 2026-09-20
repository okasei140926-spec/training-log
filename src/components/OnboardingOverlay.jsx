import { useState, useCallback } from "react";
import { save } from "../utils/helpers";
import { supabase } from "../utils/supabase";
import { SUGGESTIONS, QUICK_LABELS } from "../constants/suggestions";
import { applyOnboardingPlan, SPLIT_TYPE_DESCRIPTIONS } from "../utils/generateOnboardingPlan";

// ─── Question definitions ─────────────────────────────────────────────────────
// Ported to type="birthdate" (replaces age) and type="text" (name added at end)

const QUESTIONS = [
    {
        id: "goal",
        title: "何のために鍛える？",
        type: "single",
        options: [
            { label: "💪 体づくり・見た目改善", value: "体づくり" },
            { label: "🏆 筋力アップ",           value: "筋力アップ" },
            { label: "🔄 継続習慣・健康維持",   value: "継続習慣" },
            { label: "🔥 ダイエット・減量",      value: "ダイエット" },
        ],
    },
    {
        id: "level",
        title: "経験レベルは？",
        type: "single",
        options: [
            { label: "🌱 初心者（1年未満）", value: "初心者" },
            { label: "⚡ 中級者（1〜3年）",  value: "中級者" },
            { label: "🔥 上級者（3年以上）", value: "上級者" },
        ],
    },
    {
        id: "frequency",
        title: "週に何回来れる？",
        subtitle: "トレーニングできる回数を選んでね",
        type: "frequency",
    },
    {
        id: "trainingYears",
        title: "筋トレ歴は？",
        type: "single",
        options: [
            { label: "1年未満", value: "1年未満" },
            { label: "1〜3年",  value: "1〜3年" },
            { label: "3〜5年",  value: "3〜5年" },
            { label: "5年以上", value: "5年以上" },
        ],
    },
    {
        id: "preferredSplit",
        title: "普段の分割は？",
        subtitle: "AIプランの組み方に反映されます",
        type: "single",
        showIf: (a) => a.level !== "初心者" || (!!a.trainingYears && a.trainingYears !== "1年未満"),
        options: [
            { label: "🔺 上半身 / 下半身",            value: "upper_lower", desc: SPLIT_TYPE_DESCRIPTIONS.upper_lower },
            { label: "🔄 Push / Pull / Legs",         value: "ppl",         desc: SPLIT_TYPE_DESCRIPTIONS.ppl },
            { label: "📍 部位別分割（胸の日・背中の日…）", value: "body_part",   desc: SPLIT_TYPE_DESCRIPTIONS.body_part },
            { label: "💪 アーノルド分割",              value: "arnold",      desc: SPLIT_TYPE_DESCRIPTIONS.arnold },
            { label: "🌱 全身法",                      value: "fullbody",    desc: SPLIT_TYPE_DESCRIPTIONS.fullbody },
            { label: "🤷 特に決めてない",              value: "none",        desc: SPLIT_TYPE_DESCRIPTIONS.none },
            { label: "✏️ 自分でカスタム", value: "custom", pauseAdvance: true,
              desc: "各日に鍛える部位を自分で決めるオリジナル分割です。設定画面からいつでも自由に組み直せます。" },
        ],
    },
    {
        id: "location",
        title: "どこで鍛える？",
        type: "single",
        options: [
            { label: "🏋️ ジム", value: "ジム" },
            { label: "🏠 自宅", value: "自宅" },
        ],
    },
    {
        id: "hasDumbbells",
        title: "ダンベルはある？",
        type: "single",
        showIf: (a) => a.location === "自宅",
        options: [
            { label: "✅ ある（ダンベルあり）", value: "ある" },
            { label: "🤸 なし（自重のみ）",     value: "なし" },
        ],
    },
    {
        id: "birthdate",
        title: "生年月日を教えてください",
        subtitle: "強度ランクなどの機能に使用します",
        type: "birthdate",
    },
    {
        id: "bodyWeight",
        title: "体重を教えてください",
        subtitle: "部位別の強さランクの計算に使います（スキップ可）",
        type: "bodyweight_input",
    },
    {
        id: "gender",
        title: "性別を教えてください",
        subtitle: "強さランクの基準値に使います（スキップ可）",
        type: "single",
        skippable: true,
        options: [
            { label: "男性", value: "男性" },
            { label: "女性", value: "女性" },
        ],
    },
    {
        id: "favorites",
        title: "好きな種目を選ぼう",
        subtitle: "初回プランに優先的に組み込まれます（スキップ可）",
        type: "favorites",
    },
    {
        id: "aiPlanPreference",
        title: "AIプランを提案してほしい？",
        subtitle: "記録画面に次のメニューを表示します。後から設定で変更できます",
        type: "single",
        options: [
            { label: "提案してほしい", value: "yes" },
            { label: "自分で組みたい", value: "no" },
        ],
    },
    {
        id: "name",
        title: "なんて呼べばいい？",
        subtitle: "プロフィールに表示されます",
        type: "text",
        placeholder: "お名前",
    },
];

// ─── Supabase profile save (best-effort) ─────────────────────────────────────

async function saveProfileToSupabase(userId, answers) {
    if (!userId) return;
    try {
        const { error } = await supabase.from("profiles").upsert(
            {
                id: userId,
                display_name: answers.name?.trim() || null,
                gender: answers.gender || null,
                birth_date: answers.birthdate || null,   // "YYYY-MM-DD"
                fitness_goal: answers.goal || null,
                fitness_level: answers.level || null,
                workout_frequency: answers.frequency
                    ? parseInt(answers.frequency, 10) : null,
                training_years: answers.trainingYears || null,
                workout_location: answers.location || null,
                has_dumbbells:
                    answers.location === "自宅"
                        ? answers.hasDumbbells === "ある"
                        : null,
                ai_plan_enabled: answers.aiPlanPreference !== "no",
                preferred_split: answers.preferredSplit && answers.preferredSplit !== "none"
                    ? answers.preferredSplit : null,
                body_weight_kg: answers.bodyWeight
                    ? (Number(answers.bodyWeight) || null) : null,
                weight_updated_at: answers.bodyWeight
                    ? new Date().toISOString() : null,
                onboarding_completed_at: new Date().toISOString(),
            },
            { onConflict: "id" }
        );
        if (error) throw error;
    } catch (err) {
        // Silently ignore — columns may not exist yet (run the migration SQL first)
        console.warn("[onboarding] Supabase profile save failed:", err?.message);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBirthDateString(year, month, day) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (!y || !m || !d) return null;
    const str = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const date = new Date(str);
    if (isNaN(date.getTime())) return null;
    return str;
}

function validateBirthDate(year, month, day) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (!y || !m || !d) return "年・月・日をすべて入力してください";
    if (y < 1920 || y > new Date().getFullYear() - 5) return "正しい年を入力してください";
    if (m < 1 || m > 12) return "正しい月を入力してください（1〜12）";
    if (d < 1 || d > 31) return "正しい日を入力してください（1〜31）";
    const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    if (isNaN(date.getTime())) return "正しい日付を入力してください";
    if (date >= new Date()) return "生年月日は今日より前の日付を入力してください";
    return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingOverlay({ user, onDone }) {
    // Welcome screen state
    const [showWelcome, setShowWelcome] = useState(true);

    // Question flow state
    const [answers, setAnswers] = useState({});
    const [stepIndex, setStepIndex] = useState(0);
    const [visible, setVisible] = useState(true);

    // Birthdate input state
    const [bdYear, setBdYear] = useState("");
    const [bdMonth, setBdMonth] = useState("");
    const [bdDay, setBdDay] = useState("");
    const [bdError, setBdError] = useState("");

    // Favorites state
    const [favSearch, setFavSearch] = useState("");
    const [favBodyPart, setFavBodyPart] = useState("すべて");
    const [selectedFavs, setSelectedFavs] = useState([]);

    // Body weight input state
    const [bwInput, setBwInput] = useState("");

    // Name input state
    const [nameInput, setNameInput] = useState("");

    // Completion state
    const [completing, setCompleting] = useState(false);

    // When a "pauseAdvance" option is selected, pause before goNext
    const [pendingValue, setPendingValue] = useState(null);

    // Which option's description is currently expanded (value string or null)
    const [expandedDesc, setExpandedDesc] = useState(null);

    // Active questions (filter conditional ones)
    const activeQuestions = QUESTIONS.filter(q => !q.showIf || q.showIf(answers));
    const totalSteps = activeQuestions.length;
    const currentQ = activeQuestions[stepIndex] || {};
    const progress = (stepIndex + 1) / totalSteps;

    // ── Navigation ─────────────────────────────────────────────────────────────

    const transition = useCallback((fn) => {
        setVisible(false);
        setTimeout(() => { fn(); setVisible(true); }, 160);
    }, []);

    const goNext = useCallback((newAnswers) => {
        setPendingValue(null);
        setExpandedDesc(null);
        transition(() => {
            setAnswers(newAnswers);
            setStepIndex(i => i + 1);
        });
    }, [transition]);

    const goBack = useCallback(() => {
        if (stepIndex === 0) return;
        transition(() => setStepIndex(i => i - 1));
    }, [stepIndex, transition]);

    // ── Answer handlers ────────────────────────────────────────────────────────

    const handleSingle = useCallback((value) => {
        goNext({ ...answers, [currentQ.id]: value });
    }, [answers, currentQ.id, goNext]);

    const handleFrequency = useCallback((value) => {
        goNext({ ...answers, frequency: value });
    }, [answers, goNext]);

    const handleBirthdateSubmit = useCallback(() => {
        const err = validateBirthDate(bdYear, bdMonth, bdDay);
        if (err) { setBdError(err); return; }
        setBdError("");
        const dateStr = buildBirthDateString(bdYear, bdMonth, bdDay);
        goNext({ ...answers, birthdate: dateStr });
    }, [bdYear, bdMonth, bdDay, answers, goNext]);

    const handleFavAdvance = useCallback((skip = false) => {
        const favs = skip ? [] : selectedFavs;
        goNext({ ...answers, favorites: favs });
    }, [answers, selectedFavs, goNext]);

    const handleFavToggle = useCallback((name, bodyPart) => {
        setSelectedFavs(prev => {
            const exists = prev.some(f => f.name === name);
            return exists
                ? prev.filter(f => f.name !== name)
                : [...prev, { name, bodyPart }];
        });
    }, []);

    const handleComplete = useCallback(async () => {
        if (completing) return;
        setCompleting(true);
        const finalAnswers = {
            ...answers,
            name: nameInput.trim() || null,
        };
        save("onboardingAnswers", finalAnswers);
        applyOnboardingPlan(finalAnswers);
        // Save ai_plan_enabled preference to localStorage immediately
        save("aiPlanEnabled", finalAnswers.aiPlanPreference !== "no");
        void saveProfileToSupabase(user?.id, finalAnswers);
        save("onboardingProfileDone", true);
        save("onboardingDone", true);
        onDone();
    }, [completing, answers, nameInput, user, onDone]);

    // ── Favorites data ─────────────────────────────────────────────────────────

    const allExercises = [];
    QUICK_LABELS.forEach(bp => {
        (SUGGESTIONS[bp] || []).forEach(name => allExercises.push({ name, bodyPart: bp }));
    });
    const filteredExercises = allExercises.filter(ex => {
        const matchBp = favBodyPart === "すべて" || ex.bodyPart === favBodyPart;
        const matchSearch = !favSearch || ex.name.includes(favSearch);
        return matchBp && matchSearch;
    });

    // ── Shared styles ──────────────────────────────────────────────────────────

    const rootStyle = {
        position: "fixed", inset: 0,
        background: "var(--bg)",
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'Helvetica Neue', sans-serif",
    };

    const accentBtn = {
        background: "linear-gradient(135deg, var(--accent), var(--accent2))",
        border: "none",
        borderRadius: 16,
        padding: "18px",
        color: "#fff",
        fontSize: 16,
        fontWeight: 900,
        cursor: "pointer",
        width: "100%",
    };

    // ── Welcome screen ─────────────────────────────────────────────────────────

    if (showWelcome) {
        return (
            <div style={rootStyle}>
                <div style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "40px 28px calc(40px + env(safe-area-inset-bottom, 0px))",
                    textAlign: "center",
                }}>
                    <div style={{
                        fontSize: 52, marginBottom: 20, lineHeight: 1,
                    }}>
                        💪
                    </div>
                    <div style={{
                        fontSize: 28, fontWeight: 900,
                        color: "var(--text)", marginBottom: 12,
                        letterSpacing: -0.5,
                    }}>
                        PUMPへようこそ
                    </div>
                    <div style={{
                        fontSize: 16, color: "var(--text2)",
                        lineHeight: 1.7, marginBottom: 48,
                    }}>
                        いくつか質問させてください。{"\n"}
                        回答をもとに最初のトレーニングプランを{"\n"}
                        自動で作成します。
                    </div>
                    <button
                        onClick={() => setShowWelcome(false)}
                        style={{
                            ...accentBtn,
                            maxWidth: 320,
                            fontSize: 17,
                            padding: "20px 32px",
                        }}
                    >
                        はじめる →
                    </button>
                </div>
            </div>
        );
    }

    // ── Question flow ──────────────────────────────────────────────────────────

    return (
        <div style={rootStyle}>
            {/* Header: back + progress bar */}
            <div style={{
                padding: "calc(16px + env(safe-area-inset-top, 0px)) 20px 12px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexShrink: 0,
            }}>
                <button
                    onClick={stepIndex === 0 ? () => setShowWelcome(true) : goBack}
                    style={{
                        background: "none", border: "none",
                        color: "var(--text2)",
                        fontSize: 22, padding: "4px 8px",
                        cursor: "pointer",
                        lineHeight: 1,
                    }}
                >
                    ‹
                </button>

                <div style={{ flex: 1 }}>
                    <div style={{
                        height: 4, borderRadius: 2,
                        background: "var(--border2)",
                        overflow: "hidden",
                    }}>
                        <div style={{
                            height: "100%",
                            width: `${progress * 100}%`,
                            background: "linear-gradient(90deg, var(--accent), var(--accent2))",
                            borderRadius: 2,
                            transition: "width 0.35s ease",
                        }} />
                    </div>
                    <div style={{
                        fontSize: 11, color: "var(--text3)",
                        marginTop: 4, textAlign: "right",
                    }}>
                        {stepIndex + 1} / {totalSteps}
                    </div>
                </div>
            </div>

            {/* Question content */}
            <div style={{
                flex: 1, overflowY: "auto",
                padding: "20px 20px 40px",
                display: "flex",
                flexDirection: "column",
                opacity: visible ? 1 : 0,
                transition: "opacity 0.16s ease",
            }}>
                <div style={{
                    fontSize: 24, fontWeight: 900,
                    color: "var(--text)", marginBottom: 8, lineHeight: 1.3,
                }}>
                    {currentQ.title}
                </div>
                {currentQ.subtitle && (
                    <div style={{
                        fontSize: 14, color: "var(--text3)", marginBottom: 28,
                    }}>
                        {currentQ.subtitle}
                    </div>
                )}
                {!currentQ.subtitle && <div style={{ marginBottom: 28 }} />}

                {/* ── single choice ── */}
                {currentQ.type === "single" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {(currentQ.options || []).map(opt => {
                            const selected = (pendingValue ?? answers[currentQ.id]) === opt.value;
                            const descOpen = expandedDesc === opt.value;
                            const hasDesc = Boolean(opt.desc);
                            return (
                                <div key={opt.value}>
                                    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                                        {/* Main option button */}
                                        <button
                                            onClick={() => {
                                                setExpandedDesc(null);
                                                if (opt.pauseAdvance) {
                                                    setPendingValue(opt.value);
                                                } else {
                                                    setPendingValue(null);
                                                    handleSingle(opt.value);
                                                }
                                            }}
                                            style={{
                                                flex: 1,
                                                background: selected
                                                    ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                                                    : "var(--card)",
                                                border: selected
                                                    ? "1px solid var(--accent)"
                                                    : "1px solid rgba(18,199,194,0.12)",
                                                borderRadius: hasDesc ? "16px 0 0 16px" : 16,
                                                padding: "16px 18px",
                                                color: selected ? "#fff" : "var(--text)",
                                                fontSize: 15,
                                                fontWeight: 700,
                                                textAlign: "left",
                                                cursor: "pointer",
                                                boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
                                                transition: "background 0.15s, border-color 0.15s",
                                            }}
                                        >
                                            {opt.label}
                                        </button>

                                        {/* ? button (only if desc exists) */}
                                        {hasDesc && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setExpandedDesc(descOpen ? null : opt.value);
                                                }}
                                                style={{
                                                    flexShrink: 0,
                                                    width: 44,
                                                    background: descOpen
                                                        ? "rgba(18,199,194,0.18)"
                                                        : selected
                                                            ? "rgba(255,255,255,0.15)"
                                                            : "var(--card2)",
                                                    border: selected
                                                        ? "1px solid var(--accent)"
                                                        : "1px solid rgba(18,199,194,0.12)",
                                                    borderLeft: "none",
                                                    borderRadius: "0 16px 16px 0",
                                                    color: descOpen ? "var(--accent)" : "var(--text3)",
                                                    fontSize: 16,
                                                    fontWeight: 900,
                                                    cursor: "pointer",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
                                                    transition: "background 0.15s",
                                                }}
                                                aria-label="詳しく見る"
                                            >
                                                ?
                                            </button>
                                        )}
                                    </div>

                                    {/* Inline description */}
                                    {descOpen && opt.desc && (
                                        <div style={{
                                            marginTop: 6,
                                            padding: "12px 14px",
                                            background: "rgba(18,199,194,0.06)",
                                            borderRadius: 12,
                                            border: "1px solid rgba(18,199,194,0.16)",
                                            fontSize: 13,
                                            color: "var(--text2)",
                                            lineHeight: 1.7,
                                        }}>
                                            {opt.desc}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* スキップボタン（skippable: true の質問のみ） */}
                        {currentQ.skippable && (
                            <button
                                onClick={() => goNext({ ...answers })}
                                style={{
                                    marginTop: 4,
                                    padding: "13px",
                                    borderRadius: 14,
                                    border: "1px solid rgba(18,199,194,0.15)",
                                    background: "transparent",
                                    color: "var(--text3)",
                                    fontSize: 14,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    width: "100%",
                                }}
                            >
                                スキップ →
                            </button>
                        )}

                        {/* Info text + 次へ button when a pauseAdvance option is selected */}
                        {pendingValue !== null && (
                            <>
                                <div style={{
                                    marginTop: 4,
                                    padding: "12px 16px",
                                    background: "rgba(18,199,194,0.08)",
                                    borderRadius: 14,
                                    border: "1px solid rgba(18,199,194,0.2)",
                                    fontSize: 13,
                                    color: "var(--text2)",
                                    lineHeight: 1.65,
                                }}>
                                    分割の詳細（各日の部位）は、設定画面からいつでも自由に組めます。まずはこのまま進んでOKです。
                                </div>
                                <button
                                    onClick={() => goNext({ ...answers, [currentQ.id]: pendingValue })}
                                    style={{ ...accentBtn, marginTop: 4 }}
                                >
                                    この設定で進む →
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* ── frequency 1-7 ── */}
                {currentQ.type === "frequency" && (
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                        gap: 10,
                    }}>
                        {[1, 2, 3, 4, 5, 6, 7].map(n => {
                            const selected = answers.frequency === n;
                            return (
                                <button
                                    key={n}
                                    onClick={() => handleFrequency(n)}
                                    style={{
                                        background: selected
                                            ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                                            : "var(--card)",
                                        border: selected
                                            ? "1px solid var(--accent)"
                                            : "1px solid rgba(18,199,194,0.12)",
                                        borderRadius: 16,
                                        padding: "22px 8px",
                                        color: selected ? "#fff" : "var(--text)",
                                        fontSize: 22,
                                        fontWeight: 900,
                                        cursor: "pointer",
                                        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
                                    }}
                                >
                                    {n}
                                </button>
                            );
                        })}
                        <div style={{
                            display: "flex", alignItems: "center",
                            justifyContent: "center",
                            fontSize: 13, color: "var(--text3)", fontWeight: 600,
                        }}>
                            回/週
                        </div>
                    </div>
                )}

                {/* ── birthdate: year / month / day inputs ── */}
                {currentQ.type === "birthdate" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            {/* Year */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 2 }}>
                                <label style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, letterSpacing: 1 }}>
                                    年
                                </label>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    value={bdYear}
                                    onChange={e => { setBdYear(e.target.value); setBdError(""); }}
                                    placeholder="1995"
                                    maxLength={4}
                                    style={bdInputStyle(!!bdError)}
                                    autoFocus
                                />
                            </div>
                            {/* Month */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                                <label style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, letterSpacing: 1 }}>
                                    月
                                </label>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    value={bdMonth}
                                    onChange={e => { setBdMonth(e.target.value); setBdError(""); }}
                                    placeholder="4"
                                    min={1} max={12}
                                    style={bdInputStyle(!!bdError)}
                                />
                            </div>
                            {/* Day */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                                <label style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, letterSpacing: 1 }}>
                                    日
                                </label>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    value={bdDay}
                                    onChange={e => { setBdDay(e.target.value); setBdError(""); }}
                                    placeholder="1"
                                    min={1} max={31}
                                    style={bdInputStyle(!!bdError)}
                                    onKeyDown={e => e.key === "Enter" && handleBirthdateSubmit()}
                                />
                            </div>
                        </div>
                        {bdError && (
                            <div style={{ fontSize: 13, color: "#FF4D4D" }}>{bdError}</div>
                        )}
                        <button
                            onClick={handleBirthdateSubmit}
                            style={{ ...accentBtn, marginTop: 8 }}
                        >
                            次へ →
                        </button>
                    </div>
                )}

                {/* ── body weight input (skippable) ── */}
                {currentQ.type === "bodyweight_input" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <input
                                type="number"
                                inputMode="decimal"
                                value={bwInput}
                                onChange={e => setBwInput(e.target.value)}
                                placeholder="70"
                                style={{
                                    flex: 1,
                                    background: "var(--input-bg, var(--card))",
                                    border: "1px solid var(--border)",
                                    borderRadius: 14,
                                    padding: "16px 18px",
                                    fontSize: 24,
                                    fontWeight: 800,
                                    color: "var(--text)",
                                    outline: "none",
                                    textAlign: "right",
                                }}
                                onKeyDown={e => {
                                    if (e.key === "Enter") {
                                        const kg = Number(bwInput);
                                        if (kg > 0) goNext({ ...answers, bodyWeight: String(kg) });
                                    }
                                }}
                                autoFocus
                            />
                            <span style={{ fontSize: 20, fontWeight: 800, color: "var(--text2)" }}>kg</span>
                        </div>
                        <button
                            onClick={() => {
                                const kg = Number(bwInput);
                                if (kg > 0) goNext({ ...answers, bodyWeight: String(kg) });
                                else goNext({ ...answers, bodyWeight: null });
                            }}
                            style={{ ...accentBtn, marginTop: 4 }}
                        >
                            {bwInput && Number(bwInput) > 0 ? "次へ →" : "スキップ →"}
                        </button>
                    </div>
                )}

                {/* ── favorites multi-select ── */}
                {currentQ.type === "favorites" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <input
                            type="text"
                            value={favSearch}
                            onChange={e => setFavSearch(e.target.value)}
                            placeholder="種目を検索..."
                            style={{
                                background: "var(--card)",
                                border: "1px solid rgba(18,199,194,0.15)",
                                borderRadius: 12,
                                padding: "12px 16px",
                                color: "var(--text)",
                                fontSize: 15,
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                        />

                        <div style={{
                            display: "flex", gap: 8,
                            overflowX: "auto", paddingBottom: 4,
                        }}>
                            {["すべて", ...QUICK_LABELS].map(bp => (
                                <button
                                    key={bp}
                                    onClick={() => setFavBodyPart(bp)}
                                    style={{
                                        flexShrink: 0,
                                        background: favBodyPart === bp ? "var(--accent)" : "var(--card)",
                                        border: "none",
                                        borderRadius: 20,
                                        padding: "6px 14px",
                                        color: favBodyPart === bp ? "#fff" : "var(--text2)",
                                        fontSize: 12,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    {bp}
                                </button>
                            ))}
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {filteredExercises.map(ex => {
                                const selected = selectedFavs.some(f => f.name === ex.name);
                                return (
                                    <button
                                        key={ex.name}
                                        onClick={() => handleFavToggle(ex.name, ex.bodyPart)}
                                        style={{
                                            background: selected
                                                ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                                                : "var(--card)",
                                            border: selected
                                                ? "1px solid var(--accent)"
                                                : "1px solid rgba(18,199,194,0.1)",
                                            borderRadius: 20,
                                            padding: "8px 14px",
                                            color: selected ? "#fff" : "var(--text)",
                                            fontSize: 13,
                                            fontWeight: 600,
                                            cursor: "pointer",
                                        }}
                                    >
                                        {selected ? "✓ " : ""}{ex.name}
                                    </button>
                                );
                            })}
                        </div>

                        {selectedFavs.length > 0 && (
                            <div style={{
                                fontSize: 13, color: "var(--accent)",
                                fontWeight: 700, marginTop: 4,
                            }}>
                                {selectedFavs.length}種目を選択中
                            </div>
                        )}

                        <button
                            onClick={() => handleFavAdvance(false)}
                            style={{ ...accentBtn, marginTop: 12 }}
                        >
                            次へ →
                        </button>
                        <button
                            onClick={() => handleFavAdvance(true)}
                            style={{
                                background: "transparent", border: "none",
                                color: "var(--text3)", fontSize: 14,
                                padding: "10px", cursor: "pointer",
                            }}
                        >
                            スキップ
                        </button>
                    </div>
                )}

                {/* ── name text input (final step) ── */}
                {currentQ.type === "text" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <input
                            type="text"
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value.slice(0, 30))}
                            onKeyDown={e => e.key === "Enter" && handleComplete()}
                            placeholder={currentQ.placeholder}
                            autoFocus
                            style={{
                                background: "var(--card)",
                                border: "1px solid rgba(18,199,194,0.2)",
                                borderRadius: 16,
                                padding: "18px 20px",
                                color: "var(--text)",
                                fontSize: 22,
                                fontWeight: 700,
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                        />
                        <button
                            onClick={handleComplete}
                            disabled={completing}
                            style={{
                                ...accentBtn,
                                marginTop: 8,
                                opacity: completing ? 0.7 : 1,
                                cursor: completing ? "default" : "pointer",
                            }}
                        >
                            {completing ? "プランを生成中..." : "PUMPをはじめる 🚀"}
                        </button>
                        {!completing && (
                            <button
                                onClick={handleComplete}
                                style={{
                                    background: "transparent", border: "none",
                                    color: "var(--text3)", fontSize: 14,
                                    padding: "10px", cursor: "pointer",
                                }}
                            >
                                スキップ
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Input style helper ───────────────────────────────────────────────────────

function bdInputStyle(hasError) {
    return {
        background: "var(--card)",
        border: hasError
            ? "1px solid #FF4D4D"
            : "1px solid rgba(18,199,194,0.2)",
        borderRadius: 14,
        padding: "16px 12px",
        color: "var(--text)",
        fontSize: 20,
        fontWeight: 700,
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
        textAlign: "center",
    };
}
