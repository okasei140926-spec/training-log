import React, { useState, useRef } from "react";
import { calc1RM, dispW } from "../utils/helpers";
import AddExModal from "./modals/AddExModal";
import SetRow from "./log/SetRow";


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


export default function LogScreen({
    todayLabels, dayColor,
    exercises, logData, getExSets, setField, addSet, removeEx,
    onAddEx, onQuickAddEx, onReorderEx, onRenameEx, getPrev, getPR, onCopyDown, onCopyDownReps, unit = "kg",
    getExUnit, onToggleExUnit, setTodayLabels, history, logDate, resetSession, muscleEx,
}) {

    const hasExercises = exercises.length > 0;

    const [showAdd, setShowAdd] = useState(false);
    const [addName, setAddName] = useState("");


    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState("");
    const [activeExIdx, setActiveExIdx] = useState(0);
    const editRef = useRef(null);

    const accentColor = dayColor || "var(--text)";
    const accentText = dayColor ? "#000" : "var(--bg)";
    const exCount = exercises.length;



    const startEdit = (ex) => {
        setEditingId(ex.id);
        setEditingName(ex.name);
        setTimeout(() => editRef.current?.focus(), 30);
    };

    const setCount = exercises.reduce((acc, ex) => {
        const sets = logData[ex.name] || getExSets(ex);
        return acc + sets.filter(s => s.done).length;
    }, 0);

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

    return (
        <div className="fade-in" style={{ padding: "20px", paddingBottom: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 3, textTransform: "uppercase" }}>{title}</div>
                <div style={{ fontSize: 11, color: "var(--text4)" }}></div>
            </div>

            <div style={{ fontSize: 11, color: "var(--text4)", marginTop: -10, marginBottom: 16 }}>
                {exCount}種目 ・ {setCount}セット
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
                    <div style={{ fontSize: 40 }}>💪</div>
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
                        const prev = getPrev ? getPrev(ex.name) : null;
                        const pr = getPR ? getPR(ex.name) : null;
                        const exUnit = getExUnit ? getExUnit(ex.name) : unit;
                        const prIsAlsoPrev = pr && prev && pr.date === prev.date;

                        const doneSets = sets.filter(s => {
                            const w = Number(s.weight);
                            const r = Number(s.reps);

                            return (
                                Number.isFinite(w) &&
                                Number.isFinite(r) &&
                                w > 0 &&
                                r > 0
                            );
                        });

                        const cur1RM = calc1RM(doneSets);

                        const prSets = pr?.sets?.filter(s => {
                            const w = Number(s.weight);
                            const r = Number(s.reps);
                            return Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0;
                        }) || [];

                        const pr1RM = calc1RM(prSets);

                        const isPR =
                            doneSets.length > 0 &&
                            prSets.length > 0 &&
                            cur1RM > pr1RM * 1.001;

                        console.log("PR_DEBUG", {
                            exercise: ex.name,
                            sets,
                            doneSets,
                            cur1RM,
                            pr,
                            prSets: pr?.sets,
                            pr1RM,
                            isPR
                        });

                        // PR の実際のトップセット（1RM換算が最大のセット）
                        const prTopSet = pr?.sets?.reduce((best, s) => {
                            if (s.weight === "BW" || !s.weight || !s.reps) return best;
                            if (!best) return s;
                            return Number(s.weight) * (1 + Number(s.reps) / 30) >= Number(best.weight) * (1 + Number(best.reps) / 30) ? s : best;
                        }, null);

                        if (i !== activeExIdx) {
                            const doneSetsCount = sets.filter(s => s.done && s.weight && s.reps).length;

                            return (
                                <SortableExerciseItem key={ex.id} id={ex.id}>
                                    {(dragHandleProps) => (
                                        <div
                                            onClick={() => setActiveExIdx(i)}
                                            style={{
                                                background: "var(--card)",
                                                borderRadius: 16,
                                                padding: "12px 16px",
                                                marginBottom: 12,
                                                border: "1px solid var(--border)",
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                transition: "transform 0.1s ease"
                                            }}
                                            onTouchStart={(e) => {
                                                e.currentTarget.style.transform = "scale(0.9)";
                                            }}
                                            onTouchEnd={(e) => {
                                                e.currentTarget.style.transform = "scale(1)"
                                            }}
                                        >
                                            <div>
                                                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                                                    {ex.name}
                                                </div>
                                                <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
                                                    {doneSetsCount > 0 ? `${doneSetsCount}セット完了` : "タップして開始"}
                                                </div>
                                            </div>

                                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                <div
                                                    {...dragHandleProps}
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        cursor: "grab",
                                                        padding: "6px 8px",
                                                        color: "var(--text3)",
                                                        fontSize: 18,
                                                        touchAction: "none",
                                                        userSelect: "none",
                                                    }}
                                                >
                                                    ≡
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </SortableExerciseItem>
                            );
                        }

                        return (
                            <SortableExerciseItem key={ex.id} id={ex.id}>
                                {(dragHandleProps) => (
                                    <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: `1px solid ${isPR ? "#4ade8055" : "var(--border)"}` }}>

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

                                            <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
                                                <div
                                                    {...dragHandleProps}
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        cursor: "grab",
                                                        padding: "6px 8px",
                                                        color: "var(--text3)",
                                                        fontSize: 18,
                                                        touchAction: "none",
                                                        userSelect: "none",
                                                    }}
                                                >
                                                    ≡
                                                </div>

                                                {onToggleExUnit && (
                                                    <button
                                                        onClick={() => onToggleExUnit(ex.name)}
                                                        style={{ padding: "3px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700, border: "1px solid var(--border2)", background: exUnit !== unit ? "var(--text)" : "var(--card2)", color: exUnit !== unit ? "var(--bg)" : "var(--text2)" }}
                                                    >
                                                        {{ kg: "lbs", lbs: "自重", BW: "kg" }[exUnit] || exUnit}
                                                    </button>
                                                )}
                                                <button onClick={() => removeEx(ex.id, ex.name)} style={{ background: "none", color: "var(--text4)", fontSize: 18, padding: "4px 8px" }}>×</button>
                                            </div>
                                        </div>

                                        {/* 前回の記録 + PR */}
                                        {(prev || pr) && (
                                            <div style={{ marginBottom: 10, padding: "8px 12px", background: "var(--card2)", borderRadius: 10 }}>
                                                {prev && (
                                                    <>
                                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                                            <div style={{ fontSize: 11, color: "var(--text2)" }}>前回 <span style={{ color: "var(--text3)" }}>{prev.date}</span></div>
                                                            {isPR && <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 700 }}>PR更新！</div>}
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
                                                    <div style={{ marginTop: prev ? 6 : 0, paddingTop: prev ? 6 : 0, borderTop: prev ? "1px solid var(--border)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                        <div style={{ fontSize: 11, color: "var(--text2)" }}>🏆 PR <span style={{ color: "var(--text3)", fontWeight: 400 }}>{pr.date}</span></div>
                                                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)" }}>
                                                            {prTopSet ? `${dispW(prTopSet.weight, exUnit)}${exUnit} × ${prTopSet.reps}rep` : `${pr.rm}${exUnit}`}
                                                        </div>
                                                    </div>
                                                )}
                                                {pr && prIsAlsoPrev && (
                                                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--text2)" }}>
                                                        🏆 前回がPR（{prTopSet ? `${dispW(prTopSet.weight, exUnit)}${exUnit}×${prTopSet.reps}rep` : `${pr.rm}${exUnit}`}）
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
                                                borderRadius: 12,
                                                background: "var(--card2)",
                                                border: "none",
                                                color: "var(--text)",
                                                fontSize: 13,
                                                fontWeight: 700
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
                style={{ position: "fixed", bottom: 154, left: 20, width: 52, height: 52, borderRadius: 26, background: accentColor, color: accentText, fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px #0004", border: "none", zIndex: 101 }}>
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
                />
            )}


        </div>
    );
}
