import { useMemo, useState } from "react";
import { SCORE_CATEGORIES, calcStrengthRanks, calcGrowthSummary } from "../utils/strengthScore";
import { BILLING_ENABLED } from "../constants/features";

// ── Radar Chart ───────────────────────────────────────────────────────────────

const RADAR_AXIS_LABELS = ["胸", "背中", "脚", "肩", "腕"];
const RADAR_SIZE = 200;
const RADAR_CX = RADAR_SIZE / 2;
const RADAR_CY = RADAR_SIZE / 2;
const RADAR_R  = 78;

function radarPoint(value, axisIndex, max = 100) {
    const angle = (axisIndex * 2 * Math.PI) / 5 - Math.PI / 2;
    const r = RADAR_R * (Math.min(value, max) / max);
    return {
        x: RADAR_CX + r * Math.cos(angle),
        y: RADAR_CY + r * Math.sin(angle),
    };
}

function labelPoint(axisIndex) {
    const angle = (axisIndex * 2 * Math.PI) / 5 - Math.PI / 2;
    const r = RADAR_R + 18;
    return {
        x: RADAR_CX + r * Math.cos(angle),
        y: RADAR_CY + r * Math.sin(angle),
    };
}

function gridPolygon(fraction) {
    return RADAR_AXIS_LABELS.map((_, i) => {
        const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const r = RADAR_R * fraction;
        return `${RADAR_CX + r * Math.cos(angle)},${RADAR_CY + r * Math.sin(angle)}`;
    }).join(" ");
}

function RadarChart({ values }) {
    const dataPoints = values.map((v, i) => radarPoint(v, i));
    const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

    return (
        <svg
            width={RADAR_SIZE}
            height={RADAR_SIZE}
            viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
            style={{ overflow: "visible" }}
        >
            {/* Grid rings */}
            {[0.25, 0.5, 0.75, 1.0].map((frac) => (
                <polygon
                    key={frac}
                    points={gridPolygon(frac)}
                    fill="none"
                    stroke="rgba(18,199,194,0.15)"
                    strokeWidth={1}
                />
            ))}
            {/* Axis lines */}
            {RADAR_AXIS_LABELS.map((_, i) => {
                const tip = radarPoint(100, i);
                return (
                    <line
                        key={i}
                        x1={RADAR_CX} y1={RADAR_CY}
                        x2={tip.x} y2={tip.y}
                        stroke="rgba(18,199,194,0.15)"
                        strokeWidth={1}
                    />
                );
            })}
            {/* Data polygon */}
            <polygon
                points={dataPolygon}
                fill="rgba(18,199,194,0.18)"
                stroke="rgba(18,199,194,0.8)"
                strokeWidth={1.5}
                strokeLinejoin="round"
            />
            {/* Data dots */}
            {dataPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="var(--accent)" />
            ))}
            {/* Axis labels */}
            {RADAR_AXIS_LABELS.map((label, i) => {
                const lp = labelPoint(i);
                return (
                    <text
                        key={i}
                        x={lp.x}
                        y={lp.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="11"
                        fontWeight="700"
                        fill="var(--text2)"
                    >
                        {label}
                    </text>
                );
            })}
        </svg>
    );
}

// ── Rank badge ────────────────────────────────────────────────────────────────

const RANK_COLORS = {
    "未計測": "#888",
    "初級":   "#a0a0b0",
    "中級":   "#4a9eff",
    "上級":   "#12C7C2",
    "エリート": "#FACC15",
    "レジェンド": "#FF7A35",
};

function RankBadge({ label }) {
    const color = RANK_COLORS[label] || "#888";
    return (
        <span style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 10px",
            borderRadius: 999,
            background: `${color}22`,
            border: `1px solid ${color}55`,
            color,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.3,
        }}>
            {label}
        </span>
    );
}

// ── Body weight inline input ──────────────────────────────────────────────────

function BodyWeightInput({ initial = "", initialGender = null, onSave, onCancel }) {
    const [val, setVal] = useState(String(initial || ""));
    const [genderSel, setGenderSel] = useState(initialGender);

    const handleSave = () => {
        const n = Number(val);
        if (n > 0) onSave(n, genderSel);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%" }}>
            {/* Weight row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                    type="number"
                    inputMode="decimal"
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    placeholder="70"
                    autoFocus
                    style={{
                        width: 80,
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid var(--accent)",
                        background: "var(--card2)",
                        color: "var(--text)",
                        fontSize: 18,
                        fontWeight: 800,
                        textAlign: "right",
                        outline: "none",
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleSave();
                        if (e.key === "Escape") onCancel();
                    }}
                />
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text2)" }}>kg</span>
                <button
                    onClick={handleSave}
                    style={{
                        padding: "8px 14px",
                        borderRadius: 10,
                        border: "none",
                        background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                    }}
                >
                    保存
                </button>
                <button
                    onClick={onCancel}
                    style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "none",
                        color: "var(--text3)",
                        fontSize: 13,
                        cursor: "pointer",
                    }}
                >
                    ×
                </button>
            </div>
            {/* Gender chips */}
            <div style={{ display: "flex", gap: 8 }}>
                {["男性", "女性"].map((g) => {
                    const sel = genderSel === g;
                    return (
                        <button
                            key={g}
                            onClick={() => setGenderSel(sel ? null : g)}
                            style={{
                                padding: "6px 18px",
                                borderRadius: 999,
                                border: sel ? "none" : "1px solid var(--border2)",
                                background: sel
                                    ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                                    : "var(--card2)",
                                color: sel ? "#fff" : "var(--text2)",
                                fontSize: 13,
                                fontWeight: 800,
                                cursor: "pointer",
                            }}
                        >
                            {g}
                        </button>
                    );
                })}
                {genderSel && (
                    <span style={{ fontSize: 11, color: "var(--text3)", alignSelf: "center" }}>
                        ランク計算に使用
                    </span>
                )}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GrowthScreen({
    history,
    muscleEx,
    exerciseBodyPartOverrides,
    bodyWeightKg,
    bodyWeightUpdatedAt,
    onSaveBodyWeight,
    onSaveGender,
    gender,
    customEquipmentMap,
    prData,
    isPro = false,
    onAskWhyStagnant,
    billingEnabled = false,
    onOpenPaywall,
}) {
    const [editingWeight, setEditingWeight] = useState(false);
    const [proCardDismissed, setProCardDismissed] = useState(() => {
        try {
            const val = localStorage.getItem("growth_pro_card_dismissed_until");
            return val ? Date.now() < Number(val) : false;
        } catch { return false; }
    });

    const genderNorm = gender === "女性" ? "female" : "male";

    const strengthResult = useMemo(() =>
        calcStrengthRanks(
            history,
            muscleEx,
            exerciseBodyPartOverrides,
            bodyWeightKg,
            genderNorm,
            customEquipmentMap,
        ),
    [history, muscleEx, exerciseBodyPartOverrides, bodyWeightKg, genderNorm, customEquipmentMap]);

    const { growing, stagnating } = useMemo(() =>
        calcGrowthSummary(prData?.allItemsSortedByDate),
    [prData]);

    const hasBodyWeight = bodyWeightKg != null && bodyWeightKg > 0;

    // Body weight "N日前" display
    const bwDaysAgo = useMemo(() => {
        if (!bodyWeightUpdatedAt) return null;
        const ms = Date.now() - new Date(bodyWeightUpdatedAt).getTime();
        const days = Math.floor(ms / 86400000);
        if (days === 0) return "今日";
        return `${days}日前`;
    }, [bodyWeightUpdatedAt]);

    const cardStyle = {
        background: "var(--card)",
        borderRadius: 20,
        padding: "16px 16px",
        border: "1px solid rgba(18,199,194,0.10)",
        boxShadow: "var(--shadow-card)",
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* ── Radar + type + body weight ── */}
            <div style={cardStyle}>
                {hasBodyWeight ? (
                    <>
                        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                            <RadarChart values={strengthResult.radarValues} />
                        </div>
                        {strengthResult.typeLabel && (
                            <div style={{ textAlign: "center", fontSize: 13, fontWeight: 800, color: "var(--accent)", marginBottom: 6 }}>
                                {strengthResult.typeLabel}
                            </div>
                        )}
                    </>
                ) : (
                    <div style={{ textAlign: "center", padding: "16px 8px" }}>
                        <div style={{ fontSize: 28, marginBottom: 10 }}>⚖️</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>
                            体重を入れるとランクが出る
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>
                            部位ごとの強さを体重比で計算します
                        </div>
                        {!editingWeight && (
                            <button
                                onClick={() => setEditingWeight(true)}
                                style={{
                                    padding: "12px 24px",
                                    borderRadius: 14,
                                    border: "none",
                                    background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                                    color: "#fff",
                                    fontSize: 14,
                                    fontWeight: 800,
                                    cursor: "pointer",
                                }}
                            >
                                体重を入力する
                            </button>
                        )}
                    </div>
                )}

                {/* Body weight display / edit */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: hasBodyWeight ? 4 : 0 }}>
                    {editingWeight ? (
                        <BodyWeightInput
                            initial={bodyWeightKg}
                            initialGender={gender}
                            onSave={(kg, newGender) => {
                                onSaveBodyWeight?.(kg);
                                if (newGender && newGender !== gender) onSaveGender?.(newGender);
                                setEditingWeight(false);
                            }}
                            onCancel={() => setEditingWeight(false)}
                        />
                    ) : hasBodyWeight ? (
                        <>
                            <button
                                onClick={() => setEditingWeight(true)}
                                style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 8 }}
                            >
                                <span style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600 }}>
                                    体重 {bodyWeightKg}kg{bwDaysAgo ? `・${bwDaysAgo}` : ""}
                                </span>
                                <span style={{ fontSize: 10, color: "var(--accent)", marginLeft: 5 }}>更新</span>
                            </button>
                            {/* Gender hint when not set */}
                            {!gender && (
                                <button
                                    onClick={() => setEditingWeight(true)}
                                    style={{
                                        background: "none",
                                        border: "1px dashed rgba(18,199,194,0.35)",
                                        borderRadius: 999,
                                        padding: "4px 12px",
                                        cursor: "pointer",
                                        color: "var(--accent)",
                                        fontSize: 11,
                                        fontWeight: 800,
                                    }}
                                >
                                    性別を設定すると正確なランクが出る →
                                </button>
                            )}
                        </>
                    ) : null}
                </div>
            </div>

            {/* ── Rank cards ── */}
            <div style={cardStyle}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text2)", marginBottom: 12, letterSpacing: 0.3 }}>部位別ランク</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {SCORE_CATEGORIES.map((cat) => {
                        const catData = strengthResult.categories[cat];
                        const { rankLabel, nextThresholdKg, radarValue, hasData, topExercises, rankIndex } = catData || {};
                        const progressPct = rankIndex === 4 ? 100 : Math.min(100, radarValue || 0);

                        return (
                            <div key={cat}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{cat}</span>
                                        <RankBadge label={rankLabel || "未計測"} />
                                    </div>
                                    {hasData && rankIndex === 4 ? (
                                        <span style={{ fontSize: 11, color: "#FF7A35", fontWeight: 700 }}>
                                            ✦ 最高ランク到達
                                        </span>
                                    ) : hasData && nextThresholdKg != null ? (
                                        <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>
                                            次まで あと{nextThresholdKg}kg
                                        </span>
                                    ) : null}
                                </div>
                                {/* Progress bar */}
                                <div style={{ height: 6, borderRadius: 999, background: "rgba(18,199,194,0.10)", overflow: "hidden" }}>
                                    <div style={{
                                        height: "100%",
                                        width: `${progressPct}%`,
                                        borderRadius: 999,
                                        background: rankIndex === 4
                                            ? "linear-gradient(90deg, var(--accent), #FF7A35)"
                                            : "linear-gradient(90deg, var(--accent), #0F5E63)",
                                        boxShadow: rankIndex === 4 ? "0 0 8px rgba(255,122,53,0.5)" : "none",
                                        transition: "width 0.6s ease",
                                    }} />
                                </div>
                                {hasData && topExercises?.length > 0 && (
                                    <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 4 }}>
                                        {topExercises.map((e) => e.name).join(" / ")}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                {!hasBodyWeight && (
                    <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 10, textAlign: "center" }}>
                        体重を入力するとランクが表示されます
                    </div>
                )}
            </div>

            {/* ── Growth / Stagnation ── */}
            {(growing.length > 0 || stagnating.length > 0) && (
                <div style={cardStyle}>
                    {growing.length > 0 && (
                        <div style={{ marginBottom: stagnating.length > 0 ? 16 : 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#22c55e", marginBottom: 10 }}>📈 伸びてる種目</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {growing.map((item) => (
                                    <div key={item.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{item.displayName || item.name}</span>
                                        <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>PR更新 ✓</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {stagnating.length > 0 && (
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#f97316", marginBottom: 10 }}>🔶 止まってる種目</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                {stagnating.map((item) => {
                                    const canAsk = !BILLING_ENABLED || isPro;
                                    return (
                                        <div key={item.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{item.displayName || item.name}</div>
                                                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>{item.stagnationWeeks}週間更新なし</div>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    if (!canAsk) {
                                                        if (billingEnabled) onOpenPaywall?.("stagnation");
                                                        return;
                                                    }
                                                    const exName = item.displayName || item.name;
                                                    const exRecords = (
                                                        history?.[exName] ||
                                                        history?.[item.name] ||
                                                        []
                                                    )
                                                        .slice()
                                                        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                                                        .slice(0, 8);
                                                    onAskWhyStagnant?.(exName, exRecords);
                                                }}
                                                style={{
                                                    padding: "7px 12px",
                                                    borderRadius: 999,
                                                    border: `1px solid ${canAsk ? "rgba(249,115,22,0.45)" : "rgba(18,199,194,0.28)"}`,
                                                    background: canAsk ? "rgba(249,115,22,0.08)" : "rgba(18,199,194,0.08)",
                                                    color: canAsk ? "#f97316" : "var(--accent)",
                                                    fontSize: 11,
                                                    fontWeight: 800,
                                                    cursor: "pointer",
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {canAsk ? "なぜ伸びない？" : "🔒 Pro"}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Entry ④: Pro promo card at bottom of growth tab */}
            {billingEnabled && !isPro && !proCardDismissed && (
                <div
                    style={{
                        position: "relative",
                        background: "linear-gradient(145deg, rgba(18,199,194,0.12), var(--card) 60%)",
                        borderRadius: 20,
                        padding: "16px 16px 14px",
                        border: "1px solid rgba(18,199,194,0.22)",
                        boxShadow: "var(--shadow-card)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                    }}
                >
                    <button
                        type="button"
                        aria-label="閉じる"
                        onClick={() => {
                            const until = Date.now() + 7 * 24 * 60 * 60 * 1000;
                            try { localStorage.setItem("growth_pro_card_dismissed_until", String(until)); } catch {}
                            setProCardDismissed(true);
                        }}
                        style={{
                            position: "absolute",
                            top: 10,
                            right: 10,
                            background: "none",
                            border: "none",
                            color: "var(--text3)",
                            fontSize: 18,
                            lineHeight: 1,
                            fontWeight: 700,
                            cursor: "pointer",
                            padding: "2px 6px",
                        }}
                    >
                        ×
                    </button>
                    <div style={{ paddingRight: 28 }}>
                        <div style={{ fontSize: 10, fontWeight: 900, color: "var(--accent)", letterSpacing: 1.4, marginBottom: 4 }}>PUMP PRO</div>
                        <div style={{ fontSize: 16, fontWeight: 950, color: "var(--text)", lineHeight: 1.2, marginBottom: 4 }}>
                            記録から、次の一手まで。
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                            AI Coachを無制限に・伸び悩みの診断・全期間データ分析
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => onOpenPaywall?.("general")}
                        className="pressable"
                        style={{
                            padding: "11px 14px",
                            borderRadius: 14,
                            border: "none",
                            background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 900,
                            boxShadow: "0 8px 18px rgba(18,199,194,0.22)",
                        }}
                    >
                        Pump Pro を見る →
                    </button>
                </div>
            )}
        </div>
    );
}
