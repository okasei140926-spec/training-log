import { useState, useEffect, useRef } from "react";
import { getSuggestions, QUICK_LABELS, SUGGESTIONS } from "../../constants/suggestions";
import { load, save } from "../../utils/helpers";
import { normalizeExerciseName } from "../../utils/exerciseName";
import CustomBodyPartModal from "./CustomBodyPartModal";

const matchesActiveTab = (bodyPart, activeTab) => {
    if (!bodyPart || bodyPart === "その他") return false;
    if (bodyPart === "脚") {
        return activeTab === "四頭" || activeTab === "ハムストリングス";
    }
    if (bodyPart === "尻") {
        return activeTab === "尻";
    }
    if (bodyPart === "腹") {
        return activeTab === "腹筋";
    }
    return bodyPart === activeTab;
};

export default function AddExModal({
    name,
    setName,
    onConfirm,
    onClose,
    target,
    onQuickAdd,
    existingNames = [],
    muscleEx = {},
    history = {},
    manualBests = [],
    customBodyParts = [],
    hiddenBodyParts = [],
    onAddCustomBodyPart,
    onUpdateHiddenBodyParts,
}) {
    const inputRef = useRef(null);
    const scrollLockRef = useRef({ top: 0, body: {}, html: {} });
    const longPressRef = useRef({
        timer: null,
        triggered: false,
        startX: 0,
        startY: 0,
    });
    const [added, setAdded] = useState(() => new Set(existingNames));
    const [activeTab, setActiveTab] = useState("胸");
    const [showCustomBodyPartModal, setShowCustomBodyPartModal] = useState(false);
    const [hiddenExerciseSuggestions, setHiddenExerciseSuggestions] = useState(() =>
        load("hiddenExerciseSuggestions", {})
    );

    const isFree = !target || (Array.isArray(target) && target.length === 0);
    const allTabLabels = [...new Set([...QUICK_LABELS, ...customBodyParts.filter(Boolean)])];
    const visibleTabLabels = allTabLabels.filter((label) => !hiddenBodyParts.includes(label));
    const tabLabels = visibleTabLabels.length ? visibleTabLabels : allTabLabels.slice(0, 1);

    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 50);
        if (isFree && tabLabels.length > 0) setActiveTab(tabLabels[0]);
        const body = document.body;
        const html = document.documentElement;
        const scrollLock = scrollLockRef.current;
        scrollLockRef.current.top = window.scrollY || window.pageYOffset || 0;
        scrollLockRef.current.body = {
            overflow: body.style.overflow,
            position: body.style.position,
            top: body.style.top,
            width: body.style.width,
            touchAction: body.style.touchAction,
        };
        scrollLockRef.current.html = {
            overflow: html.style.overflow,
            overscrollBehavior: html.style.overscrollBehavior,
        };

        body.style.overflow = "hidden";
        body.style.position = "fixed";
        body.style.top = `-${scrollLockRef.current.top}px`;
        body.style.width = "100%";
        body.style.touchAction = "none";
        html.style.overflow = "hidden";
        html.style.overscrollBehavior = "none";
        return () => {
            body.style.overflow = scrollLock.body.overflow || "";
            body.style.position = scrollLock.body.position || "";
            body.style.top = scrollLock.body.top || "";
            body.style.width = scrollLock.body.width || "";
            body.style.touchAction = scrollLock.body.touchAction || "";
            html.style.overflow = scrollLock.html.overflow || "";
            html.style.overscrollBehavior = scrollLock.html.overscrollBehavior || "";
            window.scrollTo(0, scrollLock.top || 0);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!isFree || !tabLabels.length) return;
        if (!tabLabels.includes(activeTab)) {
            setActiveTab(tabLabels[0]);
        }
    }, [activeTab, isFree, tabLabels]);


    useEffect(() => {
        setAdded(new Set(existingNames));
    }, [existingNames.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    const suggestions = getSuggestions(target);
    const targets = Array.isArray(target) ? target : (target ? [target] : []);
    const grouped = targets
        .map(t => ({ label: t, items: suggestions.filter(s => s.label === t) }))
        .filter(g => g.items.length);

    const historyUsageMap = Object.entries(history || {}).reduce((acc, [exerciseName, records]) => {
        const normalizedName = normalizeExerciseName(exerciseName);
        acc[normalizedName] = (acc[normalizedName] || 0) + (records?.length || 0);
        return acc;
    }, {});

    const getFrequency = (exName) => {
        return historyUsageMap[normalizeExerciseName(exName)] || 0;
    };

    const freeItems = (() => {
        if (!isFree || !activeTab) return [];
        const fixed = SUGGESTIONS[activeTab] || [];
        const custom = (muscleEx[activeTab] || []).map(ex => ex.name);
        const fromManualBests = manualBests
            .filter((best) => matchesActiveTab(best?.body_part, activeTab))
            .map((best) => best.exercise_name)
            .filter(Boolean);
        return [...new Set([...fixed, ...custom, ...fromManualBests])]
            .filter((name) => !hiddenExerciseSuggestions[`${activeTab}::${name}`])
            .map((item, originalIndex) => ({
                item,
                originalIndex,
                usageCount: getFrequency(item),
            }))
            .sort((a, b) => {
                const usageDiff = b.usageCount - a.usageCount;
                if (usageDiff !== 0) return usageDiff;
                return a.originalIndex - b.originalIndex;
            })
            .map(({ item }) => item);
    })();

    useEffect(() => {
        save("hiddenExerciseSuggestions", hiddenExerciseSuggestions);
    }, [hiddenExerciseSuggestions]);

    useEffect(() => {
        return () => {
            clearLongPress();
        };
    }, []);

    const clearLongPress = () => {
        if (longPressRef.current.timer) {
            clearTimeout(longPressRef.current.timer);
            longPressRef.current.timer = null;
        }
    };

    const startLongPress = (onLongPress, point) => {
        clearLongPress();
        longPressRef.current.triggered = false;
        longPressRef.current.startX = point?.clientX ?? 0;
        longPressRef.current.startY = point?.clientY ?? 0;
        longPressRef.current.timer = setTimeout(() => {
            longPressRef.current.triggered = true;
            onLongPress?.();
        }, 600);
    };

    const cancelLongPress = () => {
        clearLongPress();
    };

    const handleTouchMoveCancel = (touch) => {
        if (!touch) return;
        const dx = Math.abs(touch.clientX - longPressRef.current.startX);
        const dy = Math.abs(touch.clientY - longPressRef.current.startY);
        if (dx > 10 || dy > 10) {
            clearLongPress();
        }
    };

    const buildLongPressHandlers = ({ onTap, onLongPress }) => ({
        onClick: (e) => {
            if (longPressRef.current.triggered) {
                e.preventDefault();
                e.stopPropagation();
                longPressRef.current.triggered = false;
                return;
            }
            onTap?.();
        },
        onMouseDown: (e) => startLongPress(onLongPress, e),
        onMouseUp: cancelLongPress,
        onMouseLeave: cancelLongPress,
        onTouchStart: (e) => startLongPress(onLongPress, e.touches[0]),
        onTouchEnd: cancelLongPress,
        onTouchCancel: cancelLongPress,
        onTouchMove: (e) => handleTouchMoveCancel(e.touches[0]),
    });

    const hideSuggestion = (bodyPart, exerciseName) => {
        const confirmed = window.confirm("この候補を非表示にしますか？");
        if (!confirmed) return;
        setHiddenExerciseSuggestions((prev) => ({
            ...prev,
            [`${bodyPart}::${exerciseName}`]: true,
        }));
    };

    const hideBodyPart = (bodyPart) => {
        if (tabLabels.length <= 1) {
            window.alert("最低1つの部位は表示したままにしてください");
            return;
        }

        const confirmed = window.confirm(`${bodyPart}を非表示にしますか？`);
        if (!confirmed) return;

        onUpdateHiddenBodyParts?.([...hiddenBodyParts, bodyPart]);
    };

    const hasAddedExercise = (exerciseName) => {
        const normalizedName = normalizeExerciseName(exerciseName);
        if (!normalizedName) return false;
        return Array.from(added).some((addedName) => normalizeExerciseName(addedName) === normalizedName);
    };

    const existsInCurrentWorkout = (exerciseName) => {
        const normalizedName = normalizeExerciseName(exerciseName);
        if (!normalizedName) return false;
        return (existingNames || []).some((existingName) => normalizeExerciseName(existingName) === normalizedName);
    };

    const handleQuick = (s) => {
        const exerciseName = String(s || "").trim();
        if (!exerciseName) {
            console.error("[add-exercise] failed: empty exercise name", { activeTab });
            return;
        }

        const checkedInModal = hasAddedExercise(exerciseName);
        const existsInWorkout = existsInCurrentWorkout(exerciseName);

        if (checkedInModal && existsInWorkout) {
            onQuickAdd(exerciseName, true, activeTab, { action: "exercise_remove" });
            setAdded((prev) => {
                const next = new Set(prev);
                Array.from(next).forEach((addedName) => {
                    if (normalizeExerciseName(addedName) === normalizeExerciseName(exerciseName)) {
                        next.delete(addedName);
                    }
                });
                return next;
            });
            console.log("[add-exercise] modal selection removed", {
                name: exerciseName,
                activeTab,
                before: Array.from(added),
            });
            return;
        }

        try {
            onQuickAdd(exerciseName, false, activeTab, { action: "exercise_add" });
            setAdded((prev) => new Set([...prev, exerciseName]));
            console.log("[add-exercise] modal selection added", {
                name: exerciseName,
                activeTab,
                before: Array.from(added),
                after: [...Array.from(added), exerciseName],
            });
        } catch (error) {
            console.error("[add-exercise] failed while adding from modal", {
                name: exerciseName,
                activeTab,
                error,
            });
        }
    };

    const handleManual = () => {
        if (!name.trim()) return;
        const trimmed = name.trim();
        onQuickAdd(trimmed, false, activeTab, { action: "manual_exercise_add" });
        setAdded(p => new Set([...p, trimmed]));
        setName("");
    };

    const SuggestionList = ({ items }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {items.map(s => {
                const key = typeof s === "string" ? s : s.name;
                const isAdded = hasAddedExercise(key);
                return (
                    <button
                        key={key}
                        {...buildLongPressHandlers({
                            onTap: () => handleQuick(key),
                            onLongPress: () => hideSuggestion(activeTab, key),
                        })}
                        style={{
                            width: "100%",
                            padding: "11px 14px",
                            borderRadius: 11,
                            background: isAdded ? "rgba(18, 199, 194, 0.08)" : "var(--card2)",
                            border: "1px solid rgba(18, 199, 194, 0.22)",
                            color: isAdded ? "var(--text2)" : "var(--text)",
                            fontSize: 14,
                            textAlign: "left",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            boxShadow: "0 8px 18px rgba(0, 0, 0, 0.10)"
                        }}>
                        <span style={{ textDecoration: isAdded ? "line-through" : "none", opacity: isAdded ? 0.78 : 1 }}>{key}</span>
                        {isAdded
                            ? <span style={{ color: "rgba(18, 199, 194, 0.82)", fontSize: 16, fontWeight: 700 }}>✓</span>
                            : <span style={{ color: "var(--text3)", fontSize: 14 }}>＋</span>
                        }
                    </button>
                );
            })}
        </div>
    );

    return (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 9999, display: "flex", flexDirection: "column", justifyContent: "flex-end", overscrollBehavior: "none", touchAction: "none" }}
            onClick={onClose}>
            <div style={{
                width: "100%",
                background: "var(--card-modal)",
                borderRadius: "20px 20px 0 0",
                padding: "20px 18px 0 18px",
                height: "min(76dvh, 700px)",
                maxHeight: "min(76dvh, 700px)",
                minHeight: "min(76dvh, 700px)",
                display: "flex",
                flexDirection: "column",
                boxSizing: "border-box",
                overscrollBehavior: "contain",
                touchAction: "auto",
            }}
                onClick={e => e.stopPropagation()}>

                {/* タイトル（固定） */}
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "var(--text)", flexShrink: 0 }}>種目を追加</div>

                {/* タブ（固定） */}
                {isFree && (
                    <div style={{ flexShrink: 0, marginBottom: 10 }}>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 5,
                                alignItems: "center",
                            }}
                        >
                            {tabLabels.map(label => (
                                <button
                                    key={label}
                                    {...buildLongPressHandlers({
                                        onTap: () => setActiveTab(label),
                                        onLongPress: () => hideBodyPart(label),
                                    })}
                                    style={{
                                        padding: "5px 11px",
                                        borderRadius: 20,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        border: activeTab === label
                                            ? "1px solid rgba(15, 94, 99, 0.18)"
                                            : "1px solid rgba(18, 199, 194, 0.10)",
                                        background: activeTab === label
                                            ? "linear-gradient(135deg, #0F5E63 0%, #12C7C2 100%)"
                                            : "rgba(18, 199, 194, 0.06)",
                                        color: activeTab === label ? "#FFFFFF" : "#0F5E63",
                                        boxShadow: activeTab === label
                                            ? "0 8px 18px rgba(18, 199, 194, 0.18)"
                                            : "none"
                                    }}>
                                    {label}
                                </button>
                            ))}
                            <button
                                onClick={() => setShowCustomBodyPartModal(true)}
                                style={{
                                    padding: "5px 11px",
                                    borderRadius: 20,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    border: "1px dashed var(--border2)",
                                    background: "transparent",
                                    color: "var(--text2)",
                                }}
                            >
                                ＋ 部位追加
                            </button>
                        </div>
                    </div>
                )}

                {/* 種目リスト（スクロール） */}
                <div style={{ overflowY: "auto", flex: 1, minHeight: 0, paddingBottom: 6, overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
                    {isFree && <SuggestionList items={freeItems} />}

                    {!isFree && grouped.map(group => (
                        <div key={group.label} style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, marginBottom: 7, textTransform: "uppercase" }}>{group.label}</div>
                            <SuggestionList items={group.items.map(s => s.name).sort((a, b) => getFrequency(b) - getFrequency(a))} />
                        </div>
                    ))}
                </div>

                {/* 入力欄＋ボタン（固定） */}
                <div style={{ flexShrink: 0, paddingBottom: "calc(24px + var(--safe-bottom, 0px))", paddingTop: 6, background: "var(--card-modal)" }}>
                    <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
                        リストにない種目
                    </div>
                    <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleManual()}
                        placeholder="種目名を入力..."
                        style={{ width: "100%", padding: "13px 15px", borderRadius: 12, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text)", fontSize: 16, marginBottom: 10, boxSizing: "border-box" }} />
                    <div style={{ display: "flex", gap: 9 }}>
                        <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, background: "var(--card2)", color: "var(--text2)", fontSize: 15, border: "none" }}>閉じる</button>
                        <button
                            onClick={handleManual}
                            disabled={!name.trim()}
                            style={{
                                flex: 2,
                                padding: "12px",
                                borderRadius: 12,
                                fontSize: 15,
                                fontWeight: 800,
                                border: "none",
                                background: name.trim()
                                    ? "linear-gradient(135deg, #0F5E63 0%, #12C7C2 100%)"
                                    : "rgba(18, 199, 194, 0.12)",
                                color: name.trim() ? "#FFFFFF" : "rgba(15, 94, 99, 0.45)",
                                boxShadow: name.trim()
                                    ? "0 10px 22px rgba(18, 199, 194, 0.22)"
                                    : "none",
                                opacity: name.trim() ? 1 : 0.9
                            }}>
                            手動で追加
                        </button>
                    </div>
                </div>
            </div>

            <CustomBodyPartModal
                isOpen={showCustomBodyPartModal}
                customBodyParts={customBodyParts}
                onClose={() => setShowCustomBodyPartModal(false)}
                onSave={(bodyPart) => {
                    onAddCustomBodyPart?.(bodyPart);
                    setActiveTab(bodyPart);
                    setShowCustomBodyPartModal(false);
                }}
            />
        </div>
    );

}
