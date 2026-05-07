import React, { useEffect, useRef, useState } from "react";
import { calc1RM, dispW, getBestRmSet, hasMeaningfulPRIncrease, isCompletedWorkoutSet, KG_TO_LBS, PR_UPDATE_TOLERANCE_KG } from "../utils/helpers";
import AddExModal from "./modals/AddExModal";
import LogExerciseHistoryModal from "./modals/LogExerciseHistoryModal";
import WorkoutSessionShareModal from "./modals/WorkoutSessionShareModal";
import SetRow from "./log/SetRow";
import WorkoutElapsedTimer from "./WorkoutElapsedTimer";
import { buildWorkoutSessionPayloadFromDraft } from "../utils/workoutSessions";
import { S } from "../utils/styles";


import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableExerciseItem({ id, children }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
    };

    const dragHandleProps = {
        ...attributes,
        ...listeners,
    };

    return (
        <div ref={setNodeRef} style={style}>
            {children(dragHandleProps)}
        </div>
    );
}

const roundTo1Decimal = (value) => Math.round(Number(value || 0) * 10) / 10;


export default function LogScreen({
    manualBests = [],
    customBodyParts = [],
    hiddenBodyParts = [],
    onAddCustomBodyPart,
    onUpdateHiddenBodyParts,
    todayLabels,
    exercises, logData, getExSets, setField, addSet, removeEx,
    onAddEx, onQuickAddEx, onReorderEx, onRenameEx, getPrev, getPR, getPreviousPR, onCopyDown, onCopyDownReps, unit = "kg",
    getExUnit, onToggleExUnit, setTodayLabels, history, logDate, resetSession, muscleEx,
    workoutElapsedSec = 0,
    workoutTimerStatus = "idle",
    onFinishWorkoutTimer,
}) {

    const hasExercises = exercises.length > 0;
    const softBorderColor = "rgba(18, 199, 194, 0.16)";
    const softTealBg = "linear-gradient(180deg, rgba(18, 199, 194, 0.05), rgba(18, 199, 194, 0.02))";
    const subActionBg = "linear-gradient(180deg, rgba(18, 199, 194, 0.06), rgba(18, 199, 194, 0.02))";
    const subActionText = "#0F5E63";

    const [showAdd, setShowAdd] = useState(false);
    const [addName, setAddName] = useState("");
    const [reorderMenuId, setReorderMenuId] = useState(null);


    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState("");
    const [activeExIdx, setActiveExIdx] = useState(0);
    const [historyTarget, setHistoryTarget] = useState(null);
    const [showSessionShare, setShowSessionShare] = useState(false);
    const [showWorkoutTimerMenu, setShowWorkoutTimerMenu] = useState(false);
    const editRef = useRef(null);

    const exCount = exercises.length;



    const startEdit = (ex) => {
        setEditingId(ex.id);
        setEditingName(ex.name);
        setTimeout(() => editRef.current?.focus(), 30);
    };

    const setCount = exercises.reduce((acc, ex) => {
        const sets = logData[ex.name] || getExSets(ex);
        return acc + sets.filter((s) => isCompletedWorkoutSet(s)).length;
    }, 0);
    const { prCount, totalVolumeKg } = exercises.reduce((acc, ex) => {
        const sets = logData[ex.name] || getExSets(ex);
        const exUnit = getExUnit ? getExUnit(ex.name) : unit;

        const doneSets = sets.filter((s) => {
            const w = Number(s.weight);
            const r = Number(s.reps);
            return Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0;
        }).map((s) => ({
            ...s,
            weight: exUnit === "lbs" ? String(Number(s.weight) / KG_TO_LBS) : s.weight,
        }));

        const pr = getPreviousPR ? getPreviousPR(ex, { excludeDate: logDate }) : (getPR ? getPR(ex) : null);
        const prSets = pr?.sets?.filter((s) => {
            const w = Number(s.weight);
            const r = Number(s.reps);
            return Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0;
        }) || [];

        const pr1RM = pr?.rm ?? calc1RM(prSets);
        const isPR = hasMeaningfulPRIncrease(doneSets, prSets, pr1RM, PR_UPDATE_TOLERANCE_KG);

        const exVolumeKg = doneSets.reduce((sum, s) => {
            const w = Number(s.weight);
            const r = Number(s.reps);
            if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return sum;
            return sum + w * r;
        }, 0);

        return {
            prCount: acc.prCount + (isPR ? 1 : 0),
            totalVolumeKg: acc.totalVolumeKg + exVolumeKg,
        };
    }, { prCount: 0, totalVolumeKg: 0 });
    const formattedVolumeKg = Math.round(totalVolumeKg).toLocaleString("ja-JP");
    const sessionSharePayload = buildWorkoutSessionPayloadFromDraft({
        exercises,
        logData,
        getExUnit,
        workoutDate: logDate,
    });
    const confirmEdit = (ex) => {
        const trimmed = editingName.trim();
        if (trimmed && trimmed !== ex) onRenameEx(ex.id, trimmed);
        setEditingId(null);
    };
    const formatDate = (d) =>
        `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

    const title = todayLabels.length
        ? todayLabels.join(" + ")
        : formatDate(logDate);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                delay: 0,
                distance: 0,
            },
        })
    );

    const handleDragEnd = (event) => {
        const { active, over } = event;

        if (!over || active.id === over.id) return;

        const oldIndex = exercises.findIndex((ex) => ex.id === active.id);
        const newIndex = exercises.findIndex((ex) => ex.id === over.id);

        if (oldIndex === -1 || newIndex === -1) return;

        onReorderEx(oldIndex, newIndex);
    };

    const moveExerciseByOffset = (exerciseId, offset) => {
        const currentIndex = exercises.findIndex((ex) => ex.id === exerciseId);
        if (currentIndex === -1) return;

        const nextIndex = currentIndex + offset;
        if (nextIndex < 0 || nextIndex >= exercises.length) return;

        onReorderEx(currentIndex, nextIndex);
    };

    const historyTargetRecords = historyTarget
        ? [...(history?.[historyTarget] || [])]
            .filter((record) => record?.date && record.date !== logDate)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [];

    const historyTargetUnit = historyTarget && getExUnit
        ? (getExUnit(historyTarget) === "lbs" ? "lbs" : "kg")
        : (unit === "lbs" ? "lbs" : "kg");

    useEffect(() => {
        if (!exercises.some((ex) => ex.id === reorderMenuId)) {
            setReorderMenuId(null);
        }
    }, [exercises, reorderMenuId]);

    return (
        <div className="fade-in" style={{ ...S.page, paddingBottom: 200 }}>
            <div style={{ ...S.subtleCard, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2.5, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }}>{title}</div>
                    </div>
                    <WorkoutElapsedTimer
                        elapsedSec={workoutElapsedSec}
                        status={workoutTimerStatus}
                        onClick={workoutTimerStatus === "active" ? () => setShowWorkoutTimerMenu(true) : undefined}
                    />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    {[
                        `${exCount}種目`,
                        `${setCount}セット`,
                        `PR ${prCount}件`,
                    ].map((item) => (
                        <div
                            key={item}
                            style={{
                                padding: "4px 8px",
                                borderRadius: 999,
                                background: "rgba(18, 199, 194, 0.08)",
                                border: "1px solid rgba(18, 199, 194, 0.14)",
                                color: "var(--text2)",
                                fontSize: 11,
                                fontWeight: 700,
                                lineHeight: 1.2,
                            }}
                        >
                            {item}
                        </div>
                    ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>
                    合計Volume <span style={{ color: "var(--text)", fontSize: 14 }}>{formattedVolumeKg}kg</span>
                </div>
                {sessionSharePayload && (
                    <button
                        type="button"
                        onClick={() => setShowSessionShare(true)}
                        style={{
                            marginTop: 10,
                            padding: "7px 10px",
                            borderRadius: 10,
                            border: `1px solid ${softBorderColor}`,
                            background: subActionBg,
                            color: subActionText,
                            fontSize: 12,
                            fontWeight: 700,
                        }}
                    >
                        シェアカード
                    </button>
                )}
            </div>

            {/* Empty State */}
            {!hasExercises && (
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingTop: 80,
                    gap: 12
                }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
                        今日のトレーニングを始めよう
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text3)" }}>
                        ＋ボタンから種目を追加してください
                    </div>
                </div>
            )}


            {/* 種目カード */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={exercises.map((ex) => ex.id)}
                    strategy={verticalListSortingStrategy}
                >


                    {exercises.map((ex, i) => {

                        const sets = logData[ex.name] || getExSets(ex);
                        const isEditing = editingId === ex.id;
                        const prev = getPrev ? getPrev(ex) : null;
                        const pr = getPreviousPR ? getPreviousPR(ex, { excludeDate: logDate }) : (getPR ? getPR(ex) : null);
                        const exUnit = getExUnit ? getExUnit(ex.name) : unit;
                        const prIsAlsoPrev = pr && prev && pr.date === prev.date;

                        const doneSets = sets.filter(s => {
                            const w = Number(s.weight);
                            const r = Number(s.reps);
                            return Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0;
                        }).map(s => ({
                            ...s,
                            weight: exUnit === "lbs" ? String(Number(s.weight) / KG_TO_LBS) : s.weight
                        }));

                        const cur1RM = calc1RM(doneSets);

                        const prSets = pr?.sets?.filter(s => {
                            const w = Number(s.weight);
                            const r = Number(s.reps);
                            return Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0;
                        }) || [];

                        const pr1RM = pr?.rm ?? calc1RM(prSets);
                        const rawPrDiff = cur1RM - pr1RM;
                        const prDiff = rawPrDiff > PR_UPDATE_TOLERANCE_KG
                            ? roundTo1Decimal(rawPrDiff)
                            : 0;

                        const isPR = hasMeaningfulPRIncrease(doneSets, prSets, pr1RM, PR_UPDATE_TOLERANCE_KG);

                        // PR の実際のトップセット（1RM換算が最大のセット）
                        const prTopSet = getBestRmSet(pr?.sets, { allowBodyweight: false });

                        if (i !== activeExIdx) {
                            const doneSetsCount = sets.filter((s) => isCompletedWorkoutSet(s)).length;

                            return (
                                <SortableExerciseItem key={ex.id} id={ex.id}>
                                    {() => (
                                        <>
                                            <div
                                                onClick={() => setActiveExIdx(i)}
                                                style={{
                                                    background: "var(--card)",
                                                    borderRadius: 20,
                                                    padding: "12px 16px",
                                                    marginBottom: 12,
                                                    border: "1px solid var(--border2)",
                                                    boxShadow: "var(--shadow-card)",
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    transition: "transform 0.1s ease"
                                                }}
                                                onTouchStart={(e) => {
                                                    e.currentTarget.style.transform = "scale(0.9)";
                                                }}
                                                onTouchEnd={(e) => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }}
                                            >
                                                <div>
                                                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                                                        {ex.name}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
                                                        {doneSetsCount > 0 ? `${doneSetsCount}セット完了` : "未入力"}
                                                    </div>
                                                </div>

                                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setReorderMenuId((prev) => (prev === ex.id ? null : ex.id));
                                                        }}
                                                        style={{
                                                            background: subActionBg,
                                                            border: `1px solid ${softBorderColor}`,
                                                            padding: "6px 10px",
                                                            color: subActionText,
                                                            fontSize: 16,
                                                            borderRadius: 10,
                                                        }}
                                                    >
                                                        ≡
                                                    </button>
                                                </div>
                                            </div>
                                            {reorderMenuId === ex.id && (
                                                <div
                                                    style={{
                                                        marginTop: -4,
                                                        marginBottom: 12,
                                                        display: "flex",
                                                        gap: 8,
                                                        justifyContent: "flex-end",
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => moveExerciseByOffset(ex.id, -1)}
                                                        disabled={i === 0}
                                                        style={{
                                                            padding: "7px 10px",
                                                            borderRadius: 10,
                                                            border: `1px solid ${softBorderColor}`,
                                                            background: subActionBg,
                                                            color: i === 0 ? "var(--text4)" : "var(--text2)",
                                                            fontSize: 12,
                                                            fontWeight: 700,
                                                        }}
                                                    >
                                                        上へ
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveExerciseByOffset(ex.id, 1)}
                                                        disabled={i === exercises.length - 1}
                                                        style={{
                                                            padding: "7px 10px",
                                                            borderRadius: 10,
                                                            border: `1px solid ${softBorderColor}`,
                                                            background: subActionBg,
                                                            color: i === exercises.length - 1 ? "var(--text4)" : "var(--text2)",
                                                            fontSize: 12,
                                                            fontWeight: 700,
                                                        }}
                                                    >
                                                        下へ
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setReorderMenuId(null)}
                                                        style={{
                                                            padding: "7px 10px",
                                                            borderRadius: 10,
                                                            border: `1px solid ${softBorderColor}`,
                                                            background: subActionBg,
                                                            color: "var(--text3)",
                                                            fontSize: 12,
                                                            fontWeight: 700,
                                                        }}
                                                    >
                                                        閉じる
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </SortableExerciseItem>
                            );
                        }

                        return (
                            <SortableExerciseItem key={ex.id} id={ex.id}>
                                {() => (
                                    <div style={{ background: "var(--card)", borderRadius: 20, padding: "16px", marginBottom: 12, border: `1px solid ${isPR ? "var(--success-border)" : softBorderColor}`, boxShadow: isPR ? "0 14px 32px rgba(18,199,194,0.10)" : "var(--shadow-card)" }}>

                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                            <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                                                {isEditing ? (
                                                    <input
                                                        ref={editRef}
                                                        value={typeof editingName === "string" ? editingName : editingName?.name || ""}
                                                        onChange={e => setEditingName(e.target.value)}
                                                        onBlur={() => confirmEdit(ex)}
                                                        onKeyDown={e => { if (e.key === "Enter") confirmEdit(ex); if (e.key === "Escape") setEditingId(null); }}
                                                        style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid var(--text2)", color: "var(--text)", fontSize: 16, fontWeight: 700, padding: "2px 0" }}
                                                    />
                                                ) : (
                                                    <div onClick={() => startEdit(ex)} style={{ fontSize: 16, fontWeight: 700, cursor: "text", color: "var(--text)" }}>
                                                        {ex.name}
                                                    </div>
                                                )}
                                            </div>

                                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setReorderMenuId((prev) => (prev === ex.id ? null : ex.id));
                                                    }}
                                                    style={{
                                                        background: subActionBg,
                                                        border: `1px solid ${softBorderColor}`,
                                                        padding: "6px 10px",
                                                        color: subActionText,
                                                        fontSize: 16,
                                                        borderRadius: 10,
                                                    }}
                                                >
                                                    ≡
                                                </button>

                                                {onToggleExUnit && (
                                                    <button
                                                        onClick={() => onToggleExUnit(ex.name)}
                                                        style={{ padding: "4px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700, border: `1px solid ${softBorderColor}`, background: exUnit !== unit ? "linear-gradient(135deg, #0F5E63, #12C7C2)" : subActionBg, color: exUnit !== unit ? "#ffffff" : subActionText, boxShadow: exUnit !== unit ? "0 8px 18px rgba(15, 94, 99, 0.10)" : "none" }}
                                                    >
                                                        {{ kg: "lbs", lbs: "自重", BW: "kg" }[exUnit] || exUnit}
                                                    </button>
                                                )}
                                                <button
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setHistoryTarget(ex.name);
                                                    }}
                                                    style={{
                                                        padding: "4px 10px",
                                                        borderRadius: 10,
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        border: `1px solid ${softBorderColor}`,
                                                        background: subActionBg,
                                                        color: subActionText,
                                                    }}
                                                >
                                                    履歴
                                                </button>
                                                <button onClick={() => removeEx(ex.id, ex.name)} style={{ background: subActionBg, border: `1px solid ${softBorderColor}`, color: subActionText, fontSize: 16, padding: "4px 10px", borderRadius: 10 }}>×</button>
                                            </div>
                                        </div>

                                        {reorderMenuId === ex.id && (
                                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 10 }}>
                                                <button
                                                    type="button"
                                                    onClick={() => moveExerciseByOffset(ex.id, -1)}
                                                    disabled={i === 0}
                                                    style={{
                                                        padding: "7px 10px",
                                                        borderRadius: 10,
                                                        border: `1px solid ${softBorderColor}`,
                                                        background: subActionBg,
                                                        color: i === 0 ? "var(--text4)" : "var(--text2)",
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    上へ
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => moveExerciseByOffset(ex.id, 1)}
                                                    disabled={i === exercises.length - 1}
                                                    style={{
                                                        padding: "7px 10px",
                                                        borderRadius: 10,
                                                        border: `1px solid ${softBorderColor}`,
                                                        background: subActionBg,
                                                        color: i === exercises.length - 1 ? "var(--text4)" : "var(--text2)",
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    下へ
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setReorderMenuId(null)}
                                                    style={{
                                                        padding: "7px 10px",
                                                        borderRadius: 10,
                                                        border: `1px solid ${softBorderColor}`,
                                                        background: subActionBg,
                                                        color: "var(--text3)",
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    閉じる
                                                </button>
                                            </div>
                                        )}

                                        {/* 前回の記録 + PR */}
                                        {(prev || pr) && (
                                            <div style={{ marginBottom: 10, padding: "10px 12px", background: softTealBg, borderRadius: 14, border: `1px solid ${softBorderColor}` }}>
                                                {prev && (
                                                    <>
                                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                                            <div style={{ fontSize: 11, color: "var(--text2)" }}>前回 <span style={{ color: "var(--text3)" }}>{prev.date}</span></div>
                                                            {isPR && <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>PR更新！</div>}
                                                        </div>
                                                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3, lineHeight: 1.6 }}>
                                                            {prev.sets?.map((s, i) => (
                                                                <span key={i}>
                                                                    {i > 0 && <span style={{ color: "var(--text5)", margin: "0 4px" }}>/</span>}
                                                                    {s.weight === "BW" ? "自重" : `${dispW(s.weight, exUnit)}${exUnit}`}×{s.reps}
                                                                </span>
                                                            )) || `${prev.weight === "BW" ? "自重" : `${dispW(prev.weight, exUnit)}${exUnit}`}×${prev.reps}`}
                                                        </div>
                                                    </>
                                                )}
                                                {pr && !prIsAlsoPrev && (
                                                    <div style={{ marginTop: prev ? 6 : 0, paddingTop: prev ? 6 : 0, borderTop: prev ? "1px solid var(--border2)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                        <div style={{ fontSize: 11, color: "var(--text2)" }}>🏆 PR <span style={{ color: "var(--text3)", fontWeight: 400 }}>{pr.date}</span></div>
                                                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)" }}>
                                                            {prTopSet ? `${dispW(prTopSet.weight, exUnit)}${exUnit} × ${prTopSet.reps}rep` : `${roundTo1Decimal(pr.rm)}${exUnit}`}
                                                        </div>
                                                    </div>
                                                )}
                                                {pr && prIsAlsoPrev && (
                                                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--text2)" }}>
                                                        🏆 前回がPR（{prTopSet ? `${dispW(prTopSet.weight, exUnit)}${exUnit}×${prTopSet.reps}rep` : `${roundTo1Decimal(pr.rm)}${exUnit}`}）
                                                    </div>
                                                )}
                                                {isPR && prDiff > 0 && (
                                                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>
                                                        PR更新！ +{prDiff.toFixed(1)}kg
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 28px 1fr 28px", gap: 6, marginBottom: 6 }}>
                                            <div />
                                            <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "center" }}>{exUnit === "BW" ? "自重" : exUnit}</div>
                                            <div />
                                            <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "center" }}>rep</div>
                                            <div />
                                        </div>

                                        {sets.map((set, idx) => (
                                            <SetRow
                                                key={idx}
                                                ex={ex}
                                                set={set}
                                                idx={idx}
                                                setField={setField}
                                                onCopyDown={onCopyDown}
                                                onCopyDownReps={onCopyDownReps}
                                            />
                                        ))}

                                            <button
                                                onClick={() => addSet(ex)}
                                                style={{
                                                    width: "100%",
                                                    marginTop: 10,
                                                    padding: "12px",
                                                    borderRadius: 14,
                                                    background: softTealBg,
                                                    border: `1px solid ${softBorderColor}`,
                                                    color: subActionText,
                                                    fontSize: 13,
                                                    fontWeight: 700,
                                                    boxShadow: "0 10px 20px rgba(15, 94, 99, 0.05)",
                                                }}
                                            >
                                                ＋ セット追加
                                            </button>

                                    </div>
                                )}
                            </SortableExerciseItem>
                        );
                    })}
                </SortableContext>
            </DndContext>

            {/* フローティング＋ボタン */}
            <button onClick={() => setShowAdd(true)}
                style={{ position: "fixed", bottom: 154, left: 20, width: 54, height: 54, borderRadius: 27, background: "linear-gradient(135deg, #0F5E63, #12C7C2)", color: "#fff", fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 26px rgba(15, 94, 99, 0.16)", border: "1px solid rgba(255,255,255,0.62)", zIndex: 101 }}>
                ＋
            </button>

            {showAdd && (
                <AddExModal
                    name={addName} setName={setAddName}
                    onConfirm={() => { onAddEx(addName); setAddName(""); }}
                    onClose={() => { setShowAdd(false); setAddName(""); }}
                    target={null}
                    onQuickAdd={onQuickAddEx}
                    existingNames={exercises.map(e => e.name)}
                    muscleEx={muscleEx}
                    history={history}
                    manualBests={manualBests}
                    customBodyParts={customBodyParts}
                    hiddenBodyParts={hiddenBodyParts}
                    onAddCustomBodyPart={onAddCustomBodyPart}
                    onUpdateHiddenBodyParts={onUpdateHiddenBodyParts}
                />
            )}

            {historyTarget && (
                <LogExerciseHistoryModal
                    exName={historyTarget}
                    records={historyTargetRecords}
                    weightDisplayUnit={historyTargetUnit}
                    onClose={() => setHistoryTarget(null)}
                />
            )}

            {showSessionShare && (
                <WorkoutSessionShareModal
                    isOpen={showSessionShare}
                    onClose={() => setShowSessionShare(false)}
                    workoutDate={logDate}
                    sessionPayload={sessionSharePayload}
                />
            )}

            {showWorkoutTimerMenu && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 310,
                        background: "rgba(15, 23, 42, 0.42)",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        padding: "16px 14px calc(20px + var(--safe-bottom, 0px))",
                        boxSizing: "border-box",
                    }}
                    onClick={() => setShowWorkoutTimerMenu(false)}
                >
                    <div
                        style={{
                            width: "100%",
                            maxWidth: 420,
                            background: "var(--card-modal)",
                            borderRadius: 22,
                            border: "1px solid rgba(18, 199, 194, 0.14)",
                            boxShadow: "0 22px 44px rgba(15, 23, 42, 0.18)",
                            padding: "18px 16px 14px",
                            boxSizing: "border-box",
                        }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
                            ワークアウト時間
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14, lineHeight: 1.6 }}>
                            ワークアウトを終了しますか？
                            <br />
                            この時間を今日のワークアウト時間として保存します。
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowWorkoutTimerMenu(false);
                                }}
                                style={{
                                    padding: "12px 14px",
                                    borderRadius: 14,
                                    border: "1px solid rgba(18, 199, 194, 0.12)",
                                    background: "rgba(18, 199, 194, 0.03)",
                                    color: "var(--text3)",
                                    fontSize: 14,
                                    fontWeight: 800,
                                }}
                            >
                                キャンセル
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onFinishWorkoutTimer?.();
                                    setShowWorkoutTimerMenu(false);
                                }}
                                style={{
                                    padding: "12px 14px",
                                    borderRadius: 14,
                                    border: "1px solid rgba(255, 146, 39, 0.18)",
                                    background: "linear-gradient(180deg, rgba(255, 146, 39, 0.10), rgba(255, 146, 39, 0.04))",
                                    color: "#8A4A12",
                                    fontSize: 14,
                                    fontWeight: 800,
                                }}
                            >
                                終了する
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
