import React, { useEffect, useRef, useState } from "react";
import { calc1RM, dispW, getBestRmSet, getRecordSourceSets, hasMeaningfulPRIncrease, isCompletedWorkoutSet, PR_UPDATE_TOLERANCE_KG, storeW } from "../utils/helpers";
import AddExModal from "./modals/AddExModal";
import LogExerciseHistoryModal from "./modals/LogExerciseHistoryModal";
import WorkoutSessionShareModal from "./modals/WorkoutSessionShareModal";
import SetRow from "./log/SetRow";
import WorkoutElapsedTimer from "./WorkoutElapsedTimer";
import { buildWorkoutSessionPayloadFromDraft } from "../utils/workoutSessions";
import { S } from "../utils/styles";
import { getSetCountByBodyPart } from "../utils/setCountByBodyPart";


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
const MAX_REASONABLE_DURATION_SEC = 12 * 60 * 60;

const getPreviousRecordSets = (record) => {
    const sets = getRecordSourceSets(record);
    return Array.isArray(sets) ? sets.filter(Boolean) : [];
};

const normalizeWeightUnit = (unit) => {
    const value = String(unit || "kg").toLowerCase();
    if (value === "lbs" || value === "lb" || value === "pound" || value === "pounds") return "lb";
    if (value === "bw" || value === "bodyweight") return "BW";
    return "kg";
};

const formatWeightUnit = (unit) => {
    const normalized = normalizeWeightUnit(unit);
    if (normalized === "lb") return "lb";
    if (normalized === "BW") return "自重";
    return "kg";
};

const normalizeSetWeightMode = (unit) => {
    const normalized = normalizeWeightUnit(unit);
    if (normalized === "lb") return "lbs";
    return normalized;
};

const getSetWeightMode = (set, fallbackUnit = "kg") =>
    normalizeSetWeightMode(
        set?.weightMode
        || set?.weightType
        || set?.displayUnit
        || set?.unit
        || set?.weightUnit
        || set?.weight_unit
        || fallbackUnit
    );

const getSetDisplayUnit = (set, fallbackUnit = "kg") => {
    const mode = getSetWeightMode(set, fallbackUnit);
    return mode === "lbs" ? "lb" : mode;
};

const getSetStoredWeightKg = (set, fallbackUnit = "kg") => {
    const mode = getSetWeightMode(set, fallbackUnit);
    if (mode === "BW" || String(set?.weight || "").toUpperCase() === "BW") return "BW";
    return storeW(set?.weight, mode);
};

const formatConvertedWeight = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value || "");
    const rounded = Math.round(num * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const convertWeightToTargetUnit = (set, targetUnit, fallbackUnit = "kg") => {
    const rawWeight = String(set?.displayWeight ?? set?.weight ?? "").trim();
    if (!rawWeight) return "";
    if (rawWeight.toUpperCase() === "BW") return "自重";

    const weightNum = Number(rawWeight);
    if (!Number.isFinite(weightNum)) return rawWeight;

    const sourceUnit = normalizeWeightUnit(set?.displayUnit || set?.unit || set?.weightUnit || set?.weight_unit || fallbackUnit);
    const normalizedTargetUnit = normalizeWeightUnit(targetUnit);

    if (normalizedTargetUnit === "BW") {
        return `${formatConvertedWeight(weightNum)}${formatWeightUnit(sourceUnit)}`;
    }

    let converted = weightNum;
    if (sourceUnit === "kg" && normalizedTargetUnit === "lb") {
        converted = weightNum * 2.20462;
    } else if (sourceUnit === "lb" && normalizedTargetUnit === "kg") {
        converted = weightNum / 2.20462;
    }

    return `${formatConvertedWeight(converted)}${formatWeightUnit(normalizedTargetUnit)}`;
};

const normalizeDurationSec = (value) => {
    const durationSec = Math.floor(Number(value) || 0);
    if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
    if (durationSec > MAX_REASONABLE_DURATION_SEC) return 0;
    return durationSec;
};

const normalizeDurationMinutesAsSec = (value) => {
    const durationMinutes = Number(value);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
    if (durationMinutes > MAX_REASONABLE_DURATION_SEC / 60) return 0;
    return Math.floor(durationMinutes * 60);
};

const getHistoryDurationSecForDate = (history, date) => {
    const normalizedDate = String(date || "").slice(0, 10);
    if (!normalizedDate) return 0;

    let durationSec = 0;
    Object.values(history || {}).forEach((records) => {
        (records || []).forEach((record) => {
            if (String(record?.date || "").slice(0, 10) !== normalizedDate) return;
            const recordDurationSec = [
                record?.durationSec,
                record?.duration_sec,
            ].map(normalizeDurationSec).find((value) => value > 0)
                || [
                    record?.durationMinutes,
                    record?.elapsedMinutes,
                ].map(normalizeDurationMinutesAsSec).find((value) => value > 0)
                || 0;
            durationSec = Math.max(durationSec, recordDurationSec);
        });
    });

    return durationSec;
};


export default function LogScreen({
    manualBests = [],
    customBodyParts = [],
    hiddenBodyParts = [],
    onAddCustomBodyPart,
    onUpdateHiddenBodyParts,
    todayLabels,
    exercises, logData, getExSets, setField, setWeightMode, addSet, removeEx,
    onAddEx, onQuickAddEx, onReorderEx, onRenameEx, getPrev, getPR, getPreviousPR, onCopyDown, onCopyDownReps, unit = "kg",
    getExUnit, setTodayLabels, history, logDate, resetSession, muscleEx,
    workoutElapsedSec = 0,
    workoutTimerStatus = "idle",
    onFinishWorkoutTimer,
    onSetInputFocusChange,
}) {

    const hasExercises = exercises.length > 0;
    const softBorderColor = "var(--border2)";
    const subActionBg = "var(--btn-secondary)";
    const subActionText = "var(--accent)";

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

    const setCountByBodyPart = getSetCountByBodyPart(
        exercises.map((exercise) => {
            const sets = logData[exercise.name] || getExSets(exercise);

            // 記録中サマリーは古い exercise.bodyPart を信用しすぎない
            // 現在の種目名・label を優先して、過去に残った部位ラベル混入を防ぐ
            const bodyPart =
                exercise.label ||
                exercise.currentBodyPart ||
                exercise.displayBodyPart ||
                "その他";

            return {
                bodyPart,
                exerciseName: exercise.name,
                sets,
            };
        }),
        { sort: "fixed" }
    );



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
            const w = Number(getSetStoredWeightKg(s, exUnit));
            const r = Number(s.reps);
            return Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0;
        }).map((s) => ({
            ...s,
            weight: getSetStoredWeightKg(s, exUnit),
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
    const shareDurationSec = Math.max(
        Math.floor(Number(workoutElapsedSec) || 0),
        getHistoryDurationSecForDate(history, logDate)
    );
    const rawSessionSharePayload = buildWorkoutSessionPayloadFromDraft({
        exercises,
        logData,
        getExUnit,
        workoutDate: logDate,
        durationSec: shareDurationSec,
    });
    const sessionSharePayload = rawSessionSharePayload
        ? {
            ...rawSessionSharePayload,
            session: {
                ...rawSessionSharePayload.session,
                summary_json: {
                    ...(rawSessionSharePayload.session?.summary_json || {}),
                    prCount,
                },
            },
        }
        : null;
    const confirmEdit = (ex) => {
        const trimmed = editingName.trim();
        if (trimmed && trimmed !== ex) onRenameEx(ex.id, trimmed);
        setEditingId(null);
    };
    const formatDate = (d) =>
        `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

    // 今日のタイトルは現在の種目から毎回再生成する
    // 古い todayLabels の残留を防ぐ
    const currentBodyParts = [
        ...new Set(
            setCountByBodyPart
                .map((x) => x.bodyPart)
                .filter(Boolean)
        )
    ];

    const title = currentBodyParts.length
        ? currentBodyParts.join(" + ")
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
        <div className="fade-in" style={{ ...S.page, paddingBottom: "calc(var(--bottom-nav-clearance) + 56px)" }}>
            <div style={{ ...S.subtleCard, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2.5, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }}>{title}</div>
                            {title !== formatDate(logDate) && (
                                <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 900, marginTop: 3 }}>{formatDate(logDate)}</div>
                            )}
                        </div>
                    </div>
                    <WorkoutElapsedTimer
                        elapsedSec={workoutElapsedSec}
                        status={workoutTimerStatus}
                        onClick={workoutTimerStatus === "active" ? () => setShowWorkoutTimerMenu(true) : undefined}
                    />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    {[
                        ...setCountByBodyPart.map((item) => `${item.bodyPart} ${item.count}セット`),
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
                            padding: "9px 12px",
                            borderRadius: 12,
                            border: `1px solid ${softBorderColor}`,
                            background: subActionBg,
                            color: subActionText,
                            fontSize: 12,
                            fontWeight: 800,
                        }}
                    >
                        今日の記録をシェア
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
                        const previousSets = getPreviousRecordSets(prev);
                        const previousUnit = prev?.displayUnit || prev?.unit || prev?.weightUnit || prev?.weight_unit || "kg";
                        const pr = getPreviousPR ? getPreviousPR(ex, { excludeDate: logDate }) : (getPR ? getPR(ex) : null);
                        const exUnit = getExUnit ? getExUnit(ex.name) : unit;
                        const exerciseBodyPartLabel = ex.bodyPart || ex.label || ex.target || "";
                        const prIsAlsoPrev = pr && prev && pr.date === prev.date;

                        const doneSets = sets.filter(s => {
                            const w = Number(getSetStoredWeightKg(s, exUnit));
                            const r = Number(s.reps);
                            return Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0;
                        }).map(s => ({
                            ...s,
                            weight: getSetStoredWeightKg(s, exUnit)
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
                        const prTopSetLabel = prTopSet
                            ? (normalizeWeightUnit(exUnit) === "BW"
                                ? "自重"
                                : convertWeightToTargetUnit(prTopSet, exUnit, pr?.displayUnit || pr?.unit || pr?.weightUnit || pr?.weight_unit || "kg"))
                            : "";

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
                                    <div style={{ background: "var(--card)", borderRadius: 22, padding: "16px", marginBottom: 12, border: `1px solid ${isPR ? "var(--success-border)" : softBorderColor}`, boxShadow: isPR ? "var(--shadow-soft)" : "var(--shadow-card)" }}>

                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                            <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                                                {isEditing ? (
                                                    <input
                                                        ref={editRef}
                                                        value={typeof editingName === "string" ? editingName : editingName?.name || ""}
                                                        onChange={e => setEditingName(e.target.value)}
                                                        onBlur={() => confirmEdit(ex)}
                                                        onKeyDown={e => { if (e.key === "Enter") confirmEdit(ex); if (e.key === "Escape") setEditingId(null); }}
                                                        style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid var(--text2)", color: "var(--text)", fontSize: 18, fontWeight: 900, padding: "2px 0" }}
                                                    />
                                                ) : (
                                                    <div>
                                                        <div onClick={() => startEdit(ex)} style={{ fontSize: 19, fontWeight: 900, cursor: "text", color: "var(--text)", lineHeight: 1.25 }}>
                                                            {ex.name}
                                                        </div>
                                                        {exerciseBodyPartLabel && (
                                                            <div style={{ marginTop: 5, fontSize: 12, color: "var(--text2)", fontWeight: 800 }}>
                                                                {exerciseBodyPartLabel}
                                                            </div>
                                                        )}
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
                                            <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--card2)", borderRadius: 16, border: `1px solid ${softBorderColor}` }}>
                                                {prev && (
                                                    <>
                                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                                            <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 800 }}>前回 <span style={{ color: "var(--text3)" }}>{prev.date}</span></div>
                                                            {isPR && <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 900 }}>PR更新！</div>}
                                                        </div>
                                                    </>
                                                )}
                                                {pr && !prIsAlsoPrev && (
                                                    <div style={{ marginTop: prev ? 7 : 0, paddingTop: prev ? 7 : 0, borderTop: prev ? "1px solid var(--border2)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                        <div style={{ fontSize: 11, color: "var(--text2)" }}>🏆 PR <span style={{ color: "var(--text3)", fontWeight: 400 }}>{pr.date}</span></div>
                                                        <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text3)" }}>
                                                            {prTopSet ? `${prTopSetLabel} × ${prTopSet.reps}rep` : `${dispW(roundTo1Decimal(pr.rm), exUnit)}${formatWeightUnit(exUnit)}`}
                                                        </div>
                                                    </div>
                                                )}
                                                {pr && prIsAlsoPrev && (
                                                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--text2)" }}>
                                                        🏆 前回がPR（{prTopSet ? `${prTopSetLabel}×${prTopSet.reps}rep` : `${dispW(roundTo1Decimal(pr.rm), exUnit)}${formatWeightUnit(exUnit)}`}）
                                                    </div>
                                                )}
                                                {isPR && prDiff > 0 && (
                                                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--accent)", fontWeight: 900 }}>
                                                        PR更新！ +{prDiff.toFixed(1)}kg
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {sets.map((set, idx) => (
                                            <SetRow
                                                key={idx}
                                                ex={ex}
                                                set={set}
                                                idx={idx}
                                                setField={setField}
                                                onWeightModeChange={(mode) => setWeightMode(ex, idx, mode)}
                                                onSetInputFocusChange={onSetInputFocusChange}
                                                inputId={`${ex.id || ex.name}-${idx}`}
                                                previousSet={previousSets[idx]}
                                                previousUnit={previousSets[idx]?.displayUnit || previousSets[idx]?.unit || previousSets[idx]?.weightUnit || previousSets[idx]?.weight_unit || previousUnit}
                                                unit={getSetDisplayUnit(set, exUnit)}
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
                                                    background: subActionBg,
                                                    border: `1px solid ${softBorderColor}`,
                                                    color: subActionText,
                                                    fontSize: 14,
                                                    fontWeight: 900,
                                                    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.18)",
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
                style={{ position: "fixed", bottom: 154, left: 20, width: 54, height: 54, borderRadius: 27, background: "linear-gradient(135deg, rgba(15, 94, 99, 0.96), rgba(18, 169, 164, 0.90))", color: "#fff", fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 20px rgba(15, 94, 99, 0.18)", border: "1px solid rgba(18, 199, 194, 0.40)", zIndex: 101 }}>
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
