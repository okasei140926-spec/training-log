import { forwardRef } from "react";
import {
  formatSetCountByBodyPart,
  getSetCountTotal,
} from "../../utils/setCountByBodyPart";

const PRESET_STYLES = {
  square: { width: 360, height: 360 },
  story:  { width: 360, height: 640 },
};

const formatVolume = (value) =>
  `${Math.round(Number(value || 0)).toLocaleString("ja-JP")}kg`;

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const formatMonthLabel = (startKey) => {
  const [year, month] = String(startKey || "").split("-");
  if (!year || !month) return "";
  return `${year}年${Number(month)}月`;
};

const buildMonthCalendarCells = (summary) => {
  const [year, month] = String(summary?.startKey || "").split("-").map(Number);
  if (!year || !month) return [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0).getDate();
  const offset = firstDay.getDay();
  const activeDates = new Set((summary?.dailyStats || []).map((item) => item.date));
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push({ key: `empty-${i}`, empty: true });
  for (let day = 1; day <= lastDate; day += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ key, day, active: activeDates.has(key) });
  }
  return cells;
};

/* ─── Dark metric tiles ─────────────────────────────── */
const renderMetric = (label, value, options = {}) => (
  <div
    key={label}
    style={{
      background: "rgba(24, 24, 27, 0.78)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 18,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}
  >
    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", letterSpacing: 1.4 }}>{label}</div>
    <div style={{
      fontSize: options.small ? 13 : 18,
      fontWeight: 900,
      color: "#fff",
      lineHeight: 1.4,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    }}>{value}</div>
  </div>
);

const renderMonthlyMetric = (label, value, options = {}) => (
  <div
    key={label}
    style={{
      background: options.wide
        ? "linear-gradient(135deg, rgba(10,15,25,0.96), rgba(20,28,40,0.98))"
        : "rgba(17,24,39,0.86)",
      border: "1px solid rgba(56,189,248,0.16)",
      borderRadius: options.wide ? 18 : 16,
      padding: options.wide ? "12px 14px" : "12px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 5,
      minHeight: options.wide ? 72 : 82,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
    }}
  >
    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)", letterSpacing: 1.2 }}>{label}</div>
    <div style={{ fontSize: options.wide ? 16 : 20, fontWeight: 900, color: "#fff", lineHeight: 1.3, whiteSpace: "pre-wrap" }}>
      {value}
    </div>
  </div>
);

/* ─── Light metric tiles ────────────────────────────── */
const renderMetricLight = (label, value, options = {}) => (
  <div
    key={label}
    style={{
      background: "#ffffff",
      border: "1px solid rgba(0,184,169,0.18)",
      borderRadius: 18,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      boxShadow: "0 2px 8px rgba(0,184,169,0.06)",
    }}
  >
    <div style={{ fontSize: 10, color: "rgba(26,58,58,0.55)", letterSpacing: 1.4 }}>{label}</div>
    <div style={{
      fontSize: options.small ? 13 : 18,
      fontWeight: 900,
      color: "#1a3a3a",
      lineHeight: 1.4,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    }}>{value}</div>
  </div>
);

const renderMonthlyMetricLight = (label, value, options = {}) => (
  <div
    key={label}
    style={{
      background: "#ffffff",
      border: "1px solid rgba(0,184,169,0.18)",
      borderRadius: options.wide ? 18 : 16,
      padding: options.wide ? "12px 14px" : "12px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 5,
      minHeight: options.wide ? 72 : 82,
      boxShadow: "0 2px 8px rgba(0,184,169,0.06)",
    }}
  >
    <div style={{ fontSize: 10, color: "rgba(26,58,58,0.55)", letterSpacing: 1.2 }}>{label}</div>
    <div style={{ fontSize: options.wide ? 16 : 20, fontWeight: 900, color: "#1a3a3a", lineHeight: 1.3, whiteSpace: "pre-wrap" }}>
      {value}
    </div>
  </div>
);

/* ─── Shared calendar (light theme) ────────────────── */
const renderCalendarLight = (cells, isStory, compactMonthCalendar) => (
  <div
    style={{
      background: "#ffffff",
      borderRadius: 20,
      border: "1px solid rgba(0,184,169,0.16)",
      padding: compactMonthCalendar ? "8px 10px 8px" : isStory ? "12px 12px 10px" : "10px 10px 8px",
      marginBottom: isStory ? 12 : 10,
      boxShadow: "0 2px 8px rgba(0,184,169,0.06)",
    }}
  >
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, marginBottom: 8 }}>
      {WEEKDAY_LABELS.map((label) => (
        <div key={label} style={{ textAlign: "center", fontSize: 10, color: "rgba(26,58,58,0.45)", paddingBottom: 2 }}>
          {label}
        </div>
      ))}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
      {cells.map((cell) => (
        <div
          key={cell.key}
          style={{
            height: compactMonthCalendar ? 24 : isStory ? 30 : 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            background: cell.active ? "rgba(0,184,169,0.12)" : "transparent",
            border: cell.active ? "1px solid rgba(0,184,169,0.28)" : "1px solid transparent",
            position: "relative",
          }}
        >
          {!cell.empty && (
            <>
              <span style={{ fontSize: isStory ? 11 : 10, color: cell.active ? "#006b5e" : "rgba(26,58,58,0.6)", fontWeight: cell.active ? 800 : 500 }}>
                {cell.day}
              </span>
              {cell.active && (
                <span style={{
                  position: "absolute",
                  bottom: isStory ? 4 : 3,
                  width: 4,
                  height: 4,
                  borderRadius: 999,
                  background: "#00b8a9",
                }} />
              )}
            </>
          )}
        </div>
      ))}
    </div>
  </div>
);

/* ════════════════════════════════════════════════════
   Main component
   ════════════════════════════════════════════════════ */
const TrainingSummaryShareCard = forwardRef(function TrainingSummaryShareCard(
  { summary, sizeKey = "square", designKey = "dark-detail" },
  ref
) {
  const preset      = PRESET_STYLES[sizeKey] || PRESET_STYLES.square;
  const isStory     = sizeKey === "story";
  const isMonthly   = summary.group === "monthly";
  const isDark      = designKey === "dark-detail" || designKey === "dark-simple";
  const isSimple    = designKey === "dark-simple"  || designKey === "light-simple";

  /* common computed values */
  const setCountSummary =
    formatSetCountByBodyPart(summary.setCountByBodyPart, {
      sort: "count", maxParts: 3, separator: "\n", suffix: "セット",
    }) || "まだありません";
  const totalSetCount   = getSetCountTotal(summary.setCountByBodyPart || []);
  const topProgress     = summary.prUpdates?.[0] || null;
  const summaryTitle    = isMonthly ? "月間サマリー" : "週間サマリー";
  const growthLabel     = topProgress
    ? `${topProgress.exerciseName}\n+${Math.round(Number(topProgress.diffKg || 0) * 10) / 10}kg`
    : "記録なし";
  const monthLabel            = formatMonthLabel(summary.startKey);
  const monthCalendarCells    = buildMonthCalendarCells(summary);
  const monthCalendarRowCount = Math.ceil(monthCalendarCells.length / 7) || 5;
  const compactMonthCalendar  = isMonthly && isStory && monthCalendarRowCount > 5;

  const relatedSummaries = summary.relatedSummaries || {};
  const prevSummaryKey   = isMonthly ? "last_month" : "last_week";
  const compareLabel     = isMonthly ? "先月比" : "先週比";
  const prevVolume       = relatedSummaries[prevSummaryKey]?.totalVolume;
  const volumeDiff       = (prevVolume != null && prevVolume > 0)
    ? Math.round((summary.totalVolume - prevVolume) / prevVolume * 100)
    : null;
  const compareValue = volumeDiff != null
    ? (volumeDiff > 0 ? `▲${volumeDiff}%` : volumeDiff < 0 ? `▼${Math.abs(volumeDiff)}%` : `±0%`)
    : "-";

  const topWeightEx  = (summary.exerciseStats || []).reduce((best, ex) => {
    if (!best || (ex.maxWeight || 0) > (best.maxWeight || 0)) return ex;
    return best;
  }, null);
  const maxWeightLabel = (topWeightEx && topWeightEx.maxWeight > 0)
    ? `${topWeightEx.exerciseName}\n${topWeightEx.maxWeight}kg`
    : "記録なし";

  /* ── Shared background styles ── */
  const darkWeeklyBg = "radial-gradient(circle at top right, rgba(249,115,22,0.28), transparent 32%), linear-gradient(160deg, #09090b 0%, #18181b 38%, #27272a 100%)";
  const darkMonthlyBg = "radial-gradient(circle at top right, rgba(56,189,248,0.20), transparent 28%), radial-gradient(circle at bottom left, rgba(18,199,194,0.16), transparent 26%), linear-gradient(165deg, #05070b 0%, #0b1220 42%, #111827 100%)";
  const lightBg       = "linear-gradient(160deg, #f2f9f8 0%, #e4f0ef 60%, #ddecea 100%)";

  /* ════════════════════════════════════════════════════
     A / DARK DETAIL (existing)
     ════════════════════════════════════════════════════ */
  if (!isSimple && isDark) {
    /* --- monthly --- */
    if (isMonthly) {
      return (
        <div
          ref={ref}
          style={{
            width: preset.width, height: preset.height,
            borderRadius: 30, overflow: "hidden",
            background: darkMonthlyBg,
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 30px 60px rgba(15,23,42,0.32)",
            display: "flex", flexDirection: "column",
            padding: isStory ? "18px 18px 18px" : "16px",
            boxSizing: "border-box", color: "#fff",
          }}
        >
          <div style={{ marginBottom: isStory ? 12 : 10 }}>
            <div style={{ fontSize: 10, letterSpacing: 2.6, color: "rgba(255,255,255,0.56)", marginBottom: 6 }}>PUMP</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontSize: isStory ? 26 : 22, fontWeight: 900, lineHeight: 1.1, marginBottom: 4 }}>月間サマリー</div>
                <div style={{ fontSize: isStory ? 13 : 12, color: "rgba(255,255,255,0.8)" }}>{monthLabel}</div>
              </div>
              <div style={{ padding: "7px 11px", borderRadius: 999, background: "rgba(18,199,194,0.12)", border: "1px solid rgba(18,199,194,0.28)", color: "#7DE7E2", fontSize: 11, fontWeight: 800 }}>
                {summary.shortLabel}
              </div>
            </div>
          </div>

          <div style={{ background: "linear-gradient(180deg, rgba(8,16,28,0.96), rgba(15,23,42,0.82))", borderRadius: 20, border: "1px solid rgba(56,189,248,0.16)", padding: compactMonthCalendar ? "8px 10px 8px" : isStory ? "12px 12px 10px" : "10px 10px 8px", marginBottom: isStory ? 12 : 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, marginBottom: 8 }}>
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.45)", paddingBottom: 2 }}>{label}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
              {monthCalendarCells.map((cell) => (
                <div key={cell.key} style={{ height: compactMonthCalendar ? 24 : isStory ? 30 : 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: cell.active ? "rgba(18,199,194,0.14)" : "transparent", border: cell.active ? "1px solid rgba(18,199,194,0.24)" : "1px solid transparent", boxShadow: cell.active ? "0 0 0 1px rgba(34,211,238,0.03), 0 10px 18px rgba(18,199,194,0.10)" : "none", position: "relative" }}>
                  {!cell.empty && (
                    <>
                      <span style={{ fontSize: isStory ? 11 : 10, color: cell.active ? "#E6FFFD" : "rgba(255,255,255,0.72)", fontWeight: cell.active ? 800 : 600 }}>{cell.day}</span>
                      {cell.active && <span style={{ position: "absolute", bottom: isStory ? 4 : 3, width: 4, height: 4, borderRadius: 999, background: "#33E1DB", boxShadow: "0 0 10px rgba(51,225,219,0.7)" }} />}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isStory ? 10 : 8 }}>
            {renderMonthlyMetric("トレ日数", `${summary.workoutCount}日`)}
            {renderMonthlyMetric("総ボリューム", formatVolume(summary.totalVolume))}
            {renderMonthlyMetric("合計セット", `${totalSetCount}セット`)}
            {renderMonthlyMetric(compareLabel, compareValue)}
          </div>
          <div style={{ display: "grid", gap: isStory ? 10 : 8, marginTop: isStory ? 10 : 8, flex: 1 }}>
            {renderMonthlyMetric("部位別セット", setCountSummary, { wide: true })}
            {renderMonthlyMetric("一番伸びた種目", growthLabel, { wide: true })}
            {renderMonthlyMetric("最高重量PR", maxWeightLabel, { wide: true })}
          </div>
          <div style={{ marginTop: isStory ? 10 : 8, fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: 2 }}>PUMP</div>
        </div>
      );
    }

    /* --- weekly --- */
    return (
      <div
        ref={ref}
        style={{
          width: preset.width, height: preset.height,
          borderRadius: 30, overflow: "hidden",
          background: darkWeeklyBg,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 30px 60px rgba(15,23,42,0.28)",
          display: "flex", flexDirection: "column",
          padding: isStory ? "20px 20px 20px" : "22px 22px 20px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: isStory ? 14 : 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2.8, color: "rgba(255,255,255,0.6)", marginBottom: isStory ? 6 : 8 }}>PUMP</div>
            <div style={{ fontSize: isStory ? 26 : 30, fontWeight: 900, color: "#fff", marginBottom: 6, lineHeight: isStory ? 1.02 : 1.08 }}>{summaryTitle}</div>
            <div style={{ fontSize: isStory ? 12 : 13, color: "rgba(255,255,255,0.78)" }}>{summary.rangeLabel}</div>
          </div>
          <div style={{ padding: isStory ? "7px 11px" : "8px 12px", borderRadius: 999, background: "rgba(249,115,22,0.14)", border: "1px solid rgba(249,115,22,0.32)", color: "#FDBA74", fontSize: isStory ? 10 : 11, fontWeight: 800 }}>
            {summary.shortLabel}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: isStory ? 8 : 10, flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isStory ? 8 : 10 }}>
            {renderMetric("ワークアウト", `${summary.workoutCount}回`)}
            {renderMetric("総ボリューム", formatVolume(summary.totalVolume))}
            {renderMetric(compareLabel, compareValue)}
            {renderMetric("合計セット", `${totalSetCount}セット`)}
          </div>
          {renderMetric("部位別セット", setCountSummary, { small: true })}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isStory ? 8 : 10 }}>
            {renderMetric("一番伸びた種目", growthLabel, { small: true })}
            {renderMetric("最高重量PR", maxWeightLabel, { small: true })}
          </div>
        </div>
        <div style={{ marginTop: isStory ? 8 : 10, fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2 }}>PUMP</div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════
     B / DARK SIMPLE
     ════════════════════════════════════════════════════ */
  if (isSimple && isDark) {
    const bg = isMonthly ? darkMonthlyBg : darkWeeklyBg;
    const badgeBg     = isMonthly ? "rgba(18,199,194,0.12)"     : "rgba(249,115,22,0.14)";
    const badgeBorder = isMonthly ? "rgba(18,199,194,0.28)"     : "rgba(249,115,22,0.32)";
    const badgeColor  = isMonthly ? "#7DE7E2"                   : "#FDBA74";

    return (
      <div
        ref={ref}
        style={{
          width: preset.width, height: preset.height,
          borderRadius: 30, overflow: "hidden",
          background: bg,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 30px 60px rgba(15,23,42,0.28)",
          display: "flex", flexDirection: "column",
          padding: isStory ? "22px 22px 22px" : "24px 24px 20px",
          boxSizing: "border-box",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: isStory ? 12 : 14 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2.6, color: "rgba(255,255,255,0.5)", marginBottom: 5 }}>PUMP</div>
            <div style={{ fontSize: isStory ? 24 : 26, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>{summaryTitle}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", marginTop: 4 }}>
              {isMonthly ? monthLabel : summary.rangeLabel}
            </div>
          </div>
          <div style={{ padding: "7px 11px", borderRadius: 999, background: badgeBg, border: `1px solid ${badgeBorder}`, color: badgeColor, fontSize: 11, fontWeight: 800 }}>
            {summary.shortLabel}
          </div>
        </div>

        {/* large volume */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: 2, marginBottom: 8 }}>TOTAL VOLUME</div>
          <div style={{ fontSize: isStory ? 72 : 60, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: -2 }}>
            {Math.round(Number(summary.totalVolume || 0)).toLocaleString("ja-JP")}
          </div>
          <div style={{ fontSize: 18, color: "rgba(255,255,255,0.55)", fontWeight: 700, marginTop: 4 }}>kg</div>

          {/* two key metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: isStory ? 28 : 20, width: "100%" }}>
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: "14px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.2, marginBottom: 6 }}>
                {isMonthly ? "トレ日数" : "ワークアウト"}
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>
                {isMonthly ? `${summary.workoutCount}日` : `${summary.workoutCount}回`}
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: "14px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.2, marginBottom: 6 }}>合計セット</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>{totalSetCount}セット</div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 2, marginTop: 10 }}>PUMP</div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════
     C / LIGHT DETAIL
     ════════════════════════════════════════════════════ */
  if (!isSimple && !isDark) {
    /* --- monthly --- */
    if (isMonthly) {
      return (
        <div
          ref={ref}
          style={{
            width: preset.width, height: preset.height,
            borderRadius: 30, overflow: "hidden",
            background: lightBg,
            border: "1px solid rgba(0,184,169,0.18)",
            boxShadow: "0 30px 60px rgba(0,100,90,0.12)",
            display: "flex", flexDirection: "column",
            padding: isStory ? "18px 18px 18px" : "16px",
            boxSizing: "border-box", color: "#1a3a3a",
          }}
        >
          <div style={{ marginBottom: isStory ? 12 : 10 }}>
            <div style={{ fontSize: 10, letterSpacing: 2.6, color: "rgba(26,58,58,0.5)", marginBottom: 6 }}>PUMP</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontSize: isStory ? 26 : 22, fontWeight: 900, lineHeight: 1.1, marginBottom: 4 }}>月間サマリー</div>
                <div style={{ fontSize: isStory ? 13 : 12, color: "rgba(26,58,58,0.7)" }}>{monthLabel}</div>
              </div>
              <div style={{ padding: "7px 11px", borderRadius: 999, background: "rgba(0,184,169,0.12)", border: "1px solid rgba(0,184,169,0.28)", color: "#007a6e", fontSize: 11, fontWeight: 800 }}>
                {summary.shortLabel}
              </div>
            </div>
          </div>

          {renderCalendarLight(monthCalendarCells, isStory, compactMonthCalendar)}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isStory ? 10 : 8 }}>
            {renderMonthlyMetricLight("トレ日数", `${summary.workoutCount}日`)}
            {renderMonthlyMetricLight("総ボリューム", formatVolume(summary.totalVolume))}
            {renderMonthlyMetricLight("合計セット", `${totalSetCount}セット`)}
            {renderMonthlyMetricLight(compareLabel, compareValue)}
          </div>
          <div style={{ display: "grid", gap: isStory ? 10 : 8, marginTop: isStory ? 10 : 8, flex: 1 }}>
            {renderMonthlyMetricLight("部位別セット", setCountSummary, { wide: true })}
            {renderMonthlyMetricLight("一番伸びた種目", growthLabel, { wide: true })}
            {renderMonthlyMetricLight("最高重量PR", maxWeightLabel, { wide: true })}
          </div>
          <div style={{ marginTop: isStory ? 10 : 8, fontSize: 10, color: "rgba(26,58,58,0.38)", letterSpacing: 2 }}>PUMP</div>
        </div>
      );
    }

    /* --- weekly --- */
    return (
      <div
        ref={ref}
        style={{
          width: preset.width, height: preset.height,
          borderRadius: 30, overflow: "hidden",
          background: lightBg,
          border: "1px solid rgba(0,184,169,0.18)",
          boxShadow: "0 30px 60px rgba(0,100,90,0.12)",
          display: "flex", flexDirection: "column",
          padding: isStory ? "20px 20px 20px" : "22px 22px 20px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: isStory ? 14 : 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2.8, color: "rgba(26,58,58,0.5)", marginBottom: isStory ? 6 : 8 }}>PUMP</div>
            <div style={{ fontSize: isStory ? 26 : 30, fontWeight: 900, color: "#1a3a3a", marginBottom: 6, lineHeight: isStory ? 1.02 : 1.08 }}>{summaryTitle}</div>
            <div style={{ fontSize: isStory ? 12 : 13, color: "rgba(26,58,58,0.65)" }}>{summary.rangeLabel}</div>
          </div>
          <div style={{ padding: isStory ? "7px 11px" : "8px 12px", borderRadius: 999, background: "rgba(0,184,169,0.12)", border: "1px solid rgba(0,184,169,0.3)", color: "#007a6e", fontSize: isStory ? 10 : 11, fontWeight: 800 }}>
            {summary.shortLabel}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: isStory ? 8 : 10, flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isStory ? 8 : 10 }}>
            {renderMetricLight("ワークアウト", `${summary.workoutCount}回`)}
            {renderMetricLight("総ボリューム", formatVolume(summary.totalVolume))}
            {renderMetricLight(compareLabel, compareValue)}
            {renderMetricLight("合計セット", `${totalSetCount}セット`)}
          </div>
          {renderMetricLight("部位別セット", setCountSummary, { small: true })}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isStory ? 8 : 10 }}>
            {renderMetricLight("一番伸びた種目", growthLabel, { small: true })}
            {renderMetricLight("最高重量PR", maxWeightLabel, { small: true })}
          </div>
        </div>
        <div style={{ marginTop: isStory ? 8 : 10, fontSize: 11, color: "rgba(26,58,58,0.38)", letterSpacing: 2 }}>PUMP</div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════
     D / LIGHT SIMPLE
     ════════════════════════════════════════════════════ */
  return (
    <div
      ref={ref}
      style={{
        width: preset.width, height: preset.height,
        borderRadius: 30, overflow: "hidden",
        background: lightBg,
        border: "1px solid rgba(0,184,169,0.18)",
        boxShadow: "0 30px 60px rgba(0,100,90,0.12)",
        display: "flex", flexDirection: "column",
        padding: isStory ? "22px 22px 22px" : "24px 24px 20px",
        boxSizing: "border-box",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: isStory ? 12 : 14 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 2.6, color: "rgba(26,58,58,0.45)", marginBottom: 5 }}>PUMP</div>
          <div style={{ fontSize: isStory ? 24 : 26, fontWeight: 900, color: "#1a3a3a", lineHeight: 1.1 }}>{summaryTitle}</div>
          <div style={{ fontSize: 12, color: "rgba(26,58,58,0.6)", marginTop: 4 }}>
            {isMonthly ? monthLabel : summary.rangeLabel}
          </div>
        </div>
        <div style={{ padding: "7px 11px", borderRadius: 999, background: "rgba(0,184,169,0.12)", border: "1px solid rgba(0,184,169,0.28)", color: "#007a6e", fontSize: 11, fontWeight: 800 }}>
          {summary.shortLabel}
        </div>
      </div>

      {/* large volume */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0 }}>
        <div style={{ fontSize: 10, color: "rgba(26,58,58,0.45)", letterSpacing: 2, marginBottom: 8 }}>TOTAL VOLUME</div>
        <div style={{ fontSize: isStory ? 72 : 60, fontWeight: 900, color: "#1a3a3a", lineHeight: 1, letterSpacing: -2 }}>
          {Math.round(Number(summary.totalVolume || 0)).toLocaleString("ja-JP")}
        </div>
        <div style={{ fontSize: 18, color: "rgba(26,58,58,0.45)", fontWeight: 700, marginTop: 4 }}>kg</div>

        {/* two key metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: isStory ? 28 : 20, width: "100%" }}>
          <div style={{ background: "#fff", border: "1px solid rgba(0,184,169,0.18)", borderRadius: 18, padding: "14px 12px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,184,169,0.06)" }}>
            <div style={{ fontSize: 10, color: "rgba(26,58,58,0.5)", letterSpacing: 1.2, marginBottom: 6 }}>
              {isMonthly ? "トレ日数" : "ワークアウト"}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#1a3a3a" }}>
              {isMonthly ? `${summary.workoutCount}日` : `${summary.workoutCount}回`}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid rgba(0,184,169,0.18)", borderRadius: 18, padding: "14px 12px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,184,169,0.06)" }}>
            <div style={{ fontSize: 10, color: "rgba(26,58,58,0.5)", letterSpacing: 1.2, marginBottom: 6 }}>合計セット</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#1a3a3a" }}>{totalSetCount}セット</div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "rgba(26,58,58,0.35)", letterSpacing: 2, marginTop: 10 }}>PUMP</div>
    </div>
  );
});

export default TrainingSummaryShareCard;
