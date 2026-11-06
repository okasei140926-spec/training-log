/**
 * getPreviousPR 不変条件テスト
 *
 * テスト対象: src/hooks/useWorkout.js の getPreviousPR
 *
 * 検証する不変条件:
 *   beforeDate が指定されているとき、getPreviousPR が返す結果の date は
 *   必ず beforeDate より前 (date < beforeDate)。
 *   date が確認できない（null 等）場合も null を返す。
 *
 * 経路:
 *   1. history（getBestHistoryPR）経路
 *   2. manual_bests（getManualPR）経路
 *   3. SQLキャッシュ（getSqlCachePR）経路
 *
 * 設計方針:
 *   経路ごとのテストではなく、不変条件そのものを入力を変えて検証する。
 *   renderHook で useWorkout を最小 props で呼び出す。
 *
 * モックの注意点:
 *   - history レコードは top-level sets が必要（getRecordSourceSets が参照するため）
 *   - history レコードは bodyPart フィールドが必要（resolveRecordBodyPartLabel が参照するため）
 *     （muscleEx が空のとき、body_part/bodyPart がないと buildRecordKey が null を返しスキップされる）
 *   - prCache のキーは normalizeExerciseName の出力と一致させること
 *     （normalizeExerciseName は alias がない場合 trimmed 文字列をそのまま返す。小文字化しない）
 */

jest.mock('../utils/supabase', () => ({
  supabase: {},
  supabaseConfigError: null,
}));

import { renderHook } from '@testing-library/react';
import { useWorkout } from '../hooks/useWorkout';

// ─── 最小 props ────────────────────────────────────────────────────────────────

/**
 * useWorkout の最小 props を生成する。
 * getPreviousPR の呼び出しに不要なフィールドはスタブ。
 */
const makeProps = ({ history = {}, manualBests = [], prCache = {} } = {}) => ({
  history,
  manualBests,
  prCache,
  sessionHistory: {},
  setLogData: jest.fn(),
  getExSets: jest.fn(() => []),
  getExUnit: jest.fn(() => 'kg'),
  KG_TO_LBS: 2.20462,
  muscleEx: {},
  exerciseBodyPartOverrides: {},
  bodyWeightKg: null,
});

/**
 * history レコードを最小形式で生成する。
 * - sets は top-level に置く（getRecordSourceSets が Array.isArray(r.sets) をチェックするため）
 * - bodyPart を明示する（resolveRecordBodyPartLabel が record.bodyPart を最優先で参照するため）
 * - exactHistory: true で "trusted" なレコードにする（isStalePrCandidate 除外を防ぐため）
 */
const makeHistoryRecord = (date, weight, reps, bodyPart = '胸') => ({
  date,
  bodyPart,
  exactHistory: true,
  sets: [{ weight, reps, done: true }],
});

// ─── テスト: 履歴経路 ────────────────────────────────────────────────────────

describe('履歴経路: 不変条件', () => {
  test('beforeDate より前の history レコード → 返す (date < beforeDate)', () => {
    const history = {
      'ベンチプレス': [makeHistoryRecord('2026-11-04', 100, 5, '胸')],
    };
    const { result } = renderHook(() => useWorkout(makeProps({ history })));
    const pr = result.current.getPreviousPR(
      { name: 'ベンチプレス', bodyPart: '胸' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).not.toBeNull();
    expect(pr.date).toBe('2026-11-04');
  });

  test('beforeDate と同日の history レコードのみ → null (date >= beforeDate)', () => {
    const history = {
      'ベンチプレス': [makeHistoryRecord('2026-11-05', 100, 5, '胸')],
    };
    const { result } = renderHook(() => useWorkout(makeProps({ history })));
    const pr = result.current.getPreviousPR(
      { name: 'ベンチプレス', bodyPart: '胸' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).toBeNull();
  });

  test('beforeDate より後の history レコードのみ → null (date > beforeDate)', () => {
    const history = {
      'ベンチプレス': [makeHistoryRecord('2026-11-06', 100, 5, '胸')],
    };
    const { result } = renderHook(() => useWorkout(makeProps({ history })));
    const pr = result.current.getPreviousPR(
      { name: 'ベンチプレス', bodyPart: '胸' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).toBeNull();
  });
});

// ─── テスト: SQLキャッシュ経路 ────────────────────────────────────────────────
// history が空 → getSqlCachePR にフォールバックする経路
// prCache のキーは normalizeExerciseName の出力（alias なし → trimmed 文字列そのまま）

describe('SQLキャッシュ経路: 不変条件', () => {
  test('prCache の best_date が beforeDate より前 → 返す', () => {
    const prCache = {
      'JMプレス': { max_weight: 40, max_reps: 8, best_date: '2026-11-04' },
    };
    const { result } = renderHook(() => useWorkout(makeProps({ prCache })));
    const pr = result.current.getPreviousPR(
      { name: 'JMプレス', bodyPart: '三頭' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).not.toBeNull();
    expect(pr.date).toBe('2026-11-04');
  });

  test('prCache の best_date が beforeDate と同日 → null (今回のバグそのもの)', () => {
    // 旧実装: history フィルタは通過するが getSqlCachePR に beforeDate が渡らず
    // 2026-11-05 のキャッシュがそのまま返ってきていた。
    // 出口ガードにより null を返すことを検証する。
    const prCache = {
      'JMプレス': { max_weight: 40, max_reps: 8, best_date: '2026-11-05' },
    };
    const { result } = renderHook(() => useWorkout(makeProps({ prCache })));
    const pr = result.current.getPreviousPR(
      { name: 'JMプレス', bodyPart: '三頭' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).toBeNull(); // 出口ガードがなければ { date: '2026-11-05', ... } が返り FAIL
  });

  test('prCache の best_date が beforeDate より後 → null', () => {
    const prCache = {
      'JMプレス': { max_weight: 40, max_reps: 8, best_date: '2026-11-06' },
    };
    const { result } = renderHook(() => useWorkout(makeProps({ prCache })));
    const pr = result.current.getPreviousPR(
      { name: 'JMプレス', bodyPart: '三頭' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).toBeNull();
  });

  test('prCache の best_date が null → baseline として使われる（日付不明の歴代ベストは残す）', () => {
    // 日付なしエントリを捨てると baseline が下がり偽PR が増えるため残す。
    // 例: 手動PR 100kg（日付なし）+ 今日 95kg → 捨てると履歴 90kg 基準で 95>90 = 偽PR。
    const prCache = {
      'JMプレス': { max_weight: 40, max_reps: 8, best_date: null },
    };
    const { result } = renderHook(() => useWorkout(makeProps({ prCache })));
    const pr = result.current.getPreviousPR(
      { name: 'JMプレス', bodyPart: '三頭' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).not.toBeNull(); // 日付なしでも baseline に使う
    expect(pr.date).toBeNull();
  });
});

// ─── テスト: 手動PR経路 ───────────────────────────────────────────────────────
// history が空 → manualBests にフォールバックする経路

describe('手動PR経路: 不変条件', () => {
  test('manualBests の best_date が beforeDate より前 → 返す', () => {
    const manualBests = [
      { id: '1', exercise_name: 'ベンチプレス', weight: 100, reps: 5,
        best_date: '2026-11-04', body_part: '胸' },
    ];
    const { result } = renderHook(() => useWorkout(makeProps({ manualBests })));
    const pr = result.current.getPreviousPR(
      { name: 'ベンチプレス', bodyPart: '胸' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).not.toBeNull();
    expect(pr.date).toBe('2026-11-04');
  });

  test('manualBests の best_date が beforeDate と同日 → null', () => {
    const manualBests = [
      { id: '1', exercise_name: 'ベンチプレス', weight: 100, reps: 5,
        best_date: '2026-11-05', body_part: '胸' },
    ];
    const { result } = renderHook(() => useWorkout(makeProps({ manualBests })));
    const pr = result.current.getPreviousPR(
      { name: 'ベンチプレス', bodyPart: '胸' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).toBeNull();
  });

  test('manualBests の best_date が null → baseline として使われる（日付不明の歴代ベストは残す）', () => {
    // 日付なしエントリを捨てると baseline が下がり偽PR が増えるため残す。
    const manualBests = [
      { id: '1', exercise_name: 'ベンチプレス', weight: 100, reps: 5,
        best_date: null, body_part: '胸' },
    ];
    const { result } = renderHook(() => useWorkout(makeProps({ manualBests })));
    const pr = result.current.getPreviousPR(
      { name: 'ベンチプレス', bodyPart: '胸' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).not.toBeNull(); // 日付なしでも baseline に使う
    expect(pr.date).toBeNull();
  });

  test('日付なし手動PRが現在値より高い → PR にならない（偽PR防止の主旨確認）', () => {
    // 手動PR 100kg（日付なし）が baseline。今日 95kg は 100kg に届かないので PR でない。
    // 日付なしを捨てると 95 > (履歴なし) → PR として出てしまう。
    const manualBests = [
      { id: '1', exercise_name: 'ベンチプレス', weight: 100, reps: 5,
        best_date: null, body_part: '胸' },
    ];
    const { result } = renderHook(() => useWorkout(makeProps({ manualBests })));
    const pr = result.current.getPreviousPR(
      { name: 'ベンチプレス', bodyPart: '胸' },
      { beforeDate: '2026-11-05' }
    );
    // baseline: 100kg×5 (日付なし手動PR)
    // 95kg×5 = 1RM ≈ 110.8、100kg×5 = 1RM ≈ 116.7 → 95kg は baseline を超えない
    expect(pr).not.toBeNull();
    expect(pr.isManualBest).toBe(true);
    expect(pr.weight).toBe(100); // 100kg が baseline として返ってくる
  });
});

// ─── テスト: 全経路が beforeDate 以降しか持たない場合 ──────────────────────────

describe('全経路に有効な過去記録がない: null を返す', () => {
  test('history も prCache も manualBests も空 → null', () => {
    const { result } = renderHook(() => useWorkout(makeProps()));
    const pr = result.current.getPreviousPR(
      { name: 'スクワット', bodyPart: '脚' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).toBeNull();
  });

  test('history に当日記録のみ, prCache・manualBests も当日 (best_date あり) → null', () => {
    // 全エントリが best_date: '2026-11-05' (当日、日付あり) → 出口ガードで除外
    const history = { 'スクワット': [makeHistoryRecord('2026-11-05', 140, 5, '脚')] };
    const prCache = { 'スクワット': { max_weight: 140, max_reps: 5, best_date: '2026-11-05' } };
    const manualBests = [
      { id: '1', exercise_name: 'スクワット', weight: 140, reps: 5,
        best_date: '2026-11-05', body_part: '脚' },
    ];
    const { result } = renderHook(() => useWorkout(makeProps({ history, prCache, manualBests })));
    const pr = result.current.getPreviousPR(
      { name: 'スクワット', bodyPart: '脚' },
      { beforeDate: '2026-11-05' }
    );
    expect(pr).toBeNull();
  });
});

// ─── テスト: beforeDate 未指定なら従来どおり動く ──────────────────────────────

describe('beforeDate 未指定: 日付フィルタなし', () => {
  test('prCache に best_date が今日でも返す (beforeDate なし)', () => {
    const prCache = {
      'JMプレス': { max_weight: 40, max_reps: 8, best_date: '2026-11-05' },
    };
    const { result } = renderHook(() => useWorkout(makeProps({ prCache })));
    const pr = result.current.getPreviousPR(
      { name: 'JMプレス', bodyPart: '三頭' }
      // beforeDate 未指定
    );
    expect(pr).not.toBeNull(); // フィルタなしなので返る
    expect(pr.date).toBe('2026-11-05');
  });

  test('history に今日の記録があっても返す (beforeDate なし)', () => {
    const history = {
      'ベンチプレス': [makeHistoryRecord('2026-11-05', 100, 5, '胸')],
    };
    const { result } = renderHook(() => useWorkout(makeProps({ history })));
    const pr = result.current.getPreviousPR(
      { name: 'ベンチプレス', bodyPart: '胸' }
      // beforeDate 未指定
    );
    expect(pr).not.toBeNull();
    expect(pr.date).toBe('2026-11-05');
  });
});
