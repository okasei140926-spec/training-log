import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { formatWorkoutDuration } from "../../utils/workoutTimer";
import {
  buildExerciseItems,
  buildStoryExerciseList,
  formatHeaderDate,
  formatPrDetailValue,
  getBodyPartDisplayData,
} from "../../utils/shareCardUtils";

const CARD_PRESETS = {
  square: { key: "square", label: "1:1",  width: 360, height: 360, scale: 0.84 },
  story:  { key: "story",  label: "9:16", width: 360, height: 640, scale: 0.58 },
};

const MAX_REASONABLE_DURATION_SEC = 12 * 60 * 60;

const BAR_COLORS = ["#14A99C", "#4FC4B9", "#9BDDD6"];

const resolveDurationSec = (payload) => {
  const session = payload?.session || {};
  const candidates = [
    { value: payload?.durationSec,     unit: "seconds" },
    { value: payload?.duration_sec,    unit: "seconds" },
    { value: session?.durationSec,     unit: "seconds" },
    { value: session?.duration_sec,    unit: "seconds" },
    { value: payload?.durationMinutes, unit: "minutes" },
    { value: payload?.elapsedMinutes,  unit: "minutes" },
    { value: session?.durationMinutes, unit: "minutes" },
    { value: session?.elapsedMinutes,  unit: "minutes" },
  ];
  for (const c of candidates) {
    const raw = Number(c.value);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const sec = c.unit === "minutes" ? Math.floor(raw * 60) : Math.floor(raw);
    if (sec > 0 && sec < MAX_REASONABLE_DURATION_SEC) return sec;
  }
  return 0;
};

const formatLargeNumber = (value) => {
  const num = Math.round(Number(value || 0));
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("ja-JP");
};

// maxRows: 種目行＋ラベル行を含む総行数の上限。
// list.length > maxRows のとき、(maxRows-1) 件を表示し、残りを hiddenCount で返す。
// 上限以内なら全件表示。
const limitList = (list, maxRows) => {
  if (maxRows == null || list.length <= maxRows) return { visible: list, hiddenCount: 0 };
  const visibleCount = maxRows - 1;
  return { visible: list.slice(0, visibleCount), hiddenCount: list.length - visibleCount };
};

const getBodyPartCards = (summary, items) => {
  const counts =
    Array.isArray(summary?.setCountByBodyPart) && summary.setCountByBodyPart.length > 0
      ? summary.setCountByBodyPart
      : items;
  return (counts || [])
    .map((item) => ({
      bodyPart: item.bodyPart || item.body_part || "その他",
      count: Number(item.count ?? item.set_count ?? 0),
    }))
    .filter((item) => Number.isFinite(item.count) && item.count > 0);
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

  const preset   = CARD_PRESETS[sizeKey] || CARD_PRESETS.story;
  const isStory  = sizeKey === "story";

  const summary = useMemo(
    () => sessionPayload?.session?.summary_json || {},
    [sessionPayload]
  );
  const items = useMemo(
    () => sessionPayload?.preview_items || sessionPayload?.exercises || [],
    [sessionPayload]
  );

  const durationSec  = resolveDurationSec(sessionPayload);
  const durationLabel = formatWorkoutDuration(durationSec);
  const headerLabel  = useMemo(() => {
    const dateStr = formatHeaderDate(workoutDate);
    return durationLabel ? `${dateStr}・${durationLabel}` : dateStr;
  }, [workoutDate, durationLabel]);

  const bodyPartCards = useMemo(() => getBodyPartCards(summary, items), [summary, items]);

  // ─── 分岐判定（全て1箇所にまとめる） ─────────────────────────────────────
  const weeklyDays = summary?.weeklyDays || [];
  const weeklyTrainedCount =
    typeof summary?.weeklyTrainedCount === "number"
      ? summary.weeklyTrainedCount
      : weeklyDays.filter((d) => d.trained).length;
  const prDetail = summary?.prDetail ?? null;
  const hasPr    = prDetail != null;                     // PR あり/なし

  const bodyPartMaxVisible = isStory ? 4 : 3;           // 9:16: 4件 / 1:1: 3件
  const { visible: visibleBodyParts, hiddenCount: hiddenBodyPartCount, maxCount: maxBodyPartCount } =
    useMemo(() => getBodyPartDisplayData(bodyPartCards, bodyPartMaxVisible), [bodyPartCards, bodyPartMaxVisible]);

  const exerciseItems    = useMemo(() => buildExerciseItems(items), [items]);
  const isCompactList    = exerciseItems.length >= 4;    // 4+: 1行コンパクト / 3-: 2段全セット
  const storyExerciseList = useMemo(
    () => buildStoryExerciseList(exerciseItems, isCompactList),
    [exerciseItems, isCompactList]
  );
  // 総行数上限（種目行＋ラベル行）: 部位4件→5行 / 部位3件以下→6行（9:16 のみ）
  const maxListRows = isStory ? (visibleBodyParts.length >= 4 ? 5 : 6) : null;
  const { visible: visibleExerciseList, hiddenCount: hiddenExerciseCount } = useMemo(
    () => limitList(storyExerciseList, maxListRows),
    [storyExerciseList, maxListRows]
  );
  // ─────────────────────────────────────────────────────────────────────────

  const previewScale = preset.scale;
  const cardHeight   = preset.height; // 常に固定

  useEffect(() => {
    if (!isOpen) return undefined;
    const body = document.body;
    const html = document.documentElement;
    const scrollTop = window.scrollY || window.pageYOffset || 0;
    const scrollLock = scrollLockRef.current;
    scrollLock.top = scrollTop;
    scrollLock.body = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width, touchAction: body.style.touchAction };
    scrollLock.html = { overflow: html.style.overflow, overscrollBehavior: html.style.overscrollBehavior };
    body.style.overflow = "hidden"; body.style.position = "fixed"; body.style.top = `-${scrollTop}px`;
    body.style.width = "100%"; body.style.touchAction = "none";
    html.style.overflow = "hidden"; html.style.overscrollBehavior = "none";
    return () => {
      body.style.overflow = scrollLock.body.overflow || "";   body.style.position = scrollLock.body.position || "";
      body.style.top      = scrollLock.body.top || "";        body.style.width    = scrollLock.body.width || "";
      body.style.touchAction = scrollLock.body.touchAction || "";
      html.style.overflow = scrollLock.html.overflow || "";   html.style.overscrollBehavior = scrollLock.html.overscrollBehavior || "";
      window.scrollTo(0, scrollLock.top || 0);
    };
  }, [isOpen]);

  if (!isOpen || !sessionPayload) return null;

  const handleShare = async () => {
    if (!cardRef.current || sharing) return;
    setSharing(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const blob = await toBlob(cardRef.current, {
        pixelRatio: 3,
        cacheBust: true,
        backgroundColor: "#EDF3F2",
      });
      if (!blob) throw new Error("session share card blob generation failed");
      const file = new File([blob], `pump-workout-${workoutDate}-${preset.key}.png`, { type: "image/png" });
      const shareData = { title: "PUMP", text: `${workoutDate} のワークアウト`, files: [file] };
      if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
        await navigator.share(shareData);
        return;
      }
      const url    = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.name;
      document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("session share failed", error);
      alert("シェアカードの作成に失敗しました。");
    } finally {
      setSharing(false);
    }
  };

  // ─── カード内セクション ────────────────────────────────────────────────────

  // (1) ヘッダー行
  const CardHeader = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <div style={{ fontSize: isStory ? 12 : 11, fontWeight: 600, color: "#5A6B68", letterSpacing: "0.03em" }}>
        {headerLabel}
      </div>
      <div style={{ fontSize: isStory ? 13 : 12, fontWeight: 800, letterSpacing: "0.1em", color: "#12201E" }}>
        PUMP
      </div>
    </div>
  );

  // (2) 数値タイル行
  const StatsTiles = (
    <div style={{ marginTop: isStory ? 16 : 10, display: "flex", gap: isStory ? 8 : 7 }}>
      {/* 総ボリューム */}
      <div style={{ flex: 1.5, background: "#FFFFFF", borderRadius: isStory ? 14 : 12, padding: isStory ? "14px 16px" : "11px 13px" }}>
        <div style={{ fontSize: isStory ? 10 : 9, fontWeight: 700, letterSpacing: "0.1em", color: "#5A6B68" }}>
          総ボリューム
        </div>
        <div style={{ marginTop: 4, fontSize: isStory ? 36 : 28, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, color: "#12201E" }}>
          {formatLargeNumber(summary?.totalVolume)}
          <span style={{ fontSize: isStory ? 15 : 12, fontWeight: 600, color: "#5A6B68" }}> kg</span>
        </div>
      </div>
      {/* セット */}
      <div style={{ flex: 1, background: "#FFFFFF", borderRadius: isStory ? 14 : 12, padding: isStory ? "14px 16px" : "11px 13px" }}>
        <div style={{ fontSize: isStory ? 10 : 9, fontWeight: 700, letterSpacing: "0.1em", color: "#5A6B68" }}>
          セット
        </div>
        <div style={{ marginTop: 4, fontSize: isStory ? 36 : 28, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, color: "#12201E" }}>
          {Number(summary?.setCount || 0)}
        </div>
      </div>
    </div>
  );

  // (3) 部位別カード
  const BodyPartCard = visibleBodyParts.length > 0 && (
    <div style={{ marginTop: isStory ? 14 : 9, background: "#FFFFFF", borderRadius: isStory ? 14 : 12, padding: isStory ? "15px 16px" : "13px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: isStory ? 11 : 10, fontWeight: 700, letterSpacing: "0.08em", color: "#5A6B68" }}>
          部位別セット数
        </div>
        {hiddenBodyPartCount > 0 && (
          <div style={{ fontSize: 10, fontWeight: 500, color: "#5A6B68" }}>
            他{hiddenBodyPartCount}部位
          </div>
        )}
      </div>
      <div style={{ marginTop: isStory ? 12 : 10, display: "flex", flexDirection: "column", gap: isStory ? 10 : 8 }}>
        {visibleBodyParts.map((item, index) => (
          <div key={item.bodyPart} data-testid="body-part-row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: isStory ? 42 : 38, fontSize: isStory ? 13 : 12, fontWeight: 600, color: "#12201E", flexShrink: 0 }}>
              {item.bodyPart}
            </div>
            <div style={{ flex: 1, height: isStory ? 18 : 14, borderRadius: isStory ? 5 : 4, background: "#E0EAE8", position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${(item.count / maxBodyPartCount) * 100}%`,
                borderRadius: isStory ? 5 : 4,
                background: BAR_COLORS[Math.min(index, BAR_COLORS.length - 1)],
              }} />
            </div>
            <div style={{ width: isStory ? 22 : 20, textAlign: "right", fontSize: isStory ? 15 : 13, fontWeight: 700, color: "#12201E", flexShrink: 0 }}>
              {item.count}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // (4) 今週カード + 右カード（story）/ 横長帯（square）
  const WeeklyPrSection = isStory ? (
    <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
      {/* 今週カード */}
      <div style={{ flex: 1, background: "#FFFFFF", borderRadius: 14, padding: "15px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#5A6B68" }}>
          今週
        </div>
        <div style={{ marginTop: 11, display: "flex", gap: 5 }}>
          {weeklyDays.map((day) => {
            const isCardDate = day.dateKey === workoutDate;
            return (
              <div key={day.dateKey} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: isCardDate ? 700 : 600, color: isCardDate ? "#12201E" : "#5A6B68" }}>
                  {day.weekdayLabel}
                </div>
                <div
                  data-testid="weekly-day-block"
                  data-date={day.dateKey}
                  data-trained={day.trained ? "true" : "false"}
                  data-is-card-date={isCardDate ? "true" : "false"}
                  style={{
                    marginTop: 5, height: 20, borderRadius: 6,
                    background: isCardDate ? "#0C6B62" : day.trained ? "#14A99C" : "#E0EAE8",
                    ...(isCardDate ? { boxShadow: "0 0 0 2px #FFFFFF, 0 0 0 4px #0C6B62" } : {}),
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {/* 右カード */}
      <div
        data-testid="pr-stats-card"
        style={{ width: 132, background: "#0C6B62", color: "#FFFFFF", borderRadius: 14, padding: "15px 14px", boxSizing: "border-box" }}
      >
        {hasPr ? (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.9 }}>
              自己ベスト更新
            </div>
            <div data-testid="pr-exercise-name" style={{ marginTop: 8, fontSize: 11, fontWeight: 600, lineHeight: 1.3 }}>
              {prDetail.exerciseName}
            </div>
            <div data-testid="pr-value" style={{ marginTop: 3, fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
              {formatPrDetailValue(prDetail)}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.9 }}>
              今週
            </div>
            <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 3 }}>
              <span data-testid="weekly-trained-count" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1 }}>
                {weeklyTrainedCount}
              </span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>日目</span>
            </div>
          </div>
        )}
      </div>
    </div>
  ) : (
    // 1:1 card: 横長の帯
    <div
      data-testid="pr-stats-strip"
      style={{ marginTop: 9, background: "#0C6B62", color: "#FFFFFF", borderRadius: 12, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
    >
      {hasPr ? (
        <>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.9 }}>
              自己ベスト更新
            </div>
            <div data-testid="pr-exercise-name" style={{ marginTop: 2, fontSize: 12, fontWeight: 600 }}>
              {prDetail.exerciseName}
            </div>
          </div>
          <div data-testid="pr-value" style={{ fontSize: 17, fontWeight: 800, whiteSpace: "nowrap" }}>
            {formatPrDetailValue(prDetail)}
          </div>
        </>
      ) : (
        <>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.9 }}>
              今週
            </div>
            <div style={{ marginTop: 2, fontSize: 12, fontWeight: 600 }}>
              トレーニング
            </div>
          </div>
          <div data-testid="weekly-trained-count" style={{ fontSize: 17, fontWeight: 800, whiteSpace: "nowrap" }}>
            {weeklyTrainedCount}日目
          </div>
        </>
      )}
    </div>
  );

  // (5) 種目リスト（story のみ）
  const ExerciseList = isStory && visibleExerciseList.length > 0 && (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: isCompactList ? 9 : 13, flex: "1 1 auto", overflow: "hidden" }}>
      {visibleExerciseList.map((item) =>
        isCompactList ? (
          <div key={item.name} data-testid="exercise-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <div data-testid="exercise-name" style={{ fontSize: 12.5, fontWeight: 600, color: "#12201E" }}>
              {item.name}
            </div>
            <div data-testid="exercise-sets-label" style={{ fontSize: 10.5, fontWeight: 500, color: "#5A6B68", whiteSpace: "nowrap" }}>
              {item.setsLabel}
            </div>
          </div>
        ) : (
          <div key={item.name} data-testid="exercise-item">
            <div data-testid="exercise-name" style={{ fontSize: 13, fontWeight: 600, color: "#12201E" }}>
              {item.name}
            </div>
            <div data-testid="exercise-sets-label" style={{ marginTop: 3, fontSize: 11, fontWeight: 500, color: "#5A6B68" }}>
              {item.setsLabel}
            </div>
          </div>
        )
      )}
      {hiddenExerciseCount > 0 && (
        <div data-testid="hidden-exercise-label" style={{ fontSize: 10.5, fontWeight: 500, color: "#5A6B68" }}>
          他{hiddenExerciseCount}種目
        </div>
      )}
    </div>
  );

  // (6) フッター
  const Footer = (
    <div style={{ marginTop: "auto", paddingTop: isStory ? 14 : 10, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexShrink: 0 }}>
      <div style={{ fontSize: isStory ? 18 : 16, fontWeight: 800, letterSpacing: "0.06em", color: "#12201E" }}>
        PUMP
      </div>
      <div style={{ fontSize: isStory ? 10 : 9.5, fontWeight: 500, color: "#5A6B68" }}>
        トレーニング記録アプリ
      </div>
    </div>
  );

  // ─── モーダル本体 ──────────────────────────────────────────────────────────

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.72)", zIndex: 750, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "calc(16px + var(--safe-top, 0px)) 0 0" }}
      onClick={onClose}
    >
      <div
        style={{ width: "100%", maxWidth: 420, background: "var(--card-modal)", borderRadius: "24px 24px 0 0", border: "1px solid var(--border2)", boxShadow: "0 22px 44px rgba(15, 23, 42, 0.18)", boxSizing: "border-box", maxHeight: "calc(100dvh - 16px - var(--safe-top, 0px))", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* モーダルヘッダー */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 18px 12px" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>シェアカードを作成</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>ワークアウト要約を画像で共有できます</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 20 }}>×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", padding: "0 18px calc(20px + var(--safe-bottom, 0px))" }}>
          {/* サイズ切替 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {Object.values(CARD_PRESETS).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSizeKey(option.key)}
                style={{ padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(18, 199, 194, 0.12)", background: sizeKey === option.key ? "linear-gradient(135deg, #0F5E63, #12C7C2)" : "var(--card2)", color: sizeKey === option.key ? "#fff" : "var(--text2)", fontSize: 12, fontWeight: 800 }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* カードプレビュー */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, overflow: "hidden" }}>
            <div style={{ width: preset.width * previewScale, height: cardHeight * previewScale, overflow: "hidden", borderRadius: 22, boxShadow: "0 24px 48px rgba(15, 23, 42, 0.18)", flexShrink: 0 }}>
              <div style={{ width: preset.width, height: cardHeight, transform: `scale(${previewScale})`, transformOrigin: "top left" }}>
                {/* ── カード本体 ── */}
                <div
                  ref={cardRef}
                  style={{
                    width: preset.width,
                    height: cardHeight,
                    boxSizing: "border-box",
                    padding: isStory ? 22 : 20,
                    display: "flex",
                    flexDirection: "column",
                    background: "#EDF3F2",
                    borderRadius: 30,
                    overflow: "hidden",
                    color: "#12201E",
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Noto Sans JP', sans-serif",
                  }}
                >
                  {CardHeader}
                  {StatsTiles}
                  {BodyPartCard}
                  {WeeklyPrSection}
                  {ExerciseList}
                  {Footer}
                </div>
              </div>
            </div>
          </div>

          {/* 共有ボタン */}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text2)", fontSize: 14, fontWeight: 700 }}>
              閉じる
            </button>
            <button type="button" onClick={handleShare} disabled={sharing} style={{ flex: 2, padding: "14px", borderRadius: 14, background: "linear-gradient(135deg, var(--accent), var(--accent2))", border: "none", color: "#fff", fontSize: 15, fontWeight: 800, opacity: sharing ? 0.7 : 1 }}>
              {sharing ? "作成中..." : "共有する"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
