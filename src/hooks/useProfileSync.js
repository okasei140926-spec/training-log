import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import { load, save } from "../utils/helpers";
import { buildMuscleExFromAnswers } from "../utils/generateOnboardingPlan";

// onboardingAnswers のどのキーが変わったとき muscleEx を再ビルドするか
// （App.jsx の PLAN_RESET_FIELDS と同じ定義）
const PLAN_AFFECTING_KEYS = new Set(["level", "frequency", "location", "hasDumbbells", "preferredSplit"]);

// profiles 列 ↔ onboardingAnswers キー の双方向変換テーブル
// fromDb : profiles 値 → localStorage 値
// toDb   : localStorage 値 → profiles 値
const FIELD_MAP = [
    {
        col: "gender",
        key: "gender",
        fromDb: (v) => v || null,
        toDb:   (v) => v || null,
    },
    {
        col: "birth_date",
        key: "birthdate",
        fromDb: (v) => v || null,
        toDb:   (v) => v || null,
    },
    {
        col: "fitness_goal",
        key: "goal",
        fromDb: (v) => v || null,
        toDb:   (v) => v || null,
    },
    {
        col: "fitness_level",
        key: "level",
        fromDb: (v) => v || null,
        toDb:   (v) => v || null,
    },
    {
        col: "workout_frequency",
        key: "frequency",
        // profiles: integer → localStorage: string（例 "3"）
        fromDb: (v) => (v != null ? String(v) : null),
        toDb:   (v) => parseInt(v, 10) || null,
    },
    {
        col: "training_years",
        key: "trainingYears",
        fromDb: (v) => v || null,
        toDb:   (v) => v || null,
    },
    {
        col: "workout_location",
        key: "location",
        fromDb: (v) => v || null,
        toDb:   (v) => v || null,
    },
    {
        col: "has_dumbbells",
        key: "hasDumbbells",
        // profiles: boolean → localStorage: "ある"/"なし"
        fromDb: (v) => (v === true ? "ある" : v === false ? "なし" : null),
        toDb:   (v) => (v === "ある" ? true : v === "なし" ? false : null),
    },
    {
        col: "preferred_split",
        key: "preferredSplit",
        // profiles null は "none" 扱いなので null として返す
        fromDb: (v) => v || null,
        toDb:   (v) => (v && v !== "none" ? v : null),
    },
];

/**
 * customSplitSequence / weekStartDay / weeklySetTargets の解決ロジック。
 * useProfileSync の .then() 内から呼ばれる。純関数として export することでテスト可能にする。
 *
 * 解決ルール:
 *   profiles に値あり → profiles が勝つ → localUpdates に追加
 *   profiles が null かつ localStorage に値あり → localStorage が勝つ → uploadPayload に追加
 *   両方 null → 何もしない
 *
 * 競合ガード:
 *   snapshot が非 null かつ current と異なる → ユーザーが SELECT 中に変更した → スキップ
 *   snapshot が null（localStorage に値がなかった）→ ガードを適用しない。
 *   初回ログイン時に useSettings の初期化 effect がローカルに書き込んでも
 *   誤って競合と判定されないようにするため。
 *
 * weekly_set_targets について:
 *   {} は「ユーザーが全部外した状態」であり「値なし」ではない。
 *   null のみ「値なし」とする。これにより「全部外した」設定も正しく同期される。
 *   undefined は DB からの欠損値として null 扱いにする。
 *
 * @param {{ data: object,
 *   snapshotCustomSplit: *, currentCustomSplit: *,
 *   snapshotWeekStartDay: *, currentWeekStartDay: *,
 *   snapshotWeeklySetTargets: *, currentWeeklySetTargets: *
 * }} params
 * @returns {{
 *   localUpdates: { customSplitSequence?: *, weekStartDay?: *, weeklySetTargets?: * },
 *   uploadPayload: { custom_split_sequence?: *, week_start_day?: *, weekly_set_targets?: * }
 * }}
 */
export function resolveNewSyncFields({
    data,
    snapshotCustomSplit, currentCustomSplit,
    snapshotWeekStartDay, currentWeekStartDay,
    snapshotWeeklySetTargets, currentWeeklySetTargets,
}) {
    const localUpdates = {};
    const uploadPayload = {};

    // ── custom_split_sequence ─────────────────────────────────────────────
    // snapshot が null = localStorage に値がなかった → 競合チェック不要
    const customSplitConflict =
        snapshotCustomSplit !== null &&
        JSON.stringify(currentCustomSplit) !== JSON.stringify(snapshotCustomSplit);
    if (!customSplitConflict) {
        const dbVal = data.custom_split_sequence ?? null;
        if (dbVal !== null) {
            // profiles 優先
            if (JSON.stringify(dbVal) !== JSON.stringify(currentCustomSplit)) {
                localUpdates.customSplitSequence = dbVal;
            }
        } else if (currentCustomSplit !== null) {
            // localStorage 優先 → 書き上げ
            uploadPayload.custom_split_sequence = currentCustomSplit;
        }
        // 両方 null → 何もしない
    }

    // ── week_start_day ────────────────────────────────────────────────────
    const weekStartDayConflict =
        snapshotWeekStartDay !== null &&
        currentWeekStartDay !== snapshotWeekStartDay;
    if (!weekStartDayConflict) {
        const dbVal = data.week_start_day ?? null;
        if (dbVal !== null) {
            // profiles 優先
            if (dbVal !== currentWeekStartDay) {
                localUpdates.weekStartDay = dbVal;
            }
        } else if (currentWeekStartDay !== null) {
            // localStorage 優先 → 書き上げ
            uploadPayload.week_start_day = currentWeekStartDay;
        }
        // 両方 null → 何もしない
    }

    // ── weekly_set_targets ────────────────────────────────────────────────
    // {} は「値なし」ではなく「全部外した状態」。null のみ「値なし」とする。
    // undefined は DB 欠損値として null 扱い。
    const weeklySetTargetsConflict =
        snapshotWeeklySetTargets !== null &&
        JSON.stringify(currentWeeklySetTargets) !== JSON.stringify(snapshotWeeklySetTargets);
    if (!weeklySetTargetsConflict) {
        const dbVal = data.weekly_set_targets ?? null;
        if (dbVal !== null) {
            // profiles 優先
            if (JSON.stringify(dbVal) !== JSON.stringify(currentWeeklySetTargets)) {
                localUpdates.weeklySetTargets = dbVal;
            }
        } else if (currentWeeklySetTargets !== null) {
            // localStorage 優先 → 書き上げ（{} も含む）
            uploadPayload.weekly_set_targets = currentWeeklySetTargets;
        }
        // 両方 null → 何もしない
    }

    return { localUpdates, uploadPayload };
}

/**
 * ログイン直後に profiles から設定を復元し、localStorage と React state に反映する。
 *
 * 解決ルール（一般列）:
 *   profiles に値あり → profiles を採用し localStorage を更新
 *   profiles が null かつ localStorage に値あり → localStorage を採用し profiles に書き上げる
 *   両方 null → 何もしない
 *
 * body_weight_kg だけは weight_updated_at でタイムスタンプ比較し新しい方を採用する。
 * 詳細は body_weight_kg セクションのコメントを参照。
 *
 * 競合ガード:
 *   SELECT 発行時点の onboardingAnswers を退避し、.then() 完了時に再読みして比較する。
 *   SELECT 中にユーザーが変更した列は profiles の値で上書きしない。
 *   handleSaveProfileField が既に profiles へ書き上げているため uploadPayload にも加えない。
 *
 * onboarding_completed_at による showOnboarding スキップは今回スコープ外。
 * 別端末でのオンボーディング再表示は許容する（データは復元されるため再入力は最小限）。
 */
export function useProfileSync({
    user,
    setOnboardingAnswers,
    setBodyWeightKg,
    setBodyWeightUpdatedAt,
    setMuscleEx,
    setWeekStartDay,
    setWeeklySetTargets,
}) {
    // ログアウト→再ログインで再実行するため、user.id を追跡する
    const syncedUserIdRef = useRef(null);

    useEffect(() => {
        if (!user?.id) {
            syncedUserIdRef.current = null; // ログアウト時にリセット
            return;
        }
        if (syncedUserIdRef.current === user.id) return; // このセッションで実行済み
        syncedUserIdRef.current = user.id;

        // SELECT 発行時点の onboardingAnswers を退避する（競合ガード用）。
        // .then() の中で再度読み込み、変化していた列はユーザーが変更したとみなしてスキップする。
        const snapshotAnswers = load("onboardingAnswers", {}) || {};

        // 新3項目のスナップショット（独立した localStorage キー）。
        // load が null を返す = キー未存在 = 初回ログイン時のフレッシュインストール。
        // このとき競合ガードを適用しないことで useSettings の初期化 effect による
        // 書き込みを誤って「ユーザー操作」と判定しないようにする（resolveNewSyncFields 参照）。
        const snapshotCustomSplit      = load("customSplitSequence", null);
        const snapshotWeekStartDay     = load("weekStartDay",        null);
        const snapshotWeeklySetTargets = load("weeklySetTargets",    null);

        const selectCols = [
            "gender", "birth_date", "fitness_goal", "fitness_level",
            "workout_frequency", "training_years", "workout_location",
            "has_dumbbells", "preferred_split",
            "body_weight_kg", "weight_updated_at",
            "custom_split_sequence", "week_start_day", "weekly_set_targets",
        ].join(", ");

        supabase
            .from("profiles")
            .select(selectCols)
            .eq("id", user.id)
            .maybeSingle()
            .then(({ data, error }) => {
                if (error) {
                    console.error("[profileSync] SELECT failed:", error?.message, error);
                    return;
                }
                if (!data) return; // 行未作成（ensureProfileForUser が未完了）→ no-op

                // SELECT 完了時点の最新値を読む（ユーザーが変更していた場合はここで反映済み）
                const currentAnswers = load("onboardingAnswers", {}) || {};
                const nextAnswers = { ...currentAnswers };
                const uploadPayload = {};
                let planAffectedChanged = false;

                // ── 一般列の解決 ──────────────────────────────────────────────
                for (const { col, key, fromDb, toDb } of FIELD_MAP) {
                    const dbVal = data[col];
                    const snapshotVal = snapshotAnswers[key];
                    const currentVal = currentAnswers[key];

                    // SELECT 発行後にユーザーが変更した列はスキップする。
                    // handleSaveProfileField が既に profiles へ書き上げているため
                    // uploadPayload にも加えない（二重書き込みになるだけで無害だが不要）。
                    if (currentVal !== snapshotVal) continue;

                    if (dbVal != null) {
                        // profiles 優先
                        const resolved = fromDb(dbVal);
                        if (resolved != null && resolved !== currentVal) {
                            nextAnswers[key] = resolved;
                            if (PLAN_AFFECTING_KEYS.has(key)) planAffectedChanged = true;
                        }
                    } else if (currentVal != null) {
                        // profiles が null かつ ローカルに値あり → 書き上げ
                        const dbConverted = toDb(currentVal);
                        if (dbConverted != null) uploadPayload[col] = dbConverted;
                    }
                    // 両方 null → 何もしない
                }

                // ── body_weight_kg: タイムスタンプ比較 ────────────────────────
                //
                // 他の列は「profiles に値があれば無条件採用」だが、
                // body_weight_kg だけは weight_updated_at で新しい方を採用する。
                //
                // 理由：
                //   体重はユーザーが最も頻繁に更新する値であり、かつ唯一タイムスタンプ列
                //   (weight_updated_at) を持つ列だから。他の列と同様に profiles 優先に
                //   すると、別端末で更新した新しい体重が古い profiles 値で上書きされる。
                //
                // タイムスタンプが片方または両方ない場合は profiles を採用する。
                // （古いユーザーや weight_updated_at が未設定のケースで安全側に倒す。）
                //
                // この不揃いは意図的なものであり、揃えると上記の上書き問題が再発する。
                //
                // 競合ガード：
                //   SELECT 中に bodyWeight が変わっていた場合、handleSaveBodyWeight が
                //   既に profiles へ書き上げているためブロック全体をスキップする。
                //   タイムスタンプ比較でも同様に処理できるが（localBwTs が必ず新しい）、
                //   uploadPayload への二重追加を避けるためスキップの方が明確。
                const bwChangedDuringSelect =
                    currentAnswers.bodyWeight !== snapshotAnswers.bodyWeight;

                if (!bwChangedDuringSelect) {
                    const dbBw = data.body_weight_kg;
                    const dbBwTs = data.weight_updated_at;
                    const localBwStr = currentAnswers.bodyWeight;
                    const localBwTs = currentAnswers.bodyWeightUpdatedAt;

                    if (dbBw != null) {
                        // profiles に値あり: タイムスタンプが新しい方を採用。
                        // タイムスタンプが無い場合（片方または両方）は profiles を採用。
                        const dbIsNewer = !localBwTs || !dbBwTs
                            || new Date(dbBwTs) >= new Date(localBwTs);
                        if (dbIsNewer) {
                            nextAnswers.bodyWeight = String(dbBw);
                            nextAnswers.bodyWeightUpdatedAt = dbBwTs || null;
                        } else {
                            // ローカルの方が新しい → ローカルを profiles に書き上げ
                            const localBwNum = Number(localBwStr);
                            if (Number.isFinite(localBwNum) && localBwNum > 0) {
                                uploadPayload.body_weight_kg = localBwNum;
                                if (localBwTs) uploadPayload.weight_updated_at = localBwTs;
                            }
                        }
                    } else if (localBwStr != null) {
                        // profiles が null かつ ローカルに値あり → 書き上げ
                        const localBwNum = Number(localBwStr);
                        if (Number.isFinite(localBwNum) && localBwNum > 0) {
                            uploadPayload.body_weight_kg = localBwNum;
                            if (localBwTs) uploadPayload.weight_updated_at = localBwTs;
                        }
                    }
                }

                // ── 新3項目（customSplitSequence / weekStartDay / weeklySetTargets）──
                const currentCustomSplit      = load("customSplitSequence", null);
                const currentWeekStartDay     = load("weekStartDay",        null);
                const currentWeeklySetTargets = load("weeklySetTargets",    null);

                const { localUpdates, uploadPayload: extraPayload } = resolveNewSyncFields({
                    data,
                    snapshotCustomSplit,      currentCustomSplit,
                    snapshotWeekStartDay,     currentWeekStartDay,
                    snapshotWeeklySetTargets, currentWeeklySetTargets,
                });

                // 新3項目の書き上げペイロードを既存ペイロードにマージ
                Object.assign(uploadPayload, extraPayload);

                // ── ローカル値を profiles へ一括書き上げ ───────────────────────
                if (Object.keys(uploadPayload).length > 0) {
                    supabase
                        .from("profiles")
                        .update(uploadPayload, { count: "exact" })
                        .eq("id", user.id)
                        .then(({ error: uploadErr, count }) => {
                            if (uploadErr) {
                                console.error("[profileSync] upload local→profiles failed:",
                                    uploadErr?.message, uploadErr);
                            } else if (count === 0) {
                                console.error("[profileSync] profiles row not found — upload wrote 0 rows",
                                    { userId: user.id });
                            }
                        })
                        .catch(() => {});
                }

                // ── React state と localStorage を更新 ──────────────────────────
                save("onboardingAnswers", nextAnswers);
                setOnboardingAnswers(nextAnswers);

                const bwNum = Number(nextAnswers.bodyWeight);
                if (Number.isFinite(bwNum) && bwNum > 0) {
                    setBodyWeightKg(bwNum);
                }
                if (nextAnswers.bodyWeightUpdatedAt) {
                    setBodyWeightUpdatedAt(nextAnswers.bodyWeightUpdatedAt);
                }

                // plan-affecting 列が変化した場合のみ muscleEx を再ビルド
                if (planAffectedChanged) {
                    const newMuscleEx = buildMuscleExFromAnswers(nextAnswers);
                    setMuscleEx(newMuscleEx);
                    save("routineEx", newMuscleEx);
                }

                // 新3項目の localUpdates を適用
                if (localUpdates.customSplitSequence !== undefined) {
                    save("customSplitSequence", localUpdates.customSplitSequence);
                }
                if (localUpdates.weekStartDay !== undefined) {
                    save("weekStartDay", localUpdates.weekStartDay);
                    setWeekStartDay?.(localUpdates.weekStartDay);
                }
                if (localUpdates.weeklySetTargets !== undefined) {
                    save("weeklySetTargets", localUpdates.weeklySetTargets);
                    setWeeklySetTargets?.(localUpdates.weeklySetTargets);
                }
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);
}
