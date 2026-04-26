const EXERCISE_NAME_ALIASES = {
  "ベンチ": "ベンチプレス",
  "bench": "ベンチプレス",
  "bench press": "ベンチプレス",
  "bp": "ベンチプレス",
  "squat": "スクワット",
  "sq": "スクワット",
  "デッド": "デッドリフト",
  "dead": "デッドリフト",
  "deadlift": "デッドリフト",
  "dead lift": "デッドリフト",
  "dl": "デッドリフト",
};

const normalizeAliasKey = (name) =>
  String(name || "")
    .replace(/　/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

export function normalizeExerciseName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";

  const alias = EXERCISE_NAME_ALIASES[normalizeAliasKey(trimmed)];
  return alias || trimmed;
}

