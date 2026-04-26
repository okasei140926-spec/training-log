import { useEffect, useState } from "react";

const BODY_PART_OPTIONS = ["胸", "背中", "脚", "尻", "肩", "二頭", "三頭", "腹", "その他"];

export default function ManualBestModal({
    isOpen,
    onClose,
    onSave,
    initialValue = null,
    mode = "create",
}) {
    const [exerciseName, setExerciseName] = useState("");
    const [weight, setWeight] = useState("");
    const [reps, setReps] = useState("");
    const [bestDate, setBestDate] = useState("");
    const [bodyPart, setBodyPart] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setExerciseName(initialValue?.exercise_name || "");
        setWeight(initialValue?.weight != null ? String(initialValue.weight) : "");
        setReps(initialValue?.reps != null ? String(initialValue.reps) : "");
        setBestDate(initialValue?.best_date || "");
        setBodyPart(initialValue?.body_part || "");
        setError("");
        setSaving(false);
    }, [isOpen, initialValue]);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        const trimmedName = exerciseName.trim();
        const weightNum = Number(weight);
        const repsNum = Number(reps);

        if (!trimmedName) {
            setError("種目名を入力してください");
            return;
        }
        if (!Number.isFinite(weightNum) || weightNum <= 0) {
            setError("重量を正しく入力してください");
            return;
        }
        if (!Number.isFinite(repsNum) || repsNum <= 0) {
            setError("回数を正しく入力してください");
            return;
        }
        if (!bodyPart) {
            setError("部位を選択してください");
            return;
        }

        setSaving(true);
        setError("");

        try {
            await onSave({
                exercise_name: trimmedName,
                weight: weightNum,
                reps: repsNum,
                best_date: bestDate || null,
                body_part: bodyPart,
            });
            onClose();
        } catch (saveError) {
            console.error(saveError);
            setError("保存に失敗しました。時間をおいてもう一度お試しください。");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                zIndex: 1000,
                padding: 16,
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

                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 14, color: "var(--text)" }}>
                    {mode === "edit" ? "過去ベスト編集" : "過去ベスト登録"}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <input
                        value={exerciseName}
                        onChange={(e) => setExerciseName(e.target.value)}
                        placeholder="種目名"
                        style={{
                            width: "100%",
                            padding: "12px 14px",
                            borderRadius: 12,
                            border: "1px solid var(--border2)",
                            background: "var(--card2)",
                            color: "var(--text)",
                            fontSize: 14,
                            boxSizing: "border-box",
                        }}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                        <input
                            value={weight}
                            onChange={(e) => setWeight(e.target.value)}
                            placeholder="重量 (kg)"
                            inputMode="decimal"
                            style={{
                                width: "100%",
                                padding: "12px 14px",
                                borderRadius: 12,
                                border: "1px solid var(--border2)",
                                background: "var(--card2)",
                                color: "var(--text)",
                                fontSize: 14,
                                boxSizing: "border-box",
                            }}
                        />
                        <input
                            value={reps}
                            onChange={(e) => setReps(e.target.value)}
                            placeholder="回数"
                            inputMode="numeric"
                            style={{
                                width: "100%",
                                padding: "12px 14px",
                                borderRadius: 12,
                                border: "1px solid var(--border2)",
                                background: "var(--card2)",
                                color: "var(--text)",
                                fontSize: 14,
                                boxSizing: "border-box",
                            }}
                        />
                    </div>
                    <select
                        value={bodyPart}
                        onChange={(e) => setBodyPart(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "12px 14px",
                            borderRadius: 12,
                            border: "1px solid var(--border2)",
                            background: "var(--card2)",
                            color: "var(--text)",
                            fontSize: 14,
                            boxSizing: "border-box",
                        }}
                    >
                        <option value="" disabled>
                            部位を選択
                        </option>
                        {BODY_PART_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2, marginBottom: -2 }}>
                        日付（任意）
                    </div>
                    <input
                        value={bestDate}
                        onChange={(e) => setBestDate(e.target.value)}
                        type="date"
                        style={{
                            width: "100%",
                            padding: "12px 14px",
                            borderRadius: 12,
                            border: "1px solid var(--border2)",
                            background: "var(--card2)",
                            color: "var(--text)",
                            fontSize: 14,
                            boxSizing: "border-box",
                        }}
                    />
                </div>

                {error && (
                    <div style={{ fontSize: 12, color: "#f87171", marginTop: 12 }}>
                        {error}
                    </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                    <button
                        onClick={onClose}
                        style={{
                            flex: 1,
                            padding: "13px 14px",
                            borderRadius: 14,
                            border: "1px solid var(--border2)",
                            background: "transparent",
                            color: "var(--text2)",
                            fontSize: 14,
                            fontWeight: 700,
                        }}
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        style={{
                            flex: 1,
                            padding: "13px 14px",
                            borderRadius: 14,
                            border: "none",
                            background: "var(--text)",
                            color: "var(--bg)",
                            fontSize: 14,
                            fontWeight: 800,
                            opacity: saving ? 0.7 : 1,
                        }}
                    >
                        {saving ? (mode === "edit" ? "更新中..." : "保存中...") : (mode === "edit" ? "更新" : "保存")}
                    </button>
                </div>
            </div>
        </div>
    );
}
