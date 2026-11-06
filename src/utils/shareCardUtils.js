import { formatKg } from "./helpers";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// ─── prDetail ────────────────────────────────────────────────────────────────

/**
 * calcPrEntries の戻り値（rmGain 降順）の先頭1件から prDetail を生成する。
 * PR が0件なら null。
 */
export function buildPrDetail(prEntries) {
  if (!Array.isArray(prEntries) || prEntries.length === 0) return null;
  const first = prEntries[0];
  return {
    exerciseName: String(first.exerciseName || ""),
    weight: first.weight,
    reps: Number(first.reps),
    unit: String(first.unit || "kg"),
  };
}

// ─── weeklyDays ───────────────────────────────────────────────────────────────

/**
 * workoutDate を含む週（日曜始まり）の7日分を返す。
 * trained = true: history のいずれかのレコードにその日付が存在する。
 * currentDate: 指定すると追加で trained 扱いにする
 *   （LogScreen 経路: 記録中の当日は history 未到達の可能性があるため）。
 *
 * @param {string} workoutDate  YYYY-MM-DD
 * @param {Object} history      { exerciseName: records[] }
 * @param {string|null} currentDate  追加で trained にする日付
 * @returns {{ dateKey: string, weekdayLabel: string, trained: boolean }[]}
 */
export function computeWeeklyDays(workoutDate, history, currentDate = null) {
  const trainedDates = new Set();
  Object.values(history || {}).forEach((records) => {
    (records || []).forEach((r) => {
      const d = String(r?.date || r?.workoutDate || r?.workout_date || "").slice(0, 10);
      if (d) trainedDates.add(d);
    });
  });
  if (currentDate) trainedDates.add(currentDate);

  const ref = new Date(workoutDate + "T00:00:00");
  if (!Number.isFinite(ref.getTime())) return [];
  const dow = ref.getDay(); // 0=Sun, 6=Sat

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ref);
    d.setDate(ref.getDate() - dow + i);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    const dateKey = `${yr}-${mo}-${dy}`;
    days.push({
      dateKey,
      weekdayLabel: WEEKDAY_LABELS[i],
      trained: trainedDates.has(dateKey),
    });
  }
  return days;
}

// ─── 部位別表示データ ─────────────────────────────────────────────────────────

/**
 * bodyPartCards をセット数の多い順にソートし、表示データを返す。
 * maxVisible を超えた場合は上位 maxVisible 件のみ表示し、残りの件数を hiddenCount で返す。
 * @param {Object[]} bodyPartCards
 * @param {number} maxVisible  表示上限（1:1=3、9:16=4）
 */
export function getBodyPartDisplayData(bodyPartCards, maxVisible = 4) {
  const sorted = [...(bodyPartCards || [])].sort((a, b) => b.count - a.count);
  const visible = sorted.length > maxVisible ? sorted.slice(0, maxVisible) : sorted;
  const hiddenCount = sorted.length - visible.length;
  const maxCount = visible.length > 0 ? Math.max(1, visible[0].count) : 1;
  return { visible, hiddenCount, maxCount };
}

// ─── 種目リスト ───────────────────────────────────────────────────────────────

/**
 * unit 文字列を正規化する。
 * "lbs" / "lb" / "pound" → "lb"
 * "bw" / "bodyweight" → "bw"
 * それ以外 → "kg"
 */
export function normalizeUnit(unit) {
  const v = String(unit || "kg").toLowerCase();
  if (v === "lbs" || v === "lb" || v === "pound" || v === "pounds") return "lb";
  if (v === "bw" || v === "bodyweight") return "bw";
  return "kg";
}

/**
 * 1セットを「105kg × 3」「自重 × 3」の形式に変換する。
 * 表示できないセットは null を返す。
 */
export function formatSetLabel(set) {
  const reps = Number(set?.reps);
  if (!Number.isFinite(reps) || reps <= 0) return null;
  const rawWeight = set?.displayWeight ?? set?.weight;
  if (String(rawWeight || "").toUpperCase() === "BW") return `自重 × ${reps}`;
  const weight = Number(rawWeight);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const unit = normalizeUnit(set?.displayUnit || set?.unit || set?.weightUnit || set?.weight_unit);
  const kgWeight = unit === "lb" ? weight * 0.453592 : weight;
  return `${formatKg(kgWeight)}kg × ${reps}`;
}

/** セットが表示可能かどうかの判定（filterに使う） */
function isDisplayable(set) {
  const reps = Number(set?.reps);
  if (!Number.isFinite(reps) || reps <= 0) return false;
  const rawWeight = set?.displayWeight ?? set?.weight;
  if (String(rawWeight || "").toUpperCase() === "BW") return true;
  const weight = Number(rawWeight);
  return Number.isFinite(weight) && weight > 0;
}

/**
 * preview_items / exercises 配列から種目ごとの表示用アイテムを構築する。
 * @returns {{ name: string, sets: object[] }[]}
 */
export function buildExerciseItems(rawItems) {
  return (rawItems || [])
    .map((item) => {
      const sets = (Array.isArray(item?.sets) ? item.sets : []).filter(isDisplayable);
      if (!sets.length) return null;
      return {
        name: String(item?.exercise_name || item?.name || "種目"),
        sets,
      };
    })
    .filter(Boolean);
}

/**
 * ストーリーカード用の種目リストを構築する。
 *
 * isCompact = true  (種目4件以上): 上位2セットのみ、区切り " / "
 * isCompact = false (種目3件以下): 全セット、区切り " ／ "
 *
 * @param {{ name: string, sets: object[] }[]} exerciseItems
 * @param {boolean} isCompact
 * @returns {{ name: string, setsLabel: string }[]}
 */
export function buildStoryExerciseList(exerciseItems, isCompact) {
  const maxSets = isCompact ? 2 : null;
  const sep = isCompact ? " / " : " ／ ";
  return exerciseItems
    .map((item) => {
      const displaySets = maxSets != null ? item.sets.slice(0, maxSets) : item.sets;
      const setsLabel = displaySets.map(formatSetLabel).filter(Boolean).join(sep);
      if (!setsLabel) return null;
      return { name: item.name, setsLabel };
    })
    .filter(Boolean);
}

// ─── PR 値フォーマット ────────────────────────────────────────────────────────

/**
 * prDetail の重量×回数を「36kg × 11」「自重 × 5」の形式に変換する。
 */
export function formatPrDetailValue(prDetail) {
  if (!prDetail) return "";
  const { weight, reps } = prDetail;
  const repsNum = Number(reps);
  if (String(weight || "").toUpperCase() === "BW") return `自重 × ${repsNum}`;
  const weightNum = Number(weight);
  if (!Number.isFinite(weightNum) || weightNum <= 0) return "";
  const unit = normalizeUnit(prDetail.unit);
  const kgWeight = unit === "lb" ? weightNum * 0.453592 : weightNum;
  return `${formatKg(kgWeight)}kg × ${repsNum}`;
}

// ─── ヘッダー日付 ─────────────────────────────────────────────────────────────

/**
 * YYYY-MM-DD → YYYY / MM / DD（曜）
 */
export function formatHeaderDate(dateStr) {
  const v = String(dateStr || "");
  if (!v) return "";
  const [year, month, day] = v.split("-");
  const d = new Date(v + "T00:00:00");
  const weekday = Number.isFinite(d.getTime()) ? WEEKDAY_LABELS[d.getDay()] : "";
  return `${year} / ${month} / ${day}（${weekday}）`;
}
