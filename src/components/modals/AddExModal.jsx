import { useState, useEffect, useRef } from "react";
import { getSuggestions, QUICK_LABELS, SUGGESTIONS } from "../../constants/suggestions";

export default function AddExModal({ name, setName, onConfirm, onClose, target, onQuickAdd, existingNames = [] }) {
  const inputRef = useRef(null);
  const [added, setAdded]         = useState(() => new Set(existingNames));
  const [activeTab, setActiveTab] = useState(null);

  const isFree = !target || (Array.isArray(target) && target.length === 0);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    if (isFree) setActiveTab(QUICK_LABELS[0]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAdded(prev => {
      const next = new Set(prev);
      existingNames.forEach(n => next.add(n));
      return next;
    });
  }, [existingNames.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions  = getSuggestions(target);
  const targets      = Array.isArray(target) ? target : (target ? [target] : []);
  const grouped      = targets
    .map(t => ({ label: t, items: suggestions.filter(s => s.label === t) }))
    .filter(g => g.items.length);

  const freeItems = isFree && activeTab ? (SUGGESTIONS[activeTab] || []) : [];

  const handleQuick = (s) => {
    if (added.has(s)) {
      onQuickAdd(s, true);
      setAdded(p => { const n = new Set(p); n.delete(s); return n; });
    } else {
      onQuickAdd(s, false);
      setAdded(p => new Set([...p, s]));
    }
  };

  const handleManual = () => {
    if (!name.trim()) return;
    const trimmed = name.trim();
    onConfirm();
    setAdded(p => new Set([...p, trimmed]));
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const SuggestionList = ({ items }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map(s => {
        const key     = typeof s === "string" ? s : s.name;
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
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 200, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 430, margin: "0 auto", background: "var(--card-modal)", borderRadius: "20px 20px 0 0", padding: "24px 20px 36px", maxHeight: "85vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>種目を追加</div>

        {isFree && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 12, msOverflowStyle: "none", scrollbarWidth: "none" }}>
              {QUICK_LABELS.map(label => (
                <button key={label} onClick={() => setActiveTab(label)}
                  style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, flexShrink: 0, border: "none",
                    background: activeTab === label ? "var(--text)" : "var(--card2)",
                    color:      activeTab === label ? "var(--bg)"   : "var(--text2)" }}>
                  {label}
                </button>
              ))}
            </div>
            <SuggestionList items={freeItems} />
          </div>
        )}

        {!isFree && grouped.map(group => (
          <div key={group.label} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>{group.label}</div>
            <SuggestionList items={group.items.map(s => s.name)} />
          </div>
        ))}

        <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, marginBottom: 10, marginTop: 8, textTransform: "uppercase" }}>
          リストにない種目
        </div>
        <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleManual()}
          placeholder="種目名を入力..."
          style={{ width: "100%", padding: "14px 16px", borderRadius: 12, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text)", fontSize: 16, marginBottom: 12 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 12, background: "var(--card2)", color: "var(--text2)", fontSize: 15 }}>閉じる</button>
          <button onClick={handleManual}
            style={{ flex: 2, padding: "13px", borderRadius: 12, fontSize: 15, fontWeight: 800,
              background: name.trim() ? "var(--text)" : "var(--border2)",
              color:      name.trim() ? "var(--bg)"   : "var(--text3)" }}>
            追加
          </button>
        </div>
      </div>
    </div>
  );
}
