import { useState, useEffect, useMemo } from "react";
import { supabase } from "../utils/supabase";
import { SUGGESTIONS } from "../constants/suggestions";
import CalendarView from "./CalendarView";
import HistoryEditModal from "./modals/HistoryEditModal";
import PRGraphModal from "./modals/PRGraphModal";
import ManualBestModal from "./modals/ManualBestModal";
import ManualBestManagerModal from "./modals/ManualBestManagerModal";
import CustomBodyPartModal from "./modals/CustomBodyPartModal";
import HistoryExerciseItem from "./history/HistoryExerciseItem";

const normalizeName = (name) =>
    String(name || "").replace(/\s+/g, "").trim();

const matchesExerciseName = (candidateName, exName) => {
    const base = normalizeName(candidateName);
    const normalized = normalizeName(exName);
    return base === normalized || base.includes(normalized) || normalized.includes(base);
};

const resolveVisibleLabel = (exName, muscleEx = {}, hiddenBodyParts = []) => {
    const hiddenSet = new Set(hiddenBodyParts || []);
    const matchingDefaultLabels = Object.entries(SUGGESTIONS)
        .filter(([, names]) => (names || []).some((name) => matchesExerciseName(name, exName)))
        .map(([label]) => label);
    const visibleDefaultLabels = matchingDefaultLabels.filter((label) => !hiddenSet.has(label));

    const visibleCustomMatches = Object.entries(muscleEx || {})
        .filter(([label]) => label && !hiddenSet.has(label))
        .filter(([, list]) =>
            (list || []).some((ex) => {
                const name = typeof ex === "string" ? ex : ex?.name;
                return matchesExerciseName(name, exName);
            })
        )
        .map(([label]) => label);

    const visibleExplicitUserLabels = visibleCustomMatches.filter((label) => {
        const defaultsForLabel = SUGGESTIONS[label] || [];
        return !defaultsForLabel.some((name) => matchesExerciseName(name, exName));
    });

    if (visibleDefaultLabels.length === 1) {
        return visibleDefaultLabels[0];
    }

    if (visibleDefaultLabels.length > 1) {
        return visibleExplicitUserLabels[0] || visibleDefaultLabels[0];
    }

    if (matchingDefaultLabels.length > 0) {
        return visibleExplicitUserLabels[0] || null;
    }

    return visibleExplicitUserLabels[0] || visibleCustomMatches[0] || null;
};

export default function HistoryScreen({
    history,
    muscleEx,
    onEditHistory,
    onDeleteHistory,
    onDeleteDate,
    unit = "kg",
    onLogForDate,
    user,
    manualBests = [],
    customBodyParts = [],
    hiddenBodyParts = [],
    onAddManualBest,
    onUpdateManualBest,
    onDeleteManualBest,
    onAddCustomBodyPart,
}) {
    const [editTarget, setEditTarget] = useState(null);
    const [graphTarget, setGraphTarget] = useState(null);
    const [showManualBestModal, setShowManualBestModal] = useState(false);
    const [showManualBestManager, setShowManualBestManager] = useState(false);
    const [showCustomBodyPartModal, setShowCustomBodyPartModal] = useState(false);
    const [editingManualBest, setEditingManualBest] = useState(null);


    const today = new Date();

    const [activeLabel, setActiveLabel] = useState(null);
    const [selectedDate, setSelectedDate] = useState(null);
    const [openExercises, setOpenExercises] = useState({});

    const openManualBestModalForCreate = () => {
        setShowManualBestManager(false);
        setEditingManualBest(null);
        setShowManualBestModal(true);
    };

    const openManualBestModalForEdit = (best) => {
        setShowManualBestManager(false);
        setEditingManualBest(best);
        setShowManualBestModal(true);
    };

    const openCustomBodyPartModal = () => {
        setShowManualBestManager(false);
        setShowCustomBodyPartModal(true);
    };

    useEffect(() => {
        if (selectedDate) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [selectedDate]);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const toDateKey = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const weekStartStr = toDateKey(startOfWeek);
    const weekEndStr = toDateKey(endOfWeek);

    const {
        detailMap,
        sortedWeekStats,
    } = useMemo(() => {
        const nextWeekStats = {};
        const nextDetailMap = {};

        Object.entries(history || {}).forEach(([exName, recs]) => {
            const label = resolveVisibleLabel(exName, muscleEx, hiddenBodyParts);
            if (!label) return;

            (recs || []).forEach((r) => {
                if (!r?.date) return;
                if (r.date < weekStartStr || r.date > weekEndStr) return;

                const sets = (r.sets || []).filter((s) => s.weight && s.reps).length;
                if (!sets) return;

                nextWeekStats[label] = (nextWeekStats[label] || 0) + sets;

                if (!nextDetailMap[label]) nextDetailMap[label] = {};
                nextDetailMap[label][exName] = (nextDetailMap[label][exName] || 0) + sets;
            });
        });

        return {
            weekStats: nextWeekStats,
            detailMap: nextDetailMap,
            sortedWeekStats: Object.entries(nextWeekStats).sort((a, b) => b[1] - a[1]),
        };
    }, [history, hiddenBodyParts, muscleEx, weekEndStr, weekStartStr]);

    const daySummary = {};

    Object.entries(history || {}).forEach(([exName, recs]) => {
        (recs || []).forEach((r) => {
            if (r.date !== selectedDate) return;

            const sets = (r.sets || []).filter(s => s.weight && s.reps).length;
            if (!sets) return;

            daySummary[exName] = (daySummary[exName] || 0) + sets;
        });
    });

    const dayDetails = Object.entries(history || {})
        .map(([name, recs]) => {
            const record = recs.find((r) => r.date === selectedDate);
            if (!record) return null;

            return {
                name,
                count: record.sets.length,
                sets: record.sets,
                order: typeof record.order === "number" ? record.order : 999,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);



    const workedLabels = [...new Set(
        Object.keys(daySummary)
            .map((exName) => resolveVisibleLabel(exName, muscleEx, hiddenBodyParts))
            .filter(Boolean)
    )];

    const totalSets = Object.values(daySummary).reduce((a, b) => a + b, 0);
    const uniqueTrainingDates = [...new Set(
        Object.values(history || {})
            .flatMap((recs) => (recs || []).map((r) => r?.date).filter(Boolean))
    )].sort();
    const totalTrainingDays = uniqueTrainingDates.length;
    const firstTrainingDate = uniqueTrainingDates[0] || null;
    const formatStatDate = (date) => {
        if (!date) return "—";
        return date.replace(/-/g, "/");
    };
    return (
        <div className="fade-in" style={{ padding: "20px" }}>

            {/* WEEKLY SPLIT */}
            {sortedWeekStats.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 16 }}>
                        今週のセット数
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {sortedWeekStats.map(([label, count]) => {
                            const isActive = activeLabel === label;

                            return (
                                <div
                                    key={label}
                                    onClick={() => setActiveLabel(isActive ? null : label)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: "11px 14px",
                                        borderRadius: 999,
                                        cursor: "pointer",
                                        background: isActive ? "linear-gradient(135deg, var(--accent), #4ADE80)" : "var(--card)",
                                        border: isActive ? "1px solid transparent" : "1px solid var(--border2)",
                                        boxShadow: isActive ? "var(--shadow-soft)" : "var(--shadow-card)",
                                    }}
                                >
                                    <span style={{
                                        fontSize: 13,
                                        fontWeight: 700,
                                        color: isActive ? "#fff" : "var(--text2)",
                                    }}>
                                        {label}
                                    </span>

                                    <span style={{
                                        fontSize: 18,
                                        fontWeight: 800,
                                        color: isActive ? "#fff" : "var(--text)",
                                    }}>
                                        {count}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                </div>
            )}



            <div
                style={{
                    background: "var(--card)",
                    borderRadius: 20,
                    padding: "10px 12px",
                    border: "1px solid var(--border2)",
                    boxShadow: "var(--shadow-card)",
                    marginBottom: 10,
                }}
            >
                <div style={{ fontSize: 10, letterSpacing: 2.2, color: "var(--text3)", marginBottom: 6 }}>
                    これまでの記録
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <div style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 15, padding: "8px 10px", border: "1px solid rgba(186, 230, 253, 0.65)" }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", lineHeight: 1.05 }}>
                            {totalTrainingDays}日
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                            累計トレーニング日数
                        </div>
                    </div>
                    <div style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 15, padding: "8px 10px", border: "1px solid rgba(186, 230, 253, 0.65)" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", lineHeight: 1.05 }}>
                            {formatStatDate(firstTrainingDate)}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                            開始日
                        </div>
                    </div>
                </div>
            </div>

            {/* カレンダー（←ここ外に出すのが超重要） */}
            <div style={{
                background: "var(--card)",
                borderRadius: 20,
                padding: "16px",
                border: "1px solid var(--border2)",
                boxShadow: "var(--shadow-card)",
                marginBottom: 12,
            }}>
                <CalendarView
                    history={history}
                    onDayOpen={(date) => {
                        const hasData = Object.values(history || {}).some((recs) =>
                            (recs || []).some((r) => r.date === date)
                        );

                        if (hasData) {
                            setSelectedDate(date);
                        } else {
                            onLogForDate(date);
                        }
                    }}
                />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>
                    移行用に、過去の自己ベストだけ先に登録できます
                </div>
                <button
                    onClick={() => setShowManualBestManager(true)}
                    disabled={!user}
                    style={{
                        padding: "8px 12px",
                        borderRadius: 14,
                        background: "linear-gradient(135deg, var(--accent2), #7DD3FC)",
                        border: "1px solid var(--border2)",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        opacity: user ? 1 : 0.6,
                        boxShadow: "var(--shadow-soft)",
                    }}
                >
                    過去ベストを登録・確認
                </button>
            </div>

            {/* モーダル */}
            {editTarget && (
                <HistoryEditModal
                    exName={editTarget.exName}
                    record={editTarget.record}
                    onSave={(exName, updatedRecord) => {
                        onEditHistory(exName, updatedRecord, editTarget.historyIdx);
                        setEditTarget(null);
                    }}
                    onDelete={() => {
                        onDeleteHistory(editTarget.exName, editTarget.historyIdx, editTarget.record?.date);
                        setEditTarget(null);
                    }}
                    onClose={() => setEditTarget(null)}
                />
            )}

            {graphTarget && (
                <PRGraphModal
                    exName={graphTarget}
                    history={history}
                    unit={unit}
                    onClose={() => setGraphTarget(null)}
                />
            )}

            <ManualBestModal
                isOpen={showManualBestModal}
                mode={editingManualBest ? "edit" : "create"}
                initialValue={editingManualBest}
                customBodyParts={customBodyParts}
                onClose={() => {
                    setShowManualBestModal(false);
                    setEditingManualBest(null);
                }}
                onSave={async (payload) => {
                    if (!user?.id) return;

                    if (editingManualBest) {
                        const { data, error } = await supabase
                            .from("manual_bests")
                            .update({
                                exercise_name: payload.exercise_name,
                                weight: payload.weight,
                                reps: payload.reps,
                                best_date: payload.best_date,
                                body_part: payload.body_part,
                            })
                            .eq("id", editingManualBest.id)
                            .eq("user_id", user.id)
                            .select("id, exercise_name, weight, reps, best_date, body_part, created_at")
                            .single();

                        if (error) throw error;

                        onUpdateManualBest?.(data);
                        return;
                    }

                    const { data, error } = await supabase
                        .from("manual_bests")
                        .insert({
                            user_id: user.id,
                            exercise_name: payload.exercise_name,
                            weight: payload.weight,
                            reps: payload.reps,
                            best_date: payload.best_date,
                            body_part: payload.body_part,
                        })
                        .select("id, exercise_name, weight, reps, best_date, body_part, created_at")
                        .single();

                    if (error) throw error;

                    onAddManualBest?.(data);
                }}
            />

            <ManualBestManagerModal
                isOpen={showManualBestManager}
                user={user}
                manualBests={manualBests}
                customBodyParts={customBodyParts}
                onClose={() => setShowManualBestManager(false)}
                onOpenRegister={openManualBestModalForCreate}
                onOpenAddBodyPart={openCustomBodyPartModal}
                onEditBest={openManualBestModalForEdit}
                onDeleteBest={async (best) => {
                    const confirmed = window.confirm(`${best.exercise_name} の過去ベストを削除しますか？`);
                    if (!confirmed) return;

                    const { error } = await supabase
                        .from("manual_bests")
                        .delete()
                        .eq("id", best.id)
                        .eq("user_id", user.id);

                    if (error) {
                        console.error(error);
                        return;
                    }

                    onDeleteManualBest?.(best.id);
                }}
            />

            <CustomBodyPartModal
                isOpen={showCustomBodyPartModal}
                customBodyParts={customBodyParts}
                onClose={() => setShowCustomBodyPartModal(false)}
                onSave={(bodyPart) => {
                    onAddCustomBodyPart?.(bodyPart);
                    setShowCustomBodyPartModal(false);
                }}
            />

            {activeLabel && detailMap[activeLabel] && (
                <div
                    onClick={() => setActiveLabel(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.35)",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        zIndex: 999, // ←上げる
                        padding: "16px",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 430,
                            background: "var(--card)",
                            borderRadius: 20,
                            padding: "18px 16px 20px",
                            border: "1px solid var(--border2)",
                            maxHeight: "60vh",
                            overflowY: "auto",
                            boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                        }}
                    >
                        <div
                            style={{
                                width: 44,
                                height: 5,
                                borderRadius: 999,
                                background: "var(--border2)",
                                margin: "0 auto 14px",
                            }}
                        />

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 12,
                            }}
                        >
                            <div style={{ fontSize: 18, fontWeight: 800 }}>
                                {activeLabel}
                            </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {Object.entries(detailMap[activeLabel])
                                .sort((a, b) => b[1] - a[1])
                                .map(([name, count]) => (
                                    <div
                                        key={name}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            padding: "10px 12px",
                                            background: "var(--card2)",
                                            borderRadius: 12,
                                        }}
                                    >
                                        <span>{name}</span>
                                        <span>{count}</span>
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>
            )}

            {selectedDate && Object.keys(daySummary).length > 0 && (
                <div
                    onClick={() => setSelectedDate(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.35)",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        zIndex: 999,
                        padding: "16px",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 430,
                            background: "var(--card)",
                            borderRadius: 20,
                            padding: "18px 16px 20px",
                            border: "1px solid var(--border2)",
                            maxHeight: "60vh",
                            overflowY: "auto",
                        }}
                    >
                        <div
                            style={{
                                width: 44,
                                height: 5,
                                borderRadius: 999,
                                background: "var(--border2)",
                                margin: "0 auto 14px",
                            }}
                        />

                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 18, fontWeight: 800 }}>
                                {selectedDate}
                            </div>
                        </div>

                        <div
                            style={{
                                position: "sticky",
                                top: 0,
                                zIndex: 10,
                                background: "var(--card)",
                                paddingBottom: 12,
                                marginBottom: 4,
                            }}
                        >
                            <button
                                onClick={() => onLogForDate(selectedDate)}
                                style={{
                                    width: "100%",
                                    border: "none",
                                    borderRadius: 18,
                                    padding: "16px",
                                    fontSize: 15,
                                    fontWeight: 700,
                                    background: "var(--card2)",
                                    color: "var(--text)",

                                }}
                            >
                                記録を開く
                            </button>
                        </div>

                        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>
                            合計 {totalSets} セット
                        </div>

                        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>
                            {workedLabels.join(" / ")}
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {dayDetails.map(({ name, count, sets }) => {
                                const isOpen = !!openExercises[name];

                                return (
                                    <HistoryExerciseItem
                                        key={name}
                                        name={name}
                                        count={count}
                                        sets={sets}
                                        isOpen={isOpen}
                                        onToggle={() =>
                                            setOpenExercises((p) => ({
                                                ...p,
                                                [name]: !p[name],
                                            }))
                                        }
                                        onDeleteSet={(setIdx) =>
                                            onDeleteHistory?.(name, undefined, selectedDate, setIdx)
                                        }
                                    />
                                );
                            })}
                        </div>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 14,
                                marginTop: 20,
                                paddingTop: 6,
                            }}
                        >
                            <button
                                onClick={() => {
                                    if (!selectedDate) return;
                                    const confirmed = window.confirm(`${selectedDate} の記録を削除しますか？`);
                                    if (!confirmed) return;
                                    onDeleteDate?.(selectedDate);
                                    setSelectedDate(null);
                                }}
                                style={{
                                    width: "100%",
                                    border: "1px solid var(--border2)",
                                    borderRadius: 18,
                                    padding: "14px",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    background: "transprent",
                                    color: "var(--text3)",
                                    marginTop: 8
                                }}
                            >
                                この日の記録を削除
                            </button>


                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
