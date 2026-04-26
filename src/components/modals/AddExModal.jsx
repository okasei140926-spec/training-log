import { useState, useEffect, useRef } from "react";
import { getSuggestions, QUICK_LABELS, SUGGESTIONS } from "../../constants/suggestions";
import CustomBodyPartModal from "./CustomBodyPartModal";
import BodyPartManagerModal from "./BodyPartManagerModal";

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
    const [added, setAdded] = useState(() => new Set(existingNames));
    const [activeTab, setActiveTab] = useState("胸");
    const [showCustomBodyPartModal, setShowCustomBodyPartModal] = useState(false);
    const [showBodyPartManagerModal, setShowBodyPartManagerModal] = useState(false);

    const isFree = !target || (Array.isArray(target) && target.length === 0);
    const allTabLabels = [...new Set([...QUICK_LABELS, ...customBodyParts.filter(Boolean)])];
    const visibleTabLabels = allTabLabels.filter((label) => !hiddenBodyParts.includes(label));
    const tabLabels = visibleTabLabels.length ? visibleTabLabels : allTabLabels.slice(0, 1);

    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 50);
        if (isFree && tabLabels.length > 0) setActiveTab(tabLabels[0]);

        // ここを追加
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!isFree || !tabLabels.length) return;
        if (!tabLabels.includes(activeTab)) {
            setActiveTab(tabLabels[0]);
        }
    }, [activeTab, isFree, tabLabels]);


    useEffect(() => {
        setAdded(prev => {
            const next = new Set(prev);
            existingNames.forEach(n => next.add(n));
            return next;
        });
    }, [existingNames.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    const suggestions = getSuggestions(target);
    const targets = Array.isArray(target) ? target : (target ? [target] : []);
    const grouped = targets
        .map(t => ({ label: t, items: suggestions.filter(s => s.label === t) }))
        .filter(g => g.items.length);

    const getFrequency = (exName) => {
        return history[exName]?.length || 0;
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
            .sort((a, b) => getFrequency(b) - getFrequency(a));
    })();

    const handleQuick = (s) => {
        if (added.has(s)) {
            onQuickAdd(s, true, activeTab);
            setAdded(p => { const n = new Set(p); n.delete(s); return n; });
        } else {
            onQuickAdd(s, false, activeTab);
            setAdded(p => new Set([...p, s]));
        }
    };

    const handleManual = () => {
        if (!name.trim()) return;
        const trimmed = name.trim();
        onQuickAdd(trimmed, false, activeTab);
        setAdded(p => new Set([...p, trimmed]));
        setName("");
    };

    const SuggestionList = ({ items }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map(s => {
                const key = typeof s === "string" ? s : s.name;
                const isAdded = added.has(key);
                return (
                    <button key={key} onClick={() => handleQuick(key)}
                        style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: "var(--card2)", border: "1px solid var(--border)", color: isAdded ? "var(--text2)" : "var(--text)", fontSize: 14, textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ textDecoration: isAdded ? "line-through" : "none" }}>{key}</span>
                        {isAdded
                            ? <span style={{ color: "#4ade80", fontSize: 16, fontWeight: 700 }}>✓</span>
                            : <span style={{ color: "var(--text3)", fontSize: 14 }}>＋</span>
                        }
                    </button>
                );
            })}
        </div>
    );

    return (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 9999, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
            onClick={onClose}>
            <div style={{
                width: "100%",
                background: "var(--card-modal)",
                borderRadius: "20px 20px 0 0",
                padding: "24px 20px 0 20px",
                maxHeight: "75vh",
                display: "flex",
                flexDirection: "column"
            }}
                onClick={e => e.stopPropagation()}>

                {/* タイトル（固定） */}
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "var(--text)", flexShrink: 0 }}>種目を追加</div>

                {/* タブ（固定） */}
                {isFree && (
                    <div style={{ flexShrink: 0, marginBottom: 12 }}>
                        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, msOverflowStyle: "none", scrollbarWidth: "none" }}>
                            {tabLabels.map(label => (
                                <button key={label} onClick={() => setActiveTab(label)}
                                    style={{
                                        padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, flexShrink: 0, border: "none",
                                        background: activeTab === label ? "var(--text)" : "var(--card2)",
                                        color: activeTab === label ? "var(--bg)" : "var(--text2)"
                                    }}>
                                    {label}
                                </button>
                            ))}
                            <button
                                onClick={() => setShowCustomBodyPartModal(true)}
                                style={{
                                    padding: "6px 14px",
                                    borderRadius: 20,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    flexShrink: 0,
                                    border: "1px dashed var(--border2)",
                                    background: "transparent",
                                    color: "var(--text2)",
                                }}
                            >
                                ＋ 部位追加
                            </button>
                            <button
                                onClick={() => setShowBodyPartManagerModal(true)}
                                style={{
                                    padding: "6px 14px",
                                    borderRadius: 20,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    flexShrink: 0,
                                    border: "1px dashed var(--border2)",
                                    background: "transparent",
                                    color: "var(--text2)",
                                }}
                            >
                                部位管理
                            </button>
                        </div>
                    </div>
                )}

                {/* 種目リスト（スクロール） */}
                <div style={{ overflowY: "auto", flex: 1, paddingBottom: 8 }}>
                    {isFree && <SuggestionList items={freeItems} />}

                    {!isFree && grouped.map(group => (
                        <div key={group.label} style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>{group.label}</div>
                            <SuggestionList items={group.items.map(s => s.name).sort((a, b) => getFrequency(b) - getFrequency(a))} />
                        </div>
                    ))}
                </div>

                {/* 入力欄＋ボタン（固定） */}
                <div style={{ flexShrink: 0, paddingBottom: 32, paddingTop: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>
                        リストにない種目
                    </div>
                    <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleManual()}
                        placeholder="種目名を入力..."
                        style={{ width: "100%", padding: "14px 16px", borderRadius: 12, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text)", fontSize: 16, marginBottom: 12, boxSizing: "border-box" }} />
                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 12, background: "var(--card2)", color: "var(--text2)", fontSize: 15, border: "none" }}>閉じる</button>
                        <button onClick={handleManual}
                            style={{
                                flex: 2, padding: "13px", borderRadius: 12, fontSize: 15, fontWeight: 800, border: "none",
                                background: name.trim() ? "var(--text)" : "var(--border2)",
                                color: name.trim() ? "var(--bg)" : "var(--text3)"
                            }}>
                            追加
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

            <BodyPartManagerModal
                isOpen={showBodyPartManagerModal}
                customBodyParts={customBodyParts}
                hiddenBodyParts={hiddenBodyParts}
                onClose={() => setShowBodyPartManagerModal(false)}
                onUpdateHiddenBodyParts={onUpdateHiddenBodyParts}
            />
        </div>
    );

}
