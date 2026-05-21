import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { formatSetCountByBodyPart } from "../../utils/setCountByBodyPart";

const CARD_PRESETS = {
    square: {
        key: "square",
        label: "1:1",
        width: 360,
        height: 360,
        scale: 0.84,
    },
    story: {
        key: "story",
        label: "9:16",
        width: 360,
        height: 640,
        scale: 0.58,
    },
};

const MAX_REASONABLE_DURATION_SEC = 12 * 60 * 60;

const formatDate = (date) => {
    const value = String(date || "");
    if (!value) return "";
    const [year, month, day] = value.split("-");
    return `${year}/${month}/${day}`;
};

const formatDuration = (durationSec) => {
    const sec = Number(durationSec || 0);
    if (!Number.isFinite(sec) || sec <= 0) return "";
    const totalMinutes = Math.max(1, Math.round(sec / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}分`;
    return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
};

const resolveDurationSec = (payload) => {
    const session = payload?.session || {};
    const candidates = [
        { value: payload?.durationSec, unit: "seconds" },
        { value: payload?.duration_sec, unit: "seconds" },
        { value: session?.durationSec, unit: "seconds" },
        { value: session?.duration_sec, unit: "seconds" },
        { value: payload?.durationMinutes, unit: "minutes" },
        { value: payload?.elapsedMinutes, unit: "minutes" },
        { value: session?.durationMinutes, unit: "minutes" },
        { value: session?.elapsedMinutes, unit: "minutes" },
    ];

    for (const candidate of candidates) {
        const rawValue = Number(candidate.value);
        if (!Number.isFinite(rawValue) || rawValue <= 0) continue;

        const durationSec =
            candidate.unit === "minutes"
                ? Math.floor(rawValue * 60)
                : Math.floor(rawValue);

        if (durationSec > 0 && durationSec < MAX_REASONABLE_DURATION_SEC) {
            return durationSec;
        }
    }

    return 0;
};

const formatLargeNumber = (value) => {
    const num = Math.round(Number(value || 0));
    if (!Number.isFinite(num)) return "0";
    return num.toLocaleString("ja-JP");
};

const getWorkoutTitle = (bodyPartCards, bodyPartLabel) => {
    if (Array.isArray(bodyPartCards) && bodyPartCards.length === 1) {
        return `${bodyPartCards[0].bodyPart}の日`;
    }
    if (Array.isArray(bodyPartCards) && bodyPartCards.length > 1) {
        return bodyPartCards.slice(0, 2).map((item) => item.bodyPart).join(" / ");
    }

    const value = String(bodyPartLabel || "").trim();
    if (!value || value === "まだありません") return "Workout";
    const firstPart = value.split("/")[0]?.trim() || value;
    if (firstPart.length <= 8 && !firstPart.includes(" ")) return `${firstPart}の日`;
    return firstPart;
};

const getBodyPartCards = (summary, items) => {
    const counts = Array.isArray(summary?.setCountByBodyPart) && summary.setCountByBodyPart.length > 0
        ? summary.setCountByBodyPart
        : items;

    return (counts || [])
        .map((item) => ({
            bodyPart: item.bodyPart || item.body_part || "その他",
            count: Number(item.count ?? item.set_count ?? 0),
        }))
        .filter((item) => Number.isFinite(item.count) && item.count > 0)
        .slice(0, 3);
};

const normalizeUnitLabel = (unit) => {
    const value = String(unit || "kg").toLowerCase();
    if (value === "lbs" || value === "lb" || value === "pound" || value === "pounds") return "lb";
    if (value === "bw" || value === "bodyweight") return "自重";
    return "kg";
};

const formatWeightValue = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value || "");
    return Number.isInteger(num) ? String(num) : String(Math.round(num * 10) / 10);
};

const isDisplayableShareSet = (set) => {
    const reps = Number(set?.reps);
    if (!Number.isFinite(reps) || reps <= 0) return false;
    const rawWeight = set?.displayWeight ?? set?.weight;
    if (String(rawWeight || "").toUpperCase() === "BW") return true;
    const weight = Number(rawWeight);
    return Number.isFinite(weight) && weight > 0;
};

const formatShareSet = (set, index) => {
    const reps = formatWeightValue(set?.reps);
    const rawWeight = set?.displayWeight ?? set?.weight;
    if (String(rawWeight || "").toUpperCase() === "BW") {
        return `${index + 1}. 自重 × ${reps}`;
    }

    const unit = normalizeUnitLabel(set?.displayUnit || set?.unit || set?.weightUnit || set?.weight_unit);
    return `${index + 1}. ${formatWeightValue(rawWeight)}${unit} × ${reps}`;
};

const getExerciseDetails = (items, maxExercises = 5) => {
    const details = (items || [])
        .map((item) => {
            const sets = (Array.isArray(item?.sets) ? item.sets : [])
                .filter(isDisplayableShareSet)
                .map(formatShareSet);
            if (!sets.length) return null;

            return {
                name: item.exercise_name || item.name || "種目",
                sets,
            };
        })
        .filter(Boolean);

    return {
        visible: details.slice(0, maxExercises),
        hiddenCount: Math.max(0, details.length - maxExercises),
    };
};

export default function WorkoutSessionShareModal({
    isOpen,
    onClose,
    workoutDate,
    sessionPayload,
    photoRows = [],
}) {
    const [sizeKey, setSizeKey] = useState("story");
    const [sharing, setSharing] = useState(false);
    const cardRef = useRef(null);
    const scrollLockRef = useRef({ top: 0, body: {}, html: {} });

    const preset = CARD_PRESETS[sizeKey] || CARD_PRESETS.story;
    const dateLabel = formatDate(workoutDate);
    const summary = useMemo(
        () => sessionPayload?.session?.summary_json || {},
        [sessionPayload]
    );
    const items = useMemo(
        () => sessionPayload?.preview_items || sessionPayload?.exercises || [],
        [sessionPayload]
    );
    const setCountByBodyPartLabel = useMemo(() => {
        if (Array.isArray(summary?.setCountByBodyPart) && summary.setCountByBodyPart.length > 0) {
            return formatSetCountByBodyPart(summary.setCountByBodyPart, {
                maxParts: 3,
                suffix: "",
                separator: " / ",
            });
        }
        if (items.length > 0) {
            return formatSetCountByBodyPart(items, {
                maxParts: 3,
                suffix: "",
                separator: " / ",
            });
        }
        return "まだありません";
    }, [items, summary]);

    const bodyPartCards = useMemo(() => getBodyPartCards(summary, items), [items, summary]);
    const workoutTitle = getWorkoutTitle(bodyPartCards, setCountByBodyPartLabel);
    const durationLabel = formatDuration(resolveDurationSec(sessionPayload));
    const prCount = Number(summary?.prCount || 0);
    const previewScale = preset.scale || 0.58;
    const isStory = sizeKey === "story";
    const prLabel = prCount > 0 ? `PR更新 ${prCount}件` : "";
    const exerciseDetails = useMemo(
        () => getExerciseDetails(items, isStory ? 5 : 0),
        [isStory, items]
    );

    useEffect(() => {
        if (!isOpen) return undefined;

        const body = document.body;
        const html = document.documentElement;
        const scrollTop = window.scrollY || window.pageYOffset || 0;
        const scrollLock = scrollLockRef.current;

        scrollLock.top = scrollTop;
        scrollLock.body = {
            overflow: body.style.overflow,
            position: body.style.position,
            top: body.style.top,
            width: body.style.width,
            touchAction: body.style.touchAction,
        };
        scrollLock.html = {
            overflow: html.style.overflow,
            overscrollBehavior: html.style.overscrollBehavior,
        };

        body.style.overflow = "hidden";
        body.style.position = "fixed";
        body.style.top = `-${scrollTop}px`;
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
    }, [isOpen]);

    if (!isOpen || !sessionPayload) return null;

    const handleShare = async () => {
        if (!cardRef.current || sharing) return;

        setSharing(true);

        try {
            if (document.fonts?.ready) {
                await document.fonts.ready;
            }

            const blob = await toBlob(cardRef.current, {
                pixelRatio: 3,
                cacheBust: true,
                backgroundColor: "#05070b",
            });

            if (!blob) {
                throw new Error("session share card blob generation failed");
            }

            const file = new File([blob], `pump-workout-${workoutDate}-${preset.key}.png`, {
                type: "image/png",
            });

            const shareData = {
                title: "PUMP",
                text: `${dateLabel} のワークアウト`,
                files: [file],
            };

            if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
                await navigator.share(shareData);
                return;
            }

            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = file.name;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(objectUrl);
        } catch (error) {
            console.error("session share failed", error);
            alert("シェアカードの作成に失敗しました。");
        } finally {
            setSharing(false);
        }
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.72)",
                zIndex: 320,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding:
                    "calc(16px + var(--safe-top, 0px)) 12px calc(12px + var(--safe-bottom, 0px))",
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: "100%",
                    maxWidth: 420,
                    background: "var(--card-modal)",
                    borderRadius: 24,
                    border: "1px solid var(--border2)",
                    boxShadow: "0 22px 44px rgba(15, 23, 42, 0.18)",
                    boxSizing: "border-box",
                    maxHeight:
                        "calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
                onClick={(event) => event.stopPropagation()}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 18px 12px" }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>シェアカードを作成</div>
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                            ワークアウト要約を画像で共有できます
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 20 }}
                    >
                        ×
                    </button>
                </div>

                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                        overscrollBehavior: "contain",
                        padding: "0 18px calc(18px + var(--safe-bottom, 0px))",
                    }}
                >
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        {Object.values(CARD_PRESETS).map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => setSizeKey(option.key)}
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: 999,
                                    border: "1px solid rgba(18, 199, 194, 0.12)",
                                    background: sizeKey === option.key
                                        ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                                        : "var(--card2)",
                                    color: sizeKey === option.key ? "#fff" : "var(--text2)",
                                    fontSize: 12,
                                    fontWeight: 800,
                                }}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, overflow: "hidden" }}>
                        <div
                            style={{
                                width: preset.width * previewScale,
                                height: preset.height * previewScale,
                                overflow: "hidden",
                                borderRadius: 22,
                                boxShadow: "0 24px 48px rgba(15, 23, 42, 0.18)",
                                flexShrink: 0,
                            }}
                        >
                            <div
                                style={{
                                    width: preset.width,
                                    height: preset.height,
                                    transform: `scale(${previewScale})`,
                                    transformOrigin: "top left",
                                }}
                            >
                                <div
                                    ref={cardRef}
                                    style={{
                                        width: preset.width,
                                        height: preset.height,
                                        borderRadius: 30,
                                        overflow: "hidden",
                                        background:
                                            "radial-gradient(circle at 50% 42%, rgba(87, 195, 255, 0.18), transparent 34%), radial-gradient(circle at 86% 82%, rgba(111, 66, 255, 0.16), transparent 30%), linear-gradient(160deg, #05070b 0%, #0d1117 54%, #141016 100%)",
                                        border: "1px solid rgba(255,255,255,0.08)",
                                        boxShadow: "0 30px 60px rgba(15, 23, 42, 0.24)",
                                        display: "flex",
                                        flexDirection: "column",
                                        color: "#fff",
                                        boxSizing: "border-box",
                                        padding: isStory ? "24px 22px 22px" : "22px",
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: isStory ? 18 : 16 }}>
                                        <div>
                                            <div style={{ fontSize: 10, letterSpacing: 3.4, color: "rgba(255,255,255,0.45)", fontWeight: 900, marginBottom: 8 }}>
                                                {dateLabel}
                                            </div>
                                            <div style={{ fontSize: isStory ? 34 : 28, color: "#ffffff", fontWeight: 950, lineHeight: 1.02, letterSpacing: -0.4 }}>
                                                {workoutTitle}
                                            </div>
                                        </div>
                                        <div style={{ padding: "7px 10px", borderRadius: 999, background: "rgba(87,195,255,0.12)", border: "1px solid rgba(87,195,255,0.34)", color: "#62caff", fontSize: 10, fontWeight: 900 }}>
                                            WORKOUT
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1.35fr 0.9fr", gap: isStory ? 14 : 10, marginBottom: isStory ? 16 : 14 }}>
                                        <div>
                                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", fontWeight: 800, letterSpacing: 1.1 }}>
                                                VOLUME
                                            </div>
                                            <div style={{ marginTop: 7, fontSize: isStory ? 46 : 38, fontWeight: 950, lineHeight: 0.9, letterSpacing: -1 }}>
                                                {formatLargeNumber(summary?.totalVolume)}
                                            </div>
                                            <div style={{ marginTop: 4, fontSize: isStory ? 19 : 14, color: "rgba(255,255,255,0.56)", fontWeight: 900 }}>
                                                kg
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", fontWeight: 800, letterSpacing: 1.1 }}>
                                                SETS
                                            </div>
                                            <div style={{ marginTop: 7, fontSize: isStory ? 46 : 38, fontWeight: 950, lineHeight: 0.9, letterSpacing: -1 }}>
                                                {Number(summary?.setCount || 0)}
                                            </div>
                                            <div style={{ marginTop: 4, fontSize: isStory ? 19 : 14, color: "rgba(255,255,255,0.56)", fontWeight: 900 }}>
                                                sets
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: isStory ? 16 : 16 }}>
                                        <div style={{ width: isStory ? 28 : 22, height: isStory ? 28 : 22, borderRadius: 999, border: "2px solid rgba(255,255,255,0.42)", position: "relative", boxSizing: "border-box" }}>
                                            <div style={{ position: "absolute", left: "50%", top: 5, width: 2, height: isStory ? 8 : 6, background: "rgba(255,255,255,0.42)", transform: "translateX(-50%)" }} />
                                            <div style={{ position: "absolute", left: "50%", top: "50%", width: isStory ? 8 : 6, height: 2, background: "rgba(255,255,255,0.42)", transformOrigin: "left center", transform: "translateY(-50%) rotate(25deg)" }} />
                                        </div>
                                        <div style={{ fontSize: isStory ? 22 : 16, color: "#fff", fontWeight: 950 }}>
                                            {durationLabel || "-"}
                                        </div>
                                        <div style={{ fontSize: isStory ? 15 : 11, color: "rgba(255,255,255,0.48)", fontWeight: 900 }}>
                                            TIME
                                        </div>
                                    </div>

                                    <div style={{ color: "rgba(255,255,255,0.34)", fontSize: isStory ? 12 : 10, fontWeight: 800, marginBottom: isStory ? 8 : 8 }}>
                                        部位
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: isStory ? 8 : 7, marginBottom: isStory ? 12 : 14 }}>
                                        {(bodyPartCards.length > 0 ? bodyPartCards : [{ bodyPart: "合計", count: Number(summary?.setCount || 0) }]).map((item) => (
                                            <div
                                                key={`${item.bodyPart}-${item.count}`}
                                                style={{
                                                    minHeight: isStory ? 58 : 52,
                                                    borderRadius: isStory ? 18 : 14,
                                                    background: "rgba(255,255,255,0.075)",
                                                    border: "1px solid rgba(255,255,255,0.05)",
                                                    padding: isStory ? "10px 10px" : "9px 9px",
                                                    boxSizing: "border-box",
                                                }}
                                            >
                                                <div style={{ color: "#fff", fontSize: isStory ? 15 : 11, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {item.bodyPart}
                                                </div>
                                                <div style={{ marginTop: 5, color: "#62caff", fontSize: isStory ? 22 : 18, fontWeight: 950, lineHeight: 0.95 }}>
                                                    {item.count}
                                                    <span style={{ marginLeft: 4, color: "rgba(255,255,255,0.42)", fontSize: isStory ? 12 : 9, fontWeight: 900 }}>sets</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {isStory && prLabel && (
                                        <div style={{ width: "100%", borderRadius: 999, background: "rgba(87, 195, 255, 0.12)", border: "1px solid rgba(87, 195, 255, 0.34)", color: "#dff8ff", padding: "8px 11px", fontSize: 12, fontWeight: 900, boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 10 }}>
                                            PR <span style={{ color: "#62caff", marginLeft: 4 }}>{prLabel}</span>
                                        </div>
                                    )}

                                    {isStory && exerciseDetails.visible.length > 0 && (
                                        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                                            <div style={{ color: "rgba(255,255,255,0.34)", fontSize: 12, fontWeight: 800, marginBottom: 7 }}>
                                                メニュー
                                            </div>
                                            <div style={{ display: "grid", gap: 7 }}>
                                                {exerciseDetails.visible.map((item) => (
                                                    <div
                                                        key={item.name}
                                                        style={{
                                                            borderRadius: 13,
                                                            background: "rgba(17, 24, 39, 0.72)",
                                                            border: "1px solid rgba(255,255,255,0.07)",
                                                            padding: "8px 10px",
                                                        }}
                                                    >
                                                        <div style={{ color: "#fff", fontSize: 12, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                            {item.name}
                                                        </div>
                                                        <div style={{ marginTop: 4, color: "#7DE7E2", fontSize: 10, fontWeight: 800, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2 }}>
                                                            {item.sets.join(" / ")}
                                                        </div>
                                                    </div>
                                                ))}
                                                {exerciseDetails.hiddenCount > 0 && (
                                                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, fontWeight: 800, textAlign: "center" }}>
                                                        +{exerciseDetails.hiddenCount} 種目
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {!isStory && (
                                        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", minHeight: 0 }}>
                                        {prLabel ? (
                                            <div style={{ width: "100%", borderRadius: 999, background: "rgba(87, 195, 255, 0.12)", border: "1px solid rgba(87, 195, 255, 0.34)", color: "#dff8ff", padding: isStory ? "12px 14px" : "8px 10px", fontSize: isStory ? 15 : 11, fontWeight: 900, boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                PR <span style={{ color: "#62caff", marginLeft: 4 }}>{prLabel}</span>
                                            </div>
                                        ) : (
                                            <div />
                                        )}
                                        </div>
                                    )}

                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: isStory ? 22 : 12 }}>
                                        <div style={{ color: "#62caff", fontSize: isStory ? 18 : 14, fontWeight: 950, lineHeight: 1 }}>
                                            Pump
                                        </div>
                                        <div style={{ color: "rgba(255,255,255,0.44)", fontSize: isStory ? 11 : 8, fontWeight: 900, letterSpacing: 3 }}>
                                            WORKOUT TRACKER
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                flex: 1,
                                padding: "14px",
                                borderRadius: 14,
                                background: "var(--card2)",
                                border: "1px solid var(--border2)",
                                color: "var(--text2)",
                                fontSize: 14,
                                fontWeight: 700,
                            }}
                        >
                            閉じる
                        </button>
                        <button
                            type="button"
                            onClick={handleShare}
                            disabled={sharing}
                            style={{
                                flex: 2,
                                padding: "14px",
                                borderRadius: 14,
                                background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                                border: "none",
                                color: "#fff",
                                fontSize: 15,
                                fontWeight: 800,
                                opacity: sharing ? 0.7 : 1,
                            }}
                        >
                            {sharing ? "作成中..." : "共有する"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
