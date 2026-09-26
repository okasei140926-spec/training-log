import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calc1RM, getBestRmSet, getRecordSourceSets, hasMeaningfulPRIncrease, isCompletedWorkoutSet, PR_UPDATE_TOLERANCE_KG, storeW } from "../utils/helpers";
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

const getExerciseDisplayUnit = (sets = [], fallbackUnit = "kg") => {
    const fallback = normalizeWeightUnit(fallbackUnit);
    const counts = { kg: 0, lb: 0, BW: 0 };

    (Array.isArray(sets) ? sets : []).forEach((set) => {
        const unit = getSetDisplayUnit(set, fallback);
        const normalized = normalizeWeightUnit(unit);
        if (counts[normalized] !== undefined) counts[normalized] += 1;
    });

    if (counts.lb > counts.kg && counts.lb >= counts.BW) return "lb";
    if (counts.kg > 0) return "kg";
    if (counts.lb > 0) return "lb";
    if (counts.BW > 0) return "BW";
    return fallback;
};

const convertKgValueForDisplayUnit = (valueKg, targetUnit) => {
    const num = Number(valueKg);
    if (!Number.isFinite(num) || num <= 0) return 0;
    const normalizedTargetUnit = normalizeWeightUnit(targetUnit);
    if (normalizedTargetUnit === "lb") return num * 2.20462;
    if (normalizedTargetUnit === "kg") return num;
    return 0;
};

// ── 次の種目サジェスト ──────────────────────────────────────────────────────────
/**
 * 種目名の実際の部位を history と muscleEx から解決する。
 * getPrev() の bodyPart 完全一致を通過させるために必要。
 */
const resolveExerciseBodyPartFromData = (name, history, muscleEx) => {
    // 1. 最新の履歴レコードの bodyPart を使う（最も信頼性が高い）
    const records = history?.[name];
    if (records?.length) {
        // records は日付順不定なので、bodyPart が取れる最初のものを使う
        for (const rec of records) {
            const bp = String(rec?.bodyPart || "").trim();
            if (bp) return bp;
        }
    }
    // 2. muscleEx を逆引き
    for (const [bp, exs] of Object.entries(muscleEx || {})) {
        if ((exs || []).some((e) => e.name === name)) return bp;
    }
    return null;
};

/**
 * 過去の記録から「種目Aの直後に記録された種目B」の頻度マップを構築する。
 * @returns {{ [nameA: string]: { [nameB: string]: number } }}
 */
const buildNextExerciseMap = (history) => {
    const byDate = {};
    Object.entries(history || {}).forEach(([name, records]) => {
        (records || []).forEach((rec) => {
            const date = String(rec?.date || "").slice(0, 10);
            if (!date) return;
            if (!byDate[date]) byDate[date] = [];
            byDate[date].push({
                name,
                order: Number.isFinite(Number(rec?.order)) ? Number(rec.order) : Infinity,
            });
        });
    });
    const nextMap = {};
    Object.values(byDate).forEach((exs) => {
        const sorted = [...exs].sort((a, b) => a.order - b.order);
        for (let i = 0; i < sorted.length - 1; i++) {
            const a = sorted[i].name;
            const b = sorted[i + 1].name;
            if (a === b) continue;
            if (!nextMap[a]) nextMap[a] = {};
            nextMap[a][b] = (nextMap[a][b] || 0) + 1;
        }
    });
    return nextMap;
};

// ── オートプログレッション（ダブルプログレッション法） ────────────────────────
const PROG_REP_MAX = 12;   // この回数に達したら重量アップ
const PROG_REP_MIN = 8;    // 重量アップ後の目標レップ数
const PROG_WEIGHT_INC_KG = 2.5; // 重量アップ幅（kg）

/**
 * 前回のセット群からオートプログレッションの目標を計算する。
 * @returns {{ weightDisplay: string, unit: string, reps: number } | null}
 */
const calcProgressionTarget = (prevSets, prevUnit, dispUnit) => {
    if (!prevSets?.length) return null;
    // 重量セット: 推定1RM（Epley式: weight×(1+reps/30)）最大を基準（同率は高重量優先）
    // 自重セット: 最大回数を記録
    // 判定: 重量セットが1件でもあれば重量ベース優先。重量セット0件かつ自重セットあり → 自重ベース
    let refWKg = null;
    let refReps = null;
    let maxE1rm = -Infinity;
    let maxBWReps = 0;

    for (const s of prevSets) {
        const wKgRaw = getSetStoredWeightKg(s, prevUnit || "kg");
        const r = Number(s?.reps ?? 0);
        if (r <= 0) continue;

        if (wKgRaw === "BW") {
            if (r > maxBWReps) maxBWReps = r;
        } else if (Number.isFinite(Number(wKgRaw)) && Number(wKgRaw) > 0) {
            const wKg = Number(wKgRaw);
            const e1rm = wKg * (1 + r / 30);
            if (e1rm > maxE1rm || (e1rm === maxE1rm && wKg > refWKg)) {
                maxE1rm = e1rm;
                refWKg = wKg;
                refReps = r;
            }
        }
    }

    // 重量ベース
    if (refWKg !== null) {
        let targetWKg, targetReps;
        if (refReps < PROG_REP_MAX) {
            targetWKg = refWKg;
            targetReps = refReps + 1;
        } else {
            targetWKg = refWKg + PROG_WEIGHT_INC_KG;
            targetReps = PROG_REP_MIN;
        }
        const normalizedUnit = normalizeWeightUnit(dispUnit || "kg");
        const targetWeightDisplay = formatConvertedWeight(convertKgValueForDisplayUnit(targetWKg, normalizedUnit));
        const unitLabel = formatWeightUnit(normalizedUnit);
        return { weightDisplay: targetWeightDisplay, unit: unitLabel, reps: targetReps };
    }

    // 自重ベース（最大回数 + 1）
    if (maxBWReps > 0) {
        return { weightDisplay: "自重", unit: "", reps: maxBWReps + 1 };
    }

    return null;
};

const DEFAULT_SET_COUNT = 3;

const getLastMenuFromHistory = (historyMap, currentDate) => {
    if (!historyMap || !currentDate) return [];

    const byDate = new Map(); // date → [{name, label, order, setCount}]

    Object.entries(historyMap).forEach(([exerciseName, records]) => {
        (records || []).forEach((record) => {
            const date = String(record?.date || "").slice(0, 10);
            if (!date || date >= currentDate) return;
            if (!byDate.has(date)) byDate.set(date, []);
            byDate.get(date).push({
                name: exerciseName,
                label: record?.bodyPart || record?.label || "その他",
                order: record?.order ?? 999,
                setCount: Math.max(1, (getRecordSourceSets(record) || []).length),
            });
        });
    });

    if (!byDate.size) return [];

    const previousDate = [...byDate.keys()].sort().reverse()[0];
    const seen = new Set();
    return (byDate.get(previousDate) || [])
        .sort((a, b) => a.order - b.order)
        .filter(({ name }) => {
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
        });
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
    exercises, logData, getExSets, setField, setWeightMode, addSet, removeSet, removeEx,
    onAddEx, onQuickAddEx, onReorderEx, onRenameEx, getPrev, getPR, getPreviousPR, onCopyDown, onCopyDownReps, unit = "kg",
    getExUnit, setTodayLabels, history, logDate, resetSession, muscleEx,
    customExercisesByBodyPart = {},
    onSaveCustomExercise,
    onBulkSaveCustomExercises,
    workoutElapsedSec = 0,
    workoutTimerStatus = "idle",
    onFinishWorkoutTimer,
    onSetInputFocusChange,
    focusExerciseRequest,
    onFocusExerciseHandled,
    lastActiveExercise,
    onActiveExerciseChange,
    // AI plan banner
    planDayInfo = null,
    onLoadPlanDay,
    onSelfMadeToday,
    selfMadeConsecutiveCount = 0,
    aiPlanEnabled = true,
    planBannerDismissedForDate = null,
    // Finish-workout button
    onFinishWorkout,
    onUnfinishWorkout,
    isAiPlanDay = false,
}) {

    const COMPLETED_WORKOUT_DATES_KEY = "pump_completed_workout_dates";

    const readCompletedDates = () => {
        try { return JSON.parse(localStorage.getItem(COMPLETED_WORKOUT_DATES_KEY) || "{}"); }
        catch { return {}; }
    };

    const hasExercises = exercises.length > 0;
    const [bannerExpanded, setBannerExpanded] = useState(false);
    const [workoutFinished, setWorkoutFinished] = useState(() => Boolean(readCompletedDates()[logDate]));
    const [showFinishSummary, setShowFinishSummary] = useState(false);

    const [memos, setMemos] = useState(() => {
        try { return JSON.parse(localStorage.getItem("pump_exercise_memos") || "{}"); }
        catch { return {}; }
    });
    const [memoOpenId, setMemoOpenId] = useState(null);

    const saveMemo = useCallback((exerciseName, text) => {
        setMemos(prev => {
            const next = text.trim()
                ? { ...prev, [exerciseName]: text }
                : (({ [exerciseName]: _removed, ...rest }) => rest)(prev);
            localStorage.setItem("pump_exercise_memos", JSON.stringify(next));
            return next;
        });
    }, []);

    // Sync workoutFinished state when logDate changes
    useEffect(() => {
        setWorkoutFinished(Boolean(readCompletedDates()[logDate]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logDate]);

    const previousMenu = useMemo(
        () => getLastMenuFromHistory(history, logDate),
        [history, logDate]
    );

    const handleLoadPreviousMenu = useCallback(() => {
        previousMenu.forEach(({ name, label, setCount }) => {
            onQuickAddEx(name, false, label, { action: "load_previous_menu" });
            for (let i = DEFAULT_SET_COUNT; i < setCount; i++) {
                addSet({ name });
            }
        });
    }, [addSet, onQuickAddEx, previousMenu]);

    const softBorderColor = "var(--border2)";
    const subActionBg = "var(--btn-secondary)";
    const subActionText = "var(--accent)";

    const [showAdd, setShowAdd] = useState(false);
    const [addName, setAddName] = useState("");
    const [reorderMenuId, setReorderMenuId] = useState(null);
    // 次の種目サジェスト：どの種目を基準にしたサジェストを閉じたか
    const [dismissedSuggestForEx, setDismissedSuggestForEx] = useState(null);


    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState("");
    const [activeExIdx, setActiveExIdx] = useState(0);
    const [historyTarget, setHistoryTarget] = useState(null);
    const [showSessionShare, setShowSessionShare] = useState(false);
    const [showWorkoutTimerMenu, setShowWorkoutTimerMenu] = useState(false);
    const editRef = useRef(null);
    const previousExerciseIdsRef = useRef(exercises.map((ex) => ex.id));
    const firstAddedDuringAddModalRef = useRef(null);
    const exerciseCardRefs = useRef(new Map());
    const [pendingScrollExerciseId, setPendingScrollExerciseId] = useState(null);
    const compactIconButtonStyle = {
        width: 34,
        height: 32,
        minWidth: 34,
        borderRadius: 10,
        background: "transparent",
        border: "1px solid transparent",
        color: "var(--text3)",
        fontSize: 16,
        fontWeight: 900,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
    };
    const compactTextButtonStyle = {
        minHeight: 32,
        padding: "0 9px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 800,
        border: `1px solid ${softBorderColor}`,
        background: "transparent",
        color: "var(--text2)",
    };

    const setExerciseCardRef = (exerciseId) => (node) => {
        if (!exerciseId) return;
        if (node) {
            exerciseCardRefs.current.set(exerciseId, node);
        } else {
            exerciseCardRefs.current.delete(exerciseId);
        }
    };

    const notifyActiveExercise = useCallback((exercise) => {
        if (exercise?.id || exercise?.name) onActiveExerciseChange?.(exercise);
    }, [onActiveExerciseChange]);

    const openExerciseById = useCallback((exerciseId, { scroll = true } = {}) => {
        const targetIndex = exercises.findIndex((exercise) => exercise.id === exerciseId);
        if (targetIndex < 0) return false;
        setActiveExIdx(targetIndex);
        notifyActiveExercise(exercises[targetIndex]);
        if (scroll) setPendingScrollExerciseId(exerciseId);
        return true;
    }, [exercises, notifyActiveExercise]);

    const openExerciseAtIndex = useCallback((index, { scroll = false } = {}) => {
        if (index < 0 || index >= exercises.length) return false;
        const targetExercise = exercises[index];
        setActiveExIdx(index);
        notifyActiveExercise(targetExercise);
        if (scroll) setPendingScrollExerciseId(targetExercise.id);
        return true;
    }, [exercises, notifyActiveExercise]);

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
        notifyActiveExercise(ex);
        setEditingId(ex.id);
        setEditingName(ex.name);
        setTimeout(() => editRef.current?.focus(), 30);
    };

    const setCount = exercises.reduce((acc, ex) => {
        const sets = logData[ex.name] || getExSets(ex);
        return acc + sets.filter((s) => isCompletedWorkoutSet(s)).length;
    }, 0);
    const { prCount, totalVolumeKg, prExerciseNames } = exercises.reduce((acc, ex) => {
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
            prExerciseNames: isPR ? [...acc.prExerciseNames, ex.name] : acc.prExerciseNames,
        };
    }, { prCount: 0, totalVolumeKg: 0, prExerciseNames: [] });
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

    const historyTargetCurrentSets = historyTarget
        ? (logData?.[historyTarget] || getExSets?.(exercises.find((e) => e.name === historyTarget)) || [])
            .map((set) => {
                if (historyTargetUnit !== "lbs" || !set.weight || String(set.weight).toUpperCase() === "BW") return set;
                return { ...set, weight: storeW(set.weight, "lbs") };
            })
        : [];

    useEffect(() => {
        if (!exercises.some((ex) => ex.id === reorderMenuId)) {
            setReorderMenuId(null);
        }
    }, [exercises, reorderMenuId]);

    useEffect(() => {
        if (!showAdd) firstAddedDuringAddModalRef.current = null;
    }, [showAdd]);

    const hasEditedSets = useCallback((exercise) => {
        const sets = logData[exercise.name] || getExSets(exercise);
        return (sets || []).some((set) => {
            const weight = String(set?.weight ?? "").trim();
            const reps = String(set?.reps ?? "").trim();
            return Boolean(weight || reps);
        });
    }, [getExSets, logData]);

    useEffect(() => {
        if (!exercises.length) return;

        const rememberedExercise = lastActiveExercise
            ? exercises.find((exercise) =>
                exercise.id === lastActiveExercise.id ||
                exercise.name === lastActiveExercise.name
            )
            : null;

        if (rememberedExercise) {
            openExerciseById(rememberedExercise.id, { scroll: false });
            return;
        }

        const lastEditedIndex = [...exercises]
            .map((exercise, index) => ({ exercise, index }))
            .reverse()
            .find(({ exercise }) => hasEditedSets(exercise))?.index;

        if (Number.isInteger(lastEditedIndex)) {
            openExerciseAtIndex(lastEditedIndex, { scroll: false });
            return;
        }

        openExerciseAtIndex(0, { scroll: false });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const previousIds = previousExerciseIdsRef.current || [];
        const previousIdSet = new Set(previousIds);
        const addedExercises = exercises.filter((exercise) => !previousIdSet.has(exercise.id));
        previousExerciseIdsRef.current = exercises.map((exercise) => exercise.id);

        if (!addedExercises.length) {
            if (activeExIdx >= exercises.length) {
                setActiveExIdx(Math.max(0, exercises.length - 1));
            }
            return;
        }

        const firstModalAddedName = firstAddedDuringAddModalRef.current;
        const targetExercise =
            (firstModalAddedName && exercises.find((exercise) => exercise.name === firstModalAddedName)) ||
            addedExercises[0];

        if (!targetExercise) return;
        const targetIndex = exercises.findIndex((exercise) => exercise.id === targetExercise.id);
        if (targetIndex < 0) return;
        setActiveExIdx(targetIndex);
        notifyActiveExercise(targetExercise);
        setPendingScrollExerciseId(targetExercise.id);
    }, [activeExIdx, exercises, notifyActiveExercise]);

    useEffect(() => {
        if (!focusExerciseRequest) return;
        const targetExercise = exercises.find((exercise) =>
            exercise.id === focusExerciseRequest.id ||
            exercise.name === focusExerciseRequest.name
        );

        if (targetExercise) {
            openExerciseById(targetExercise.id);
        }
        onFocusExerciseHandled?.(focusExerciseRequest);
    }, [exercises, focusExerciseRequest, onFocusExerciseHandled, openExerciseById]);

    useEffect(() => {
        if (!pendingScrollExerciseId) return;
        const timeoutId = window.setTimeout(() => {
            const node = exerciseCardRefs.current.get(pendingScrollExerciseId);
            node?.scrollIntoView?.({ behavior: "smooth", block: "start", inline: "nearest" });
            setPendingScrollExerciseId(null);
        }, 120);

        return () => window.clearTimeout(timeoutId);
    }, [pendingScrollExerciseId, activeExIdx]);

    const handleAddConfirm = () => {
        const trimmed = addName.trim();
        if (trimmed && !firstAddedDuringAddModalRef.current) {
            firstAddedDuringAddModalRef.current = trimmed;
        }
        onAddEx(addName);
        setAddName("");
    };

    const handleQuickAdd = (name, remove, labelOverride, options) => {
        if (!remove && name && !firstAddedDuringAddModalRef.current) {
            firstAddedDuringAddModalRef.current = name;
        }
        onQuickAddEx(name, remove, labelOverride, options);
    };

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

            {/* AI Plan Banner */}
            {aiPlanEnabled && planDayInfo && !planDayInfo.completed && planBannerDismissedForDate !== logDate && (() => {
                const collapsed = selfMadeConsecutiveCount >= 3 && !bannerExpanded;
                if (collapsed) {
                    return (
                        <button
                            type="button"
                            onClick={() => setBannerExpanded(true)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                background: "rgba(18,199,194,0.07)",
                                border: "1px solid rgba(18,199,194,0.18)",
                                borderRadius: 12,
                                padding: "8px 14px",
                                color: "var(--accent)",
                                fontSize: 13,
                                fontWeight: 700,
                                cursor: "pointer",
                                alignSelf: "flex-start",
                            }}
                        >
                            💡 AIプランを見る ›
                        </button>
                    );
                }
                return (
                    <div style={{
                        background: "rgba(18,199,194,0.07)",
                        border: "1px solid rgba(18,199,194,0.18)",
                        borderRadius: 16,
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 14 }}>💡</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", letterSpacing: 0.5 }}>
                                今日のAIプラン
                            </span>
                        </div>
                        <div>
                            <span style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>
                                {planDayInfo.label}
                            </span>
                            <span style={{ fontSize: 13, color: "var(--text2)", marginLeft: 8 }}>
                                {(planDayInfo.bodyParts || []).join(" · ")}
                            </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <button
                                type="button"
                                onClick={() => {
                                    setBannerExpanded(false);
                                    onLoadPlanDay?.(planDayInfo.bodyParts);
                                }}
                                style={{
                                    background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                                    border: "none",
                                    borderRadius: 12,
                                    padding: "10px 18px",
                                    color: "#fff",
                                    fontSize: 13,
                                    fontWeight: 800,
                                    cursor: "pointer",
                                }}
                            >
                                このメニューで記録する
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setBannerExpanded(false);
                                    onSelfMadeToday?.();
                                }}
                                style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--text3)",
                                    fontSize: 13,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    padding: "10px 4px",
                                }}
                            >
                                自分で組む ›
                            </button>
                        </div>
                    </div>
                );
            })()}

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
                    {previousMenu.length > 0 && (
                        <button
                            type="button"
                            onClick={handleLoadPreviousMenu}
                            style={{
                                marginTop: 8,
                                padding: "11px 20px",
                                borderRadius: 14,
                                border: `1px solid ${softBorderColor}`,
                                background: subActionBg,
                                color: subActionText,
                                fontSize: 14,
                                fontWeight: 800,
                            }}
                        >
                            前回のメニューを読み込む
                        </button>
                    )}
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
                        const displayUnit = getExerciseDisplayUnit(sets, exUnit);
                        const progressionTarget = calcProgressionTarget(previousSets, previousUnit, displayUnit);

                        const completedSetEntries = sets.map((s) => {
                            const w = Number(getSetStoredWeightKg(s, exUnit));
                            const r = Number(s.reps);
                            if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return null;
                            const normalizedSet = {
                                ...s,
                                weight: w,
                                displayWeight: s.displayWeight ?? s.weight,
                                displayUnit: getSetDisplayUnit(s, exUnit),
                            };
                            return {
                                sourceSet: s,
                                normalizedSet,
                                rm: calc1RM([normalizedSet]),
                            };
                        }).filter(Boolean);
                        const doneSets = completedSetEntries.map((entry) => entry.normalizedSet);
                        const currentTopSetEntry = completedSetEntries.reduce((best, entry) => {
                            if (!best || entry.rm > best.rm) return entry;
                            return best;
                        }, null);
                        const currentTopDisplayUnit = currentTopSetEntry
                            ? getSetDisplayUnit(currentTopSetEntry.sourceSet, displayUnit)
                            : displayUnit;

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
                        const prDiffDisplay = prDiff > 0
                            ? roundTo1Decimal(convertKgValueForDisplayUnit(prDiff, currentTopDisplayUnit))
                            : 0;

                        const isPR = hasMeaningfulPRIncrease(doneSets, prSets, pr1RM, PR_UPDATE_TOLERANCE_KG);

                        // PR の実際のトップセット（1RM換算が最大のセット）
                        const prTopSet = getBestRmSet(pr?.sets, { allowBodyweight: false });
                        const prTopSetLabel = prTopSet
                            ? (normalizeWeightUnit(displayUnit) === "BW"
                                ? "自重"
                                : convertWeightToTargetUnit(prTopSet, displayUnit, pr?.displayUnit || pr?.unit || pr?.weightUnit || pr?.weight_unit || "kg"))
                            : "";
                        const compactPrLabel = prTopSet
                            ? `PR ${prTopSetLabel} × ${prTopSet.reps}`
                            : pr
                                ? `PR ${formatConvertedWeight(convertKgValueForDisplayUnit(roundTo1Decimal(pr.rm), displayUnit))}${formatWeightUnit(displayUnit)}`
                                : "";

                        if (i !== activeExIdx) {
                            const doneSetsCount = sets.filter((s) => isCompletedWorkoutSet(s)).length;

                            return (
                                <SortableExerciseItem key={ex.id} id={ex.id}>
                                    {() => (
                                        <div ref={setExerciseCardRef(ex.id)}>
                                            <div
                                                onClick={() => openExerciseAtIndex(i)}
                                                style={{
                                                    background: "var(--card)",
                                                    borderRadius: 20,
                                                    padding: "10px 14px",
                                                    marginBottom: 10,
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
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontSize: 15, fontWeight: 850, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {ex.name}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
                                                        {doneSetsCount > 0 ? `${doneSetsCount}セット完了` : "未入力"}
                                                    </div>
                                                </div>

                                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setReorderMenuId((prev) => (prev === ex.id ? null : ex.id));
                                                        }}
                                                        style={{
                                                            ...compactIconButtonStyle,
                                                            color: "var(--text3)",
                                                        }}
                                                        aria-label="並べ替え"
                                                    >
                                                        ⋮⋮
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
                                        </div>
                                    )}
                                </SortableExerciseItem>
                            );
                        }

                        return (
                            <SortableExerciseItem key={ex.id} id={ex.id}>
                                {() => (
                                    <div ref={setExerciseCardRef(ex.id)} style={{ background: "var(--card)", borderRadius: 20, padding: "12px", marginBottom: 10, border: `1px solid ${isPR ? "var(--success-border)" : softBorderColor}`, boxShadow: isPR ? "var(--shadow-soft)" : "var(--shadow-card)" }}>

                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
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
                                                        <div onClick={() => startEdit(ex)} style={{ fontSize: 18, fontWeight: 900, cursor: "text", color: "var(--text)", lineHeight: 1.22, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                                                            {ex.name}
                                                        </div>
                                                        {(compactPrLabel || (isPR && prDiff > 0)) && (
                                                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                                                                {compactPrLabel && (
                                                                    <span style={{ fontSize: 11, color: "var(--text2)", fontWeight: 800, lineHeight: 1.2 }}>
                                                                        🏆 {compactPrLabel}
                                                                    </span>
                                                                )}
                                                                {isPR && prDiff > 0 && (
                                                                    <span style={{
                                                                        display: "inline-flex",
                                                                        alignItems: "center",
                                                                        padding: "3px 8px",
                                                                        borderRadius: 999,
                                                                        background: "linear-gradient(135deg, rgba(234,179,8,0.18), rgba(18,199,194,0.14))",
                                                                        border: "1px solid rgba(234,179,8,0.4)",
                                                                        boxShadow: "0 2px 8px rgba(234,179,8,0.18)",
                                                                        fontSize: 12,
                                                                        fontWeight: 800,
                                                                        color: "#FACC15",
                                                                        lineHeight: 1.2,
                                                                        animation: "prBadgeIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
                                                                    }}>
                                                                        PR更新 +{prDiffDisplay.toFixed(1)}{formatWeightUnit(currentTopDisplayUnit)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {/* オートプログレッション：今日のチャレンジ */}
                                                {progressionTarget && (
                                                    <div style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        marginTop: 6,
                                                        padding: "3px 9px",
                                                        borderRadius: 999,
                                                        background: "rgba(18,199,194,0.08)",
                                                        border: "1px solid rgba(18,199,194,0.22)",
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        color: "var(--accent)",
                                                        opacity: 0.85,
                                                        letterSpacing: 0.1,
                                                    }}>
                                                        🎯 今日のチャレンジ&nbsp;{progressionTarget.weightDisplay}{progressionTarget.unit} × {progressionTarget.reps}回
                                                    </div>
                                                )}
                                            </div>

                                            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setReorderMenuId((prev) => (prev === ex.id ? null : ex.id));
                                                    }}
                                                    style={{
                                                        ...compactIconButtonStyle,
                                                    }}
                                                    aria-label="並べ替え"
                                                >
                                                    ⋮⋮
                                                </button>

                                                <button
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setHistoryTarget(ex.name);
                                                    }}
                                                    style={compactTextButtonStyle}
                                                >
                                                    履歴
                                                </button>
                                                <button
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setMemoOpenId(id => id === ex.id ? null : ex.id);
                                                    }}
                                                    style={{
                                                        ...compactTextButtonStyle,
                                                        color: memos[ex.name] ? "var(--accent)" : "var(--text2)",
                                                        borderColor: memos[ex.name] ? "var(--accent)" : softBorderColor,
                                                    }}
                                                >
                                                    メモ
                                                </button>
                                                <button onClick={() => removeEx(ex.id, ex.name)} style={{ ...compactIconButtonStyle, color: "var(--text2)", borderColor: softBorderColor }}>×</button>
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

                                        {sets.map((set, idx) => (
                                            <SetRow
                                                key={idx}
                                                ex={ex}
                                                set={set}
                                                idx={idx}
                                                setField={setField}
                                                onWeightModeChange={(mode) => setWeightMode(ex, idx, mode)}
                                                onSetInputFocusChange={(inputId) => {
                                                    if (inputId) notifyActiveExercise(ex);
                                                    onSetInputFocusChange?.(inputId);
                                                }}
                                                inputId={`${ex.id || ex.name}-${idx}`}
                                                previousSet={previousSets[idx]}
                                                previousUnit={previousSets[idx]?.displayUnit || previousSets[idx]?.unit || previousSets[idx]?.weightUnit || previousSets[idx]?.weight_unit || previousUnit}
                                                unit={getSetDisplayUnit(set, exUnit)}
                                                onCopyDown={onCopyDown}
                                                onCopyDownReps={onCopyDownReps}
                                                onDeleteSet={removeSet ? (setIdx) => removeSet(ex, setIdx) : undefined}
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

                                            {memoOpenId === ex.id ? (
                                                <textarea
                                                    autoFocus
                                                    value={memos[ex.name] || ""}
                                                    onChange={e => saveMemo(ex.name, e.target.value)}
                                                    onBlur={() => setMemoOpenId(null)}
                                                    placeholder="フォームのコツ、注意点など..."
                                                    style={{
                                                        display: "block",
                                                        width: "100%",
                                                        marginTop: 10,
                                                        padding: "10px 12px",
                                                        borderRadius: 10,
                                                        border: `1px solid ${softBorderColor}`,
                                                        background: "transparent",
                                                        color: "var(--text)",
                                                        fontSize: 12,
                                                        fontWeight: 600,
                                                        resize: "vertical",
                                                        minHeight: 60,
                                                        boxSizing: "border-box",
                                                        lineHeight: 1.6,
                                                    }}
                                                />
                                            ) : memos[ex.name] ? (
                                                <div
                                                    onClick={() => setMemoOpenId(ex.id)}
                                                    style={{
                                                        marginTop: 10,
                                                        padding: "8px 10px",
                                                        borderRadius: 10,
                                                        border: `1px solid ${softBorderColor}`,
                                                        color: "var(--text2)",
                                                        fontSize: 12,
                                                        fontWeight: 600,
                                                        lineHeight: 1.6,
                                                        cursor: "text",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                    }}
                                                >
                                                    {memos[ex.name]}
                                                </div>
                                            ) : null}

                                    </div>
                                )}
                            </SortableExerciseItem>
                        );
                    })}
                </SortableContext>
            </DndContext>

            {/* 次の種目サジェスト（自分で組む日のみ、AIプラン中は非表示） */}
            {!isAiPlanDay && exercises.length > 0 && (() => {
                const lastEx = exercises[exercises.length - 1];
                if (dismissedSuggestForEx === lastEx.name) return null;
                const nextMap = buildNextExerciseMap(history || {});
                const candidates = nextMap[lastEx.name] || {};
                const currentExNames = new Set(exercises.map((e) => e.name));
                const suggestions = Object.entries(candidates)
                    .filter(([name]) => !currentExNames.has(name))
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 2)
                    .map(([name]) => name);
                if (suggestions.length === 0) return null;
                return (
                    <div style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                        margin: "4px 0 12px",
                        padding: "10px 12px",
                        background: "rgba(18,199,194,0.05)",
                        borderRadius: 14,
                        border: "1px solid rgba(18,199,194,0.15)",
                    }}>
                        <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700, flexShrink: 0 }}>
                            次によくやる
                        </span>
                        {suggestions.map((name) => (
                            <button
                                key={name}
                                type="button"
                                onClick={() => {
                                    const bodyPart = resolveExerciseBodyPartFromData(name, history, muscleEx);
                                    onQuickAddEx?.(name, false, bodyPart, { action: "exercise_add" });
                                }}
                                style={{
                                    padding: "7px 13px",
                                    borderRadius: 999,
                                    background: "rgba(18,199,194,0.10)",
                                    border: "1px solid rgba(18,199,194,0.32)",
                                    color: "var(--accent)",
                                    fontSize: 13,
                                    fontWeight: 800,
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                ＋ {name}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setDismissedSuggestForEx(lastEx.name)}
                            style={{
                                marginLeft: "auto",
                                padding: "4px 8px",
                                borderRadius: 999,
                                background: "none",
                                border: "none",
                                color: "var(--text3)",
                                fontSize: 16,
                                cursor: "pointer",
                                lineHeight: 1,
                                flexShrink: 0,
                            }}
                            aria-label="サジェストを閉じる"
                        >
                            ×
                        </button>
                    </div>
                );
            })()}

            {/* フローティング＋ボタン */}
            <button onClick={() => setShowAdd(true)}
                style={{ position: "fixed", bottom: 154, left: 20, width: 54, height: 54, borderRadius: 27, background: "linear-gradient(135deg, rgba(15, 94, 99, 0.96), rgba(18, 169, 164, 0.90))", color: "#fff", fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 20px rgba(15, 94, 99, 0.18)", border: "1px solid rgba(18, 199, 194, 0.40)", zIndex: 101 }}>
                ＋
            </button>

            {/* 終了ボタン（今日のログのみ表示） */}
            {onFinishWorkout && logDate === new Date().toISOString().slice(0, 10) && (
                <button
                    type="button"
                    onClick={() => {
                        if (workoutFinished) {
                            // 終了状態を解除
                            setWorkoutFinished(false);
                            try {
                                const dates = readCompletedDates();
                                delete dates[logDate];
                                localStorage.setItem(COMPLETED_WORKOUT_DATES_KEY, JSON.stringify(dates));
                            } catch {}
                            onUnfinishWorkout?.();
                        } else {
                            // 終了状態に設定
                            console.log("[終了] onFinishWorkout fired, logDate =", logDate);
                            onFinishWorkout();
                            setWorkoutFinished(true);
                            try {
                                const dates = readCompletedDates();
                                dates[logDate] = true;
                                localStorage.setItem(COMPLETED_WORKOUT_DATES_KEY, JSON.stringify(dates));
                            } catch {}
                            setShowFinishSummary(true);
                        }
                    }}
                    style={{
                        position: "fixed",
                        bottom: 154,
                        right: 20,
                        height: 54,
                        minWidth: 54,
                        padding: "0 20px",
                        borderRadius: 27,
                        background: "linear-gradient(135deg, rgba(15, 94, 99, 0.96), rgba(18, 169, 164, 0.90))",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 800,
                        border: "1px solid rgba(18, 199, 194, 0.40)",
                        boxShadow: "0 10px 20px rgba(15, 94, 99, 0.18)",
                        zIndex: 101,
                        cursor: "pointer",
                        letterSpacing: 0.3,
                        opacity: workoutFinished ? 0.85 : 1,
                        transition: "opacity 0.2s",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                    }}
                >
                    {workoutFinished ? (
                        <>
                            <span style={{ fontSize: 15 }}>✓</span>
                            <span>完了済み</span>
                        </>
                    ) : "終了"}
                </button>
            )}

            {/* 終了後サマリーモーダル */}
            {showFinishSummary && (() => {
                const durationSec = shareDurationSec;
                const h = Math.floor(durationSec / 3600);
                const m = Math.floor((durationSec % 3600) / 60);
                const durationStr = durationSec > 0
                    ? (h > 0 ? `${h}時間${m}分` : `${m}分`)
                    : "--";

                return (
                    <div
                        style={{
                            position: "fixed", inset: 0, zIndex: 500,
                            background: "rgba(0,0,0,0.55)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            padding: "0 20px",
                        }}
                        onClick={() => setShowFinishSummary(false)}
                    >
                        <div
                            style={{
                                background: "var(--card)",
                                borderRadius: 22,
                                padding: "28px 22px 22px",
                                maxWidth: 360,
                                width: "100%",
                                boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                            }}
                            onClick={e => e.stopPropagation()}
                        >
                            {/* タイトル */}
                            <div style={{ textAlign: "center", marginBottom: 20 }}>
                                <div style={{ fontSize: 26, marginBottom: 4 }}>💪</div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                                    トレーニング完了！
                                </div>
                            </div>

                            {/* 統計カード */}
                            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                                {[
                                    { label: "セット数", value: setCount, unit: "セット" },
                                    { label: "総ボリューム", value: formattedVolumeKg, unit: "kg" },
                                    { label: "時間", value: durationStr, unit: "" },
                                ].map(({ label, value, unit: u }) => (
                                    <div
                                        key={label}
                                        style={{
                                            flex: 1,
                                            background: "var(--card2)",
                                            borderRadius: 14,
                                            padding: "12px 8px",
                                            textAlign: "center",
                                        }}
                                    >
                                        <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>
                                            {label}
                                        </div>
                                        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", lineHeight: 1.1 }}>
                                            {value}
                                        </div>
                                        {u && (
                                            <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                                                {u}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* PR更新セクション */}
                            {prExerciseNames.length > 0 && (
                                <div style={{
                                    background: "linear-gradient(135deg, rgba(255,193,7,0.12), rgba(255,152,0,0.08))",
                                    border: "1px solid rgba(255,193,7,0.3)",
                                    borderRadius: 14,
                                    padding: "12px 14px",
                                    marginBottom: 18,
                                }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, color: "#b8860b", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                                        🏆 自己ベスト更新
                                    </div>
                                    {prExerciseNames.map(name => (
                                        <div key={name} style={{ fontSize: 13, color: "var(--text)", fontWeight: 600, padding: "2px 0" }}>
                                            {name} で自己ベスト更新！
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 閉じるボタン */}
                            <button
                                onClick={() => setShowFinishSummary(false)}
                                style={{
                                    width: "100%",
                                    height: 48,
                                    borderRadius: 14,
                                    background: "linear-gradient(135deg, rgba(15, 94, 99, 0.96), rgba(18, 169, 164, 0.90))",
                                    color: "#fff",
                                    fontSize: 15,
                                    fontWeight: 800,
                                    border: "none",
                                    cursor: "pointer",
                                }}
                            >
                                閉じる
                            </button>
                        </div>
                    </div>
                );
            })()}

            {showAdd && (
                <AddExModal
                    name={addName} setName={setAddName}
                    onConfirm={handleAddConfirm}
                    onClose={() => { setShowAdd(false); setAddName(""); }}
                    target={null}
                    onQuickAdd={handleQuickAdd}
                    existingNames={exercises.map(e => e.name)}
                    muscleEx={muscleEx}
                    customExercisesByBodyPart={customExercisesByBodyPart}
                    onSaveCustomExercise={onSaveCustomExercise}
                    onBulkSaveCustomExercises={onBulkSaveCustomExercises}
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
                    currentDate={logDate}
                    currentSets={historyTargetCurrentSets}
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
