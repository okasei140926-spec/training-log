/**
 * Equipment type constants and helpers for strength score calculation.
 *
 * Dumbbell weight convention: weights are stored as per-hand kg values
 * (Japanese fitness app standard). The coefficient is applied as:
 *   effectiveWeight = storedPerHandKg × 2 × EQUIPMENT_COEFFICIENTS.dumbbell
 */

export const EQUIPMENT = {
    barbell:    "barbell",
    smith:      "smith",
    dumbbell:   "dumbbell",
    machine:    "machine",
    cable:      "cable",
    bodyweight: "bodyweight",
};

export const EQUIPMENT_LABELS = {
    barbell:    "バーベル",
    smith:      "スミス",
    dumbbell:   "ダンベル",
    machine:    "マシン",
    cable:      "ケーブル",
    bodyweight: "自重",
};

export const EQUIPMENT_LIST = [
    EQUIPMENT.barbell,
    EQUIPMENT.smith,
    EQUIPMENT.dumbbell,
    EQUIPMENT.machine,
    EQUIPMENT.cable,
    EQUIPMENT.bodyweight,
];

/**
 * Effective weight coefficients per equipment type.
 * For dumbbell: applied as storedKg × 2 × coeff (stored = per-hand).
 * For bodyweight: no additional coefficient; effective = body_weight_kg + added_kg.
 */
export const EQUIPMENT_COEFFICIENTS = {
    barbell:    1.0,
    smith:      0.9,
    dumbbell:   0.8,
    machine:    0.7,
    cable:      0.6,
    bodyweight: 1.0, // special handling in score calc
};

/** Preset exercise name → equipment lookup */
export const PRESET_EQUIPMENT = {
    "ベンチプレス":                 "barbell",
    "インクラインベンチプレス":      "barbell",
    "ペックフライ":                  "machine",
    "ダンベルプレス":                "dumbbell",
    "インクラインダンベルプレス":    "dumbbell",
    "ディップス":                    "bodyweight",
    "プッシュアップ":                "bodyweight",
    "腕立て伏せ":                   "bodyweight",
    "ラットプルダウン":              "cable",
    "シーテッドロウ":                "cable",
    "ベントオーバーロウ":            "barbell",
    "懸垂":                         "bodyweight",
    "チンニング":                    "bodyweight",
    "ダンベルロウ":                  "dumbbell",
    "スクワット":                    "barbell",
    "レッグプレス":                  "machine",
    "レッグエクステンション":         "machine",
    "ハックスクワット":              "machine",
    "ブルガリアンスクワット":         "bodyweight",
    "ルーマニアンデッドリフト":       "barbell",
    "デッドリフト":                  "barbell",
    "シーテッドレッグカール":         "machine",
    "ライイングレッグカール":         "machine",
    "バックエクステンション":         "machine",
    "ヒップスラスト":                "barbell",
    "アブダクション":                "machine",
    "グルートブリッジ":              "bodyweight",
    "ショルダープレス":              "dumbbell",
    "サイドレイズ":                  "dumbbell",
    "リアデルトフライ":              "dumbbell",
    "アップライトロウ":              "barbell",
    "バーベルカール":                "barbell",
    "ハンマーカール":                "dumbbell",
    "インクラインカール":             "dumbbell",
    "ダンベルカール":                "dumbbell",
    "トライセプスプッシュダウン":     "cable",
    "ライイングエクステンション":     "barbell",
    "オーバーヘッドエクステンション": "dumbbell",
    "トライセプスエクステンション":   "dumbbell",
    "レッグレイズ":                  "bodyweight",
    "ケーブルクランチ":              "cable",
    "プランク":                      "bodyweight",
};

/**
 * Infer equipment type from exercise name.
 * Priority: preset map → keyword detection → default "machine"
 */
export function inferEquipment(name) {
    if (!name) return "machine";
    if (PRESET_EQUIPMENT[name]) return PRESET_EQUIPMENT[name];
    const n = String(name);
    if (/スミス/.test(n)) return "smith";
    if (/ダンベル|ハンマーカール|インクラインカール/.test(n)) return "dumbbell";
    if (/ケーブル/.test(n)) return "cable";
    if (/ディップス|懸垂|チンニング|腕立て|プッシュアップ|ブルガリアン|グルートブリッジ|バックエクステンション|レッグレイズ|プランク/.test(n)) return "bodyweight";
    if (/バーベル|ベンチプレス|デッドリフト|スクワット|ベントオーバーロウ|アップライトロウ|ライイングエクステンション|ヒップスラスト|インクラインベンチ/.test(n)) return "barbell";
    return "machine";
}
