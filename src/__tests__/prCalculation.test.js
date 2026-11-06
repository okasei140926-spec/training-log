/**
 * calcPrEntries 単体テスト
 *
 * テスト対象: src/utils/prCalculation.js
 *
 * 設計方針:
 *   - jest.mock('../utils/helpers') は使用しない（実 helpers を使用）
 *   - getPreviousPR のみモック（各テストで制御可能にする）
 *   - 種目単位カウント・重複排除・ソートを検証する
 */

jest.mock('../utils/supabase', () => ({
  supabase: {},
  supabaseConfigError: null,
}));

import { calcPrEntries } from '../utils/prCalculation';

// ─── ヘルパー ───────────────────────────────────────────────────────────────

/**
 * 単純な重量セットを作成する。sanitizeWorkoutSet が通る形式。
 */
const makeSet = (weight, reps) => ({ weight, reps, done: true });

/**
 * getPreviousPR のモック: 指定した weight/reps の前回 PR を返す。
 * null を渡すと null を返す（前回記録なし）。
 */
const makePrevPr = (weight, reps) => {
  if (weight == null) return () => null;
  return () => ({ sets: [makeSet(weight, reps)] });
};

// ─── テスト ─────────────────────────────────────────────────────────────────

describe('calcPrEntries: 基本 PR 判定', () => {
  test('1種目で PR を達成 → 1件返す', () => {
    const entries = [
      {
        exerciseName: 'ベンチプレス',
        bodyPart: '胸',
        sets: [makeSet(100, 5)], // 1RM ≈ 116.67
      },
    ];
    // 前回: 90kg×5 → 1RM ≈ 105
    const getPreviousPR = makePrevPr(90, 5);

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe('ベンチプレス');
    expect(result[0].rmGain).toBeGreaterThan(0);
  });

  test('前回記録がない (getPreviousPR が null を返す) → 0件', () => {
    const entries = [
      {
        exerciseName: 'スクワット',
        bodyPart: '脚',
        sets: [makeSet(100, 5)],
      },
    ];
    const getPreviousPR = makePrevPr(null);

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(0);
  });

  test('PR 未達成（前回と同じ重量・回数）→ 0件', () => {
    const entries = [
      {
        exerciseName: 'デッドリフト',
        bodyPart: '背中',
        sets: [makeSet(120, 3)],
      },
    ];
    // 前回も同じ
    const getPreviousPR = makePrevPr(120, 3);

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(0);
  });

  test('PR 未達成（tolerance 未満の向上）→ 0件', () => {
    // PR_UPDATE_TOLERANCE_KG = 0.15kg
    // 100kg×5 → 1RM ≈ 116.67、99.9kg×5 → 1RM ≈ 116.55 → 差 ≈ 0.12 < 0.15
    const entries = [
      {
        exerciseName: 'ショルダープレス',
        bodyPart: '肩',
        sets: [makeSet(100, 5)],
      },
    ];
    const getPreviousPR = makePrevPr(99.9, 5);

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(0);
  });
});

describe('calcPrEntries: 複数種目', () => {
  test('3種目それぞれ PR → 3件', () => {
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
      { exerciseName: 'スクワット',   bodyPart: '脚', sets: [makeSet(140, 5)] },
      { exerciseName: 'デッドリフト', bodyPart: '背中', sets: [makeSet(160, 5)] },
    ];
    const getPreviousPR = makePrevPr(80, 5); // 全員 PR

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(3);
  });

  test('3種目のうち1件 PR → 1件', () => {
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
      { exerciseName: 'スクワット',   bodyPart: '脚', sets: [makeSet(100, 3)] },
      { exerciseName: 'デッドリフト', bodyPart: '背中', sets: [makeSet(100, 3)] },
    ];
    // ベンチだけPR、他は前回と同じ
    const getPreviousPR = (exerciseObj) => {
      if (exerciseObj.name === 'ベンチプレス') return { sets: [makeSet(80, 5)] };
      return { sets: [makeSet(100, 3)] }; // 同じ → PR でない
    };

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe('ベンチプレス');
  });
});

describe('calcPrEntries: 重複排除（同 bodyPart::exerciseName）', () => {
  test('同じ種目が2エントリある場合 → 1件に集約', () => {
    // 同じ bodyPart + exerciseName で 2 エントリが来たとき (e.g. 複数セット分割)
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(105, 3)] },
    ];
    const getPreviousPR = makePrevPr(80, 5);

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(1);
  });

  test('重複時は rmGain が大きい方を残す', () => {
    // sets1: 100×5 → 1RM≈116.67 、sets2: 110×3 → 1RM≈121
    // 前回: 80×5 → 1RM≈93.33
    // sets1 rmGain ≈ 23.34、sets2 rmGain ≈ 27.67 → sets2 を採用
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(110, 3)] },
    ];
    const getPreviousPR = makePrevPr(80, 5);

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(1);
    expect(result[0].weight).toBe(110);
    expect(result[0].reps).toBe(3);
  });
});

describe('calcPrEntries: ソート順', () => {
  test('rmGain 降順でソートされる', () => {
    // ベンチ: 100×5 vs 80×5 → rmGain ≈ 23.34
    // スクワット: 140×5 vs 100×5 → rmGain ≈ 46.67 (大きい)
    // デッドリフト: 120×5 vs 110×5 → rmGain ≈ 11.67 (小さい)
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸',   sets: [makeSet(100, 5)] },
      { exerciseName: 'スクワット',   bodyPart: '脚',   sets: [makeSet(140, 5)] },
      { exerciseName: 'デッドリフト', bodyPart: '背中', sets: [makeSet(120, 5)] },
    ];
    const getPreviousPR = (exerciseObj) => {
      if (exerciseObj.name === 'ベンチプレス') return { sets: [makeSet(80, 5)] };
      if (exerciseObj.name === 'スクワット')   return { sets: [makeSet(100, 5)] };
      if (exerciseObj.name === 'デッドリフト') return { sets: [makeSet(110, 5)] };
      return null;
    };

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(3);
    // 1位: スクワット (最大 rmGain)
    expect(result[0].exerciseName).toBe('スクワット');
    // 3位: デッドリフト (最小 rmGain)
    expect(result[2].exerciseName).toBe('デッドリフト');
    // rmGain 降順の確認
    expect(result[0].rmGain).toBeGreaterThan(result[1].rmGain);
    expect(result[1].rmGain).toBeGreaterThan(result[2].rmGain);
  });
});

describe('calcPrEntries: エッジケース', () => {
  test('entries が空配列 → 空配列', () => {
    const result = calcPrEntries([], makePrevPr(80, 5), '2026-11-05');
    expect(result).toHaveLength(0);
  });

  test('entries が null/undefined → 空配列', () => {
    expect(calcPrEntries(null, makePrevPr(80, 5), '2026-11-05')).toHaveLength(0);
    expect(calcPrEntries(undefined, makePrevPr(80, 5), '2026-11-05')).toHaveLength(0);
  });

  test('getPreviousPR が null → 0件（前回記録なし扱い）', () => {
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
    ];
    const result = calcPrEntries(entries, null, '2026-11-05');
    expect(result).toHaveLength(0);
  });

  test('前回記録の sets が空配列 → 0件', () => {
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
    ];
    const getPreviousPR = () => ({ sets: [] });
    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(0);
  });

  test('エントリの sets が空 → スキップ（カウントしない）', () => {
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [] },
    ];
    const getPreviousPR = makePrevPr(80, 5);
    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(0);
  });

  test('getPreviousPR は beforeDate: workoutDate を受け取る（選択日以降を除外）', () => {
    // getPreviousPR が beforeDate='2026-11-05' を受け取ったとき → 旧ベースライン (80kg×5) を返す
    // beforeDate を受け取らないとき（mutation c）→ 当日を含む高いベースライン (100kg×5) を返す
    // → mutation c では PR でなくなり 0件になり FAIL する
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
    ];
    const getPreviousPR = (_exerciseObj, opts) => {
      if (opts?.beforeDate === '2026-11-05') {
        // 正常パス: 選択日以降を除外 → 旧ベースライン
        return { sets: [makeSet(80, 5)] };
      }
      // mutation c パス: beforeDate なし → 100kg×5 = 同じ → PR でない
      return { sets: [makeSet(100, 5)] };
    };

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(1); // beforeDate を外すと 0 になり FAIL
  });

  test('prCount は返り値の length と一致する', () => {
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
      { exerciseName: 'スクワット',   bodyPart: '脚', sets: [makeSet(140, 5)] },
    ];
    const getPreviousPR = makePrevPr(80, 5);
    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    // prCount = result.length
    expect(result.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// 経路一致テスト: 記録画面（LogScreen）経路と
// カレンダー（HistoryScreen）経路で同じ件数になること
//
// 旧 LogScreen の reduce はデデュープなし。
// exercises に同一 bodyPart::exerciseName が2エントリ入ると
// 旧 reduce は 2件、calcPrEntries は 1件を返し不一致になった。
//
// mutation test d の手順:
//   prCalculation.js の dedupeMap.set(key, candidate) を
//   dedupeMap.set(key + '-' + Math.random(), candidate) に変えると
//   下記テストが FAIL する。
//   （デデュープが解除され duplicate entries が 2件にカウントされる）
// ─────────────────────────────────────────────────────────────

describe('経路一致: 記録画面とカレンダー経路で同じ件数', () => {
  test('重複エントリなし: 両経路ともに正しい件数', () => {
    // 重複がない通常ケース: LogScreen 経路も HistoryScreen 経路も一致する
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
      { exerciseName: 'スクワット',   bodyPart: '脚', sets: [makeSet(140, 5)] },
    ];
    const getPreviousPR = makePrevPr(80, 5);
    expect(calcPrEntries(entries, getPreviousPR, '2026-11-05')).toHaveLength(2);
  });

  test('同 bodyPart::exerciseName の重複エントリ: calcPrEntries は1件（旧 reduce は2件になり不一致）', () => {
    // LogScreen の exercises に同一種目が2回入るケース。
    // 旧 reduce（デデュープなし）は 2件を返したが、
    // calcPrEntries はデデュープにより 1件を返す。
    // → LogScreen を旧 reduce に戻すと記録画面とカレンダー経路が不一致になる。
    const entriesWithDuplicate = [
      { exerciseName: 'スクワット', bodyPart: '脚', sets: [makeSet(100, 5)] },
      { exerciseName: 'スクワット', bodyPart: '脚', sets: [makeSet(105, 3)] }, // 重複
    ];
    const getPreviousPR = makePrevPr(80, 5);

    // calcPrEntries: デデュープ → 1件
    const result = calcPrEntries(entriesWithDuplicate, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(1); // ← デデュープを外すと 2 になり FAIL

    // HistoryScreen 経路: history 由来は1レコードにつき1エントリ → 重複なし → 1件
    const entriesNodup = [
      { exerciseName: 'スクワット', bodyPart: '脚', sets: [makeSet(105, 3)] },
    ];
    const historyResult = calcPrEntries(entriesNodup, getPreviousPR, '2026-11-05');
    expect(historyResult).toHaveLength(1);

    // 両経路の件数が一致することを明示的にアサート
    expect(result.length).toBe(historyResult.length);
  });
});

// ─────────────────────────────────────────────────────────────
// beforeDate セマンティクス: 選択日以降の記録は baseline に含めない
//
// 旧 useWorkout.js の getHistoryPrCandidates は
//   if (excludeDate && recordDate === excludeDate) return;
// と書いており、当日のみ除外して未来の記録を baseline に混入させていた。
// 修正後は
//   if (beforeDate && recordDate >= beforeDate) return;
// とし、選択日以降をすべて除外する。
//
// これにより LogScreen と HistoryScreen で baseline が一致する。
//
// mutation test: prCalculation.js で
//   getPreviousPR({ name, bodyPart }, { beforeDate: workoutDate })
// を
//   getPreviousPR({ name, bodyPart }, {})
// に変えると getPreviousPR が opts なしで呼ばれ、
// モックが "未来の記録あり" ケースを baseline に含め FAIL する。
// ─────────────────────────────────────────────────────────────

describe('beforeDate セマンティクス: 選択日以降の記録を baseline から除外', () => {
  // 2026-11-05 のワークアウトを評価する想定。
  // getPreviousPR は opts.beforeDate を見て返す値を切り替えるモック。

  test('選択日より後の記録のみある種目 → PR にならない（過去記録なし扱い）', () => {
    // JMプレスが 2026-11-06 にしか記録がない場合:
    //   beforeDate='2026-11-05' → 2026-11-06 は除外 → 返却 null → PR でない
    const entries = [
      { exerciseName: 'JMプレス', bodyPart: '三頭', sets: [makeSet(40, 8)] },
    ];
    const getPreviousPR = (_ex, opts) => {
      // beforeDate='2026-11-05' が来たとき: 2026-11-06 の記録は除外 → null
      if (opts?.beforeDate === '2026-11-05') return null;
      // beforeDate が来ない（旧ロジック想定）: 2026-11-06 の記録を返す
      return { sets: [makeSet(35, 8)] }; // 35×8 → 1RM≈44.6 < 40×8 の 1RM≈46.9 → PR
    };

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(0); // 過去記録なし → PR でない
  });

  test('選択日より前の記録がある種目 → PR と判定される', () => {
    // 2026-11-04 の記録があり、2026-11-05 がそれを上回る場合
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
    ];
    const getPreviousPR = (_ex, opts) => {
      if (opts?.beforeDate === '2026-11-05') {
        // 2026-11-04 の記録のみ: 90kg×5
        return { sets: [makeSet(90, 5)] };
      }
      return null;
    };

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe('ベンチプレス');
  });

  test('選択日より前も後もある場合 → 前のものだけが baseline になる', () => {
    // 2026-11-04 に 90kg×5、2026-11-06 に 110kg×3 の記録がある。
    // baseline は 90kg×5 (1RM≈105) のみ → 100kg×5 (1RM≈116.7) は PR
    // もし 2026-11-06 が baseline に混入すると 110kg×3 (1RM≈121) > 100kg×5 → PR でなくなる
    const entries = [
      { exerciseName: 'ベンチプレス', bodyPart: '胸', sets: [makeSet(100, 5)] },
    ];
    const getPreviousPR = (_ex, opts) => {
      if (opts?.beforeDate === '2026-11-05') {
        // 正しいパス: 2026-11-04 の記録のみ
        return { sets: [makeSet(90, 5)] }; // 1RM ≈ 105
      }
      // 旧パス（beforeDate なし）: 2026-11-06 の記録も含む → 110kg×3 が best
      return { sets: [makeSet(110, 3)] }; // 1RM ≈ 121 → 100×5 は PR でない
    };

    const result = calcPrEntries(entries, getPreviousPR, '2026-11-05');
    expect(result).toHaveLength(1); // beforeDate なしだと 0 になり FAIL
    expect(result[0].baselineRm).toBeCloseTo(105, 0); // 90kg×5 baseline
  });

  test('両経路で beforeDate を受け取り同じ baseline になること', () => {
    // LogScreen 経路と HistoryScreen 経路を両方シミュレート:
    // どちらも workoutDate='2026-11-05' を beforeDate として渡す。
    // getPreviousPR が beforeDate を尊重すれば結果が一致する。
    const workoutDate = '2026-11-05';
    const entries = [
      { exerciseName: 'スクワット', bodyPart: '脚', sets: [makeSet(140, 5)] },
    ];

    const sharedGetPreviousPR = (_ex, opts) => {
      if (opts?.beforeDate === workoutDate) return { sets: [makeSet(100, 5)] };
      return null;
    };

    // 記録画面経路
    const logScreenResult = calcPrEntries(entries, sharedGetPreviousPR, workoutDate);
    // カレンダー経路（同じ getPreviousPR を使う）
    const historyResult  = calcPrEntries(entries, sharedGetPreviousPR, workoutDate);

    expect(logScreenResult.length).toBe(historyResult.length);
    expect(logScreenResult[0]?.baselineRm).toBe(historyResult[0]?.baselineRm);
  });
});
