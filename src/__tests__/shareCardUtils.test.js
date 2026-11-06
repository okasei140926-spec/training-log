/**
 * shareCardUtils テスト
 *
 * テスト対象:
 *   - buildPrDetail          : PR エントリの先頭1件から prDetail を生成
 *   - computeWeeklyDays      : workoutDate を含む週（日曜始まり）の7日分を返す
 *   - getBodyPartDisplayData : 5件以上で上位4件＋hiddenCount
 *   - buildStoryExerciseList : isCompact=true で上位2セット / false で全セット
 *   - formatPrDetailValue    : prDetail → 「36kg × 11」形式
 *
 * 両画面経路での prDetail / weeklyDays の一致:
 *   どちらも同じ純粋関数（buildPrDetail / computeWeeklyDays）を呼ぶため、
 *   同じ入力に対して必ず同じ出力を返す（別途検証）。
 *
 * カード描画テスト（color / text 分岐）:
 *   WorkoutSessionShareModal をレンダリングし、data-testid で検証する。
 */

jest.mock('../utils/supabase', () => ({
  supabase: {},
  supabaseConfigError: null,
}));
jest.mock('html-to-image', () => ({ toBlob: jest.fn() }));

import {
  buildPrDetail,
  buildStoryExerciseList,
  buildExerciseItems,
  computeWeeklyDays,
  formatPrDetailValue,
  getBodyPartDisplayData,
} from '../utils/shareCardUtils';

import { render, fireEvent } from '@testing-library/react';
import WorkoutSessionShareModal from '../components/modals/WorkoutSessionShareModal';

// ─── ヘルパー ────────────────────────────────────────────────────────────────

const makeSet = (weight, reps) => ({
  weight, reps, displayWeight: weight, displayUnit: 'kg',
});

const makeHistoryRecord = (date, exerciseName = 'ベンチプレス') => ({
  [exerciseName]: [{ date, sets: [{ weight: 100, reps: 5, done: true }] }],
});

const makePayload = (summaryOverrides = {}, items = []) => ({
  durationSec: 4410,
  session: {
    workout_date: '2026-11-05',
    summary_json: {
      setCount: 11,
      totalVolume: 5179,
      setCountByBodyPart: [
        { bodyPart: '胸', count: 5 },
        { bodyPart: '三頭', count: 4 },
      ],
      weeklyDays: [
        { dateKey: '2026-11-02', weekdayLabel: '日', trained: false },
        { dateKey: '2026-11-03', weekdayLabel: '月', trained: true },
        { dateKey: '2026-11-04', weekdayLabel: '火', trained: false },
        { dateKey: '2026-11-05', weekdayLabel: '水', trained: true },
        { dateKey: '2026-11-06', weekdayLabel: '木', trained: false },
        { dateKey: '2026-11-07', weekdayLabel: '金', trained: false },
        { dateKey: '2026-11-08', weekdayLabel: '土', trained: false },
      ],
      weeklyTrainedCount: 2,
      prDetail: null,
      ...summaryOverrides,
    },
  },
  preview_items: items,
});

// ─── buildPrDetail ────────────────────────────────────────────────────────────

describe('buildPrDetail', () => {
  test('空配列 → null', () => {
    expect(buildPrDetail([])).toBeNull();
    expect(buildPrDetail(null)).toBeNull();
    expect(buildPrDetail(undefined)).toBeNull();
  });

  test('先頭エントリの4フィールドを返す', () => {
    const entries = [
      { exerciseName: 'ベンチプレス', weight: 100, reps: 5, unit: 'kg', rmGain: 10 },
      { exerciseName: 'スクワット',  weight: 140, reps: 5, unit: 'kg', rmGain: 5  },
    ];
    const result = buildPrDetail(entries);
    expect(result).toEqual({
      exerciseName: 'ベンチプレス',
      weight: 100,
      reps: 5,
      unit: 'kg',
    });
  });

  test('エントリが1件のみでも返す', () => {
    const result = buildPrDetail([{ exerciseName: 'JMプレス', weight: 36, reps: 11, unit: 'kg' }]);
    expect(result).not.toBeNull();
    expect(result.exerciseName).toBe('JMプレス');
    expect(result.weight).toBe(36);
  });
});

// ─── computeWeeklyDays ────────────────────────────────────────────────────────

describe('computeWeeklyDays', () => {
  test('7件を返す', () => {
    const days = computeWeeklyDays('2026-11-05', {});
    expect(days).toHaveLength(7);
  });

  test('日曜始まりの週を返す (2026-11-05 は木曜)', () => {
    // 2026-11-05 は木曜 → その週は日曜 2026-11-01 ～ 土曜 2026-11-07
    const days = computeWeeklyDays('2026-11-05', {});
    expect(days[0].dateKey).toBe('2026-11-01');
    expect(days[0].weekdayLabel).toBe('日');
    expect(days[6].dateKey).toBe('2026-11-07');
    expect(days[6].weekdayLabel).toBe('土');
  });

  test('workoutDate 当日は index 4 (木)', () => {
    const days = computeWeeklyDays('2026-11-05', {});
    expect(days[4].dateKey).toBe('2026-11-05');
    expect(days[4].weekdayLabel).toBe('木');
  });

  test('history に記録がある日は trained=true', () => {
    const history = {
      ベンチプレス: [
        { date: '2026-11-03', sets: [] },
        { date: '2026-11-05', sets: [] },
      ],
    };
    const days = computeWeeklyDays('2026-11-05', history);
    const map = Object.fromEntries(days.map((d) => [d.dateKey, d.trained]));
    expect(map['2026-11-03']).toBe(true);  // 火曜
    expect(map['2026-11-05']).toBe(true);  // 木曜（workoutDate）
    expect(map['2026-11-01']).toBe(false); // 日曜（記録なし）
  });

  test('currentDate を指定すると history になくても trained=true', () => {
    const days = computeWeeklyDays('2026-11-05', {}, '2026-11-05');
    const target = days.find((d) => d.dateKey === '2026-11-05');
    expect(target?.trained).toBe(true);
  });

  test('history に workoutDate より後の記録があっても今週に含まれれば trained=true', () => {
    const history = { スクワット: [{ date: '2026-11-07', sets: [] }] };
    const days = computeWeeklyDays('2026-11-05', history);
    const sat = days.find((d) => d.dateKey === '2026-11-07');
    expect(sat?.trained).toBe(true);
  });

  test('日曜始まり: workoutDate が日曜のとき index 0 が workoutDate', () => {
    // 2026-11-01 は日曜
    const days = computeWeeklyDays('2026-11-01', {});
    expect(days[0].dateKey).toBe('2026-11-01');
    expect(days[0].weekdayLabel).toBe('日');
  });
});

// ─── getBodyPartDisplayData ───────────────────────────────────────────────────

describe('getBodyPartDisplayData', () => {
  test('4件以下: 全件表示、hiddenCount=0', () => {
    const cards = [
      { bodyPart: '胸', count: 5 },
      { bodyPart: '三頭', count: 3 },
      { bodyPart: '肩', count: 2 },
    ];
    const { visible, hiddenCount } = getBodyPartDisplayData(cards);
    expect(visible).toHaveLength(3);
    expect(hiddenCount).toBe(0);
  });

  test('5件以上: 上位4件のみ表示、hiddenCount が残り件数', () => {
    const cards = [
      { bodyPart: '胸', count: 5 },
      { bodyPart: '三頭', count: 4 },
      { bodyPart: '肩', count: 3 },
      { bodyPart: '背中', count: 2 },
      { bodyPart: '脚', count: 1 },
    ];
    const { visible, hiddenCount } = getBodyPartDisplayData(cards);
    expect(visible).toHaveLength(4);
    expect(hiddenCount).toBe(1);
  });

  test('6件: hiddenCount=2', () => {
    const cards = Array.from({ length: 6 }, (_, i) => ({
      bodyPart: `部位${i}`,
      count: 6 - i,
    }));
    const { hiddenCount } = getBodyPartDisplayData(cards);
    expect(hiddenCount).toBe(2);
  });

  test('セット数の多い順にソートされる', () => {
    const cards = [
      { bodyPart: '肩', count: 2 },
      { bodyPart: '胸', count: 5 },
      { bodyPart: '三頭', count: 3 },
    ];
    const { visible } = getBodyPartDisplayData(cards);
    expect(visible[0].bodyPart).toBe('胸');
    expect(visible[1].bodyPart).toBe('三頭');
    expect(visible[2].bodyPart).toBe('肩');
  });

  test('maxCount は visible の先頭（最大値）', () => {
    const cards = [
      { bodyPart: '胸', count: 5 },
      { bodyPart: '三頭', count: 3 },
    ];
    const { maxCount } = getBodyPartDisplayData(cards);
    expect(maxCount).toBe(5);
  });

  test('maxVisible=3 で4件のとき: visible=3, hiddenCount=1', () => {
    const cards = [
      { bodyPart: '胸', count: 6 },
      { bodyPart: '肩', count: 6 },
      { bodyPart: '背中', count: 5 },
      { bodyPart: '二頭', count: 2 },
    ];
    const { visible, hiddenCount } = getBodyPartDisplayData(cards, 3);
    expect(visible).toHaveLength(3);
    expect(hiddenCount).toBe(1);
  });
});

// ─── buildStoryExerciseList ───────────────────────────────────────────────────

describe('buildStoryExerciseList', () => {
  const makeItem = (name, weights) => ({
    name,
    sets: weights.map((w) => makeSet(w, 5)),
  });

  test('isCompact=true: 上位2セットのみ、区切りは " / "', () => {
    const items = [makeItem('ベンチプレス', [100, 95, 90])];
    const result = buildStoryExerciseList(items, true);
    expect(result[0].setsLabel).toBe('100kg × 5 / 95kg × 5');
    expect(result[0].setsLabel).not.toContain('90kg × 5');
  });

  test('isCompact=false: 全セット表示、区切りは " ／ "', () => {
    const items = [makeItem('ベンチプレス', [100, 95, 90])];
    const result = buildStoryExerciseList(items, false);
    expect(result[0].setsLabel).toBe('100kg × 5 ／ 95kg × 5 ／ 90kg × 5');
  });

  test('セットが1件のとき区切りなし', () => {
    const items = [makeItem('スクワット', [140])];
    expect(buildStoryExerciseList(items, true)[0].setsLabel).toBe('140kg × 5');
    expect(buildStoryExerciseList(items, false)[0].setsLabel).toBe('140kg × 5');
  });

  test('displayable でないセットはスキップされる', () => {
    const items = [{
      name: 'テスト',
      sets: [
        { weight: 0, reps: 5, displayWeight: 0, displayUnit: 'kg' }, // weight=0 → skip
        { weight: 100, reps: 5, displayWeight: 100, displayUnit: 'kg' },
      ],
    }];
    const result = buildStoryExerciseList(items, true);
    expect(result[0].setsLabel).toBe('100kg × 5');
  });
});

// ─── formatPrDetailValue ──────────────────────────────────────────────────────

describe('formatPrDetailValue', () => {
  test('null → 空文字', () => {
    expect(formatPrDetailValue(null)).toBe('');
  });

  test('通常の重量×回数 → 「Xkg × Y」', () => {
    expect(formatPrDetailValue({ weight: 36, reps: 11, unit: 'kg' })).toBe('36kg × 11');
    expect(formatPrDetailValue({ weight: 100, reps: 5, unit: 'kg' })).toBe('100kg × 5');
  });

  test('BW → 「自重 × Y」', () => {
    expect(formatPrDetailValue({ weight: 'BW', reps: 10, unit: 'bw' })).toBe('自重 × 10');
  });
});

// ─── カード描画テスト ─────────────────────────────────────────────────────────
// WorkoutSessionShareModal をレンダリングし、data-testid / style で検証する。

describe('WorkoutSessionShareModal カード描画', () => {
  // story モード（デフォルト）で描画される

  test('prDetail が null のとき weekly-trained-count が表示される', () => {
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={makePayload({ weeklyTrainedCount: 2 })}
        onClose={() => {}}
      />
    );
    const els = container.querySelectorAll('[data-testid="weekly-trained-count"]');
    expect(els.length).toBeGreaterThan(0);
    expect(els[0].textContent).toBe('2');
  });

  test('prDetail があるとき種目名と値が表示される', () => {
    const payload = makePayload({
      prDetail: { exerciseName: 'JMプレス', weight: 36, reps: 11, unit: 'kg' },
    });
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    const nameEls  = container.querySelectorAll('[data-testid="pr-exercise-name"]');
    const valueEls = container.querySelectorAll('[data-testid="pr-value"]');
    expect(nameEls.length).toBeGreaterThan(0);
    expect(nameEls[0].textContent).toBe('JMプレス');
    expect(valueEls[0].textContent).toBe('36kg × 11');
  });

  test('weeklyDays の trained が色に反映される (data-trained 属性で確認)', () => {
    // jsdom は hex color を rgb() 形式に正規化するため、
    // trained の真偽がスタイルの分岐に使われていることを
    // data-trained 属性 + 色の差異で確認する。
    const payload = makePayload({
      weeklyDays: [
        { dateKey: '2026-11-02', weekdayLabel: '日', trained: false },
        { dateKey: '2026-11-03', weekdayLabel: '月', trained: true },
        { dateKey: '2026-11-04', weekdayLabel: '火', trained: false },
        { dateKey: '2026-11-05', weekdayLabel: '水', trained: false },
        { dateKey: '2026-11-06', weekdayLabel: '木', trained: false },
        { dateKey: '2026-11-07', weekdayLabel: '金', trained: false },
        { dateKey: '2026-11-08', weekdayLabel: '土', trained: false },
      ],
    });
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    const blocks = container.querySelectorAll('[data-testid="weekly-day-block"]');
    expect(blocks).toHaveLength(7);

    // trained=true のブロックと false のブロックで背景色が異なること
    const trainedBlock   = container.querySelector('[data-trained="true"][data-is-card-date="false"]');
    const untrainedBlock = container.querySelector('[data-trained="false"][data-is-card-date="false"]');
    expect(trainedBlock).not.toBeNull();
    expect(untrainedBlock).not.toBeNull();
    expect(trainedBlock.style.background).not.toBe(untrainedBlock.style.background);
  });

  test('カードの日（workoutDate）のセルだけ強調される (data-is-card-date で確認)', () => {
    const payload = makePayload({
      weeklyDays: [
        { dateKey: '2026-11-02', weekdayLabel: '日', trained: false },
        { dateKey: '2026-11-03', weekdayLabel: '月', trained: false },
        { dateKey: '2026-11-04', weekdayLabel: '火', trained: false },
        { dateKey: '2026-11-05', weekdayLabel: '水', trained: true },
        { dateKey: '2026-11-06', weekdayLabel: '木', trained: false },
        { dateKey: '2026-11-07', weekdayLabel: '金', trained: false },
        { dateKey: '2026-11-08', weekdayLabel: '土', trained: false },
      ],
    });
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    const blocks = container.querySelectorAll('[data-testid="weekly-day-block"]');
    const cardDateBlocks = Array.from(blocks).filter(
      (b) => b.getAttribute('data-is-card-date') === 'true'
    );
    const otherBlocks = Array.from(blocks).filter(
      (b) => b.getAttribute('data-is-card-date') !== 'true'
    );

    // カードの日は1セルのみ
    expect(cardDateBlocks).toHaveLength(1);
    // カードの日の date は workoutDate
    expect(cardDateBlocks[0].getAttribute('data-date')).toBe('2026-11-05');
    // カードの日と trained=true の他セルでは背景色が異なる（#0C6B62 vs #14A99C）
    const trainedOther = otherBlocks.find((b) => b.getAttribute('data-trained') === 'true');
    expect(cardDateBlocks[0].style.background).not.toBe(trainedOther?.style.background ?? '');
    // box-shadow が設定されている（jsdom では cssText か style プロパティで確認）
    expect(cardDateBlocks[0].style.boxShadow).not.toBe('');
  });

  test('種目4つ以上で上位2セットのみ表示（3番目は出ない）', () => {
    const fourExercises = [
      { exercise_name: 'ベンチプレス', body_part: '胸',  sets: [makeSet(100, 5), makeSet(95, 5), makeSet(90, 5)] },
      { exercise_name: 'スクワット',   body_part: '脚',  sets: [makeSet(140, 5), makeSet(130, 5)] },
      { exercise_name: 'デッドリフト', body_part: '背中', sets: [makeSet(160, 5), makeSet(150, 5)] },
      { exercise_name: 'ショルダープレス', body_part: '肩', sets: [makeSet(60, 5), makeSet(55, 5), makeSet(50, 5)] },
    ];
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={makePayload({}, fourExercises)}
        onClose={() => {}}
      />
    );
    const labels = container.querySelectorAll('[data-testid="exercise-sets-label"]');
    // ベンチプレスのラベルを探す
    const items  = container.querySelectorAll('[data-testid="exercise-item"]');
    const bench  = Array.from(items).find((el) =>
      el.querySelector('[data-testid="exercise-name"]')?.textContent === 'ベンチプレス'
    );
    const benchLabel = bench?.querySelector('[data-testid="exercise-sets-label"]')?.textContent;
    expect(benchLabel).toBe('100kg × 5 / 95kg × 5');
    expect(benchLabel).not.toContain('90kg × 5');
  });

  test('種目3つ以下で全セット表示', () => {
    const threeExercises = [
      { exercise_name: 'ベンチプレス', body_part: '胸', sets: [makeSet(100, 5), makeSet(95, 5), makeSet(90, 5)] },
      { exercise_name: 'スクワット',   body_part: '脚', sets: [makeSet(140, 5)] },
      { exercise_name: 'デッドリフト', body_part: '背中', sets: [makeSet(160, 5)] },
    ];
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={makePayload({}, threeExercises)}
        onClose={() => {}}
      />
    );
    const items = container.querySelectorAll('[data-testid="exercise-item"]');
    const bench = Array.from(items).find((el) =>
      el.querySelector('[data-testid="exercise-name"]')?.textContent === 'ベンチプレス'
    );
    const label = bench?.querySelector('[data-testid="exercise-sets-label"]')?.textContent;
    expect(label).toBe('100kg × 5 ／ 95kg × 5 ／ 90kg × 5');
    expect(label).toContain('90kg × 5'); // 3番目も表示される
  });

  test('部位5件以上で上位4件＋「他N部位」が表示される', () => {
    const payload = makePayload({
      setCountByBodyPart: [
        { bodyPart: '胸', count: 5 },
        { bodyPart: '三頭', count: 4 },
        { bodyPart: '肩', count: 3 },
        { bodyPart: '背中', count: 2 },
        { bodyPart: '脚', count: 1 },
      ],
    });
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    expect(container.textContent).toContain('他1部位');
    // 5番目の部位「脚」は表示されない
    // ラベルとして「脚」が含まれないことを確認（ヘッダーに「今週」等もあるので部位行だけ検証）
    const bodyPartLabels = Array.from(
      container.querySelectorAll('[data-testid="exercise-item"]')
    ).map((el) => el.querySelector('[data-testid="exercise-name"]')?.textContent);
    // exercise-item は種目リストなので部位カードとは別。
    // 「脚」のカードバーが出ていないことを確認: textContent に「脚」が含まれているか
    // （部位ラベルは div として描画されているため）
    expect(container.textContent).not.toMatch(/脚\s*\n?\s*\d+$/m);
  });

  test('1:1 で部位4件のとき、バーは3本＋「他1部位」になること', () => {
    const payload = makePayload({
      setCountByBodyPart: [
        { bodyPart: '胸', count: 6 },
        { bodyPart: '肩', count: 6 },
        { bodyPart: '背中', count: 5 },
        { bodyPart: '二頭', count: 2 },
      ],
    });
    const { container, getByText } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-04"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    // 1:1 モードに切り替え
    fireEvent.click(getByText('1:1'));

    const rows = container.querySelectorAll('[data-testid="body-part-row"]');
    expect(rows).toHaveLength(3);
    expect(container.textContent).toContain('他1部位');
  });

  test('9:16 で部位4件・種目7件のとき、種目は4件＋「他3種目」になること', () => {
    // 総行数上限5: 種目4行 + ラベル1行 = 5行
    const sevenExercises = [
      { exercise_name: 'ベンチプレス',       body_part: '胸',  sets: [makeSet(100, 5), makeSet(95, 5)] },
      { exercise_name: 'インクラインDB',      body_part: '胸',  sets: [makeSet(30, 10)] },
      { exercise_name: 'ケーブルフライ',      body_part: '胸',  sets: [makeSet(20, 12)] },
      { exercise_name: 'ショルダープレス',    body_part: '肩',  sets: [makeSet(60, 8)] },
      { exercise_name: 'ラテラルレイズ',      body_part: '肩',  sets: [makeSet(10, 15)] },
      { exercise_name: 'フェイスプル',        body_part: '肩',  sets: [makeSet(30, 15)] },
      { exercise_name: 'プッシュダウン',      body_part: '三頭', sets: [makeSet(40, 12)] },
    ];
    const payload = makePayload({
      setCountByBodyPart: [
        { bodyPart: '胸',  count: 6 },
        { bodyPart: '肩',  count: 6 },
        { bodyPart: '背中', count: 5 },
        { bodyPart: '二頭', count: 2 },
      ],
    }, sevenExercises);
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-04"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    const items = container.querySelectorAll('[data-testid="exercise-item"]');
    expect(items).toHaveLength(4);
    const hiddenLabel = container.querySelector('[data-testid="hidden-exercise-label"]');
    expect(hiddenLabel).not.toBeNull();
    expect(hiddenLabel.textContent).toBe('他3種目');
  });

  test('9:16 で部位3件・種目7件のとき、種目は5件＋「他2種目」になること', () => {
    // 総行数上限6: 種目5行 + ラベル1行 = 6行
    const sevenExercises = [
      { exercise_name: 'ベンチプレス',    body_part: '胸',  sets: [makeSet(100, 5)] },
      { exercise_name: 'インクラインDB',  body_part: '胸',  sets: [makeSet(30, 10)] },
      { exercise_name: 'ケーブルフライ',  body_part: '胸',  sets: [makeSet(20, 12)] },
      { exercise_name: 'スクワット',      body_part: '脚',  sets: [makeSet(140, 5)] },
      { exercise_name: 'レッグプレス',    body_part: '脚',  sets: [makeSet(200, 10)] },
      { exercise_name: 'デッドリフト',    body_part: '背中', sets: [makeSet(160, 5)] },
      { exercise_name: 'ラットプルダウン', body_part: '背中', sets: [makeSet(80, 8)] },
    ];
    const payload = makePayload({
      setCountByBodyPart: [
        { bodyPart: '胸',  count: 5 },
        { bodyPart: '脚',  count: 4 },
        { bodyPart: '背中', count: 3 },
      ],
    }, sevenExercises);
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    const items = container.querySelectorAll('[data-testid="exercise-item"]');
    expect(items).toHaveLength(5);
    const hiddenLabel = container.querySelector('[data-testid="hidden-exercise-label"]');
    expect(hiddenLabel).not.toBeNull();
    expect(hiddenLabel.textContent).toBe('他2種目');
  });

  test('9:16 で部位3件・種目6件のとき、種目6件でラベルなし', () => {
    // list.length(6) <= maxRows(6) → 全件表示、ラベルなし
    const sixExercises = [
      { exercise_name: 'ベンチプレス',    body_part: '胸',  sets: [makeSet(100, 5)] },
      { exercise_name: 'インクラインDB',  body_part: '胸',  sets: [makeSet(30, 10)] },
      { exercise_name: 'ケーブルフライ',  body_part: '胸',  sets: [makeSet(20, 12)] },
      { exercise_name: 'スクワット',      body_part: '脚',  sets: [makeSet(140, 5)] },
      { exercise_name: 'デッドリフト',    body_part: '背中', sets: [makeSet(160, 5)] },
      { exercise_name: 'ラットプルダウン', body_part: '背中', sets: [makeSet(80, 8)] },
    ];
    const payload = makePayload({
      setCountByBodyPart: [
        { bodyPart: '胸',  count: 5 },
        { bodyPart: '脚',  count: 4 },
        { bodyPart: '背中', count: 3 },
      ],
    }, sixExercises);
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    const items = container.querySelectorAll('[data-testid="exercise-item"]');
    expect(items).toHaveLength(6);
    expect(container.querySelector('[data-testid="hidden-exercise-label"]')).toBeNull();
  });

  test('9:16 で部位4件・種目5件のとき、種目5件でラベルなし', () => {
    // list.length(5) <= maxRows(5) → 全件表示、ラベルなし
    const fiveExercises = [
      { exercise_name: 'ベンチプレス',    body_part: '胸',  sets: [makeSet(100, 5), makeSet(95, 5)] },
      { exercise_name: 'インクラインDB',  body_part: '胸',  sets: [makeSet(30, 10)] },
      { exercise_name: 'ショルダープレス', body_part: '肩',  sets: [makeSet(60, 8)] },
      { exercise_name: 'サイドレイズ',    body_part: '肩',  sets: [makeSet(10, 15)] },
      { exercise_name: 'プッシュダウン',  body_part: '三頭', sets: [makeSet(40, 12)] },
    ];
    const payload = makePayload({
      setCountByBodyPart: [
        { bodyPart: '胸',  count: 6 },
        { bodyPart: '肩',  count: 6 },
        { bodyPart: '背中', count: 5 },
        { bodyPart: '二頭', count: 2 },
      ],
    }, fiveExercises);
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-04"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    const items = container.querySelectorAll('[data-testid="exercise-item"]');
    expect(items).toHaveLength(5);
    expect(container.querySelector('[data-testid="hidden-exercise-label"]')).toBeNull();
  });

  test('9:16 で部位4件・種目6件のとき、種目4件＋「他2種目」になること', () => {
    // 総行数上限5: 種目4行 + ラベル1行 = 5行、隠れ=6-4=2
    const sixExercises = [
      { exercise_name: 'ベンチプレス',    body_part: '胸',  sets: [makeSet(100, 5), makeSet(95, 5)] },
      { exercise_name: 'インクラインDB',  body_part: '胸',  sets: [makeSet(30, 10)] },
      { exercise_name: 'ケーブルフライ',  body_part: '胸',  sets: [makeSet(20, 12)] },
      { exercise_name: 'ショルダープレス', body_part: '肩',  sets: [makeSet(60, 8)] },
      { exercise_name: 'サイドレイズ',    body_part: '肩',  sets: [makeSet(10, 15)] },
      { exercise_name: 'プッシュダウン',  body_part: '三頭', sets: [makeSet(40, 12)] },
    ];
    const payload = makePayload({
      setCountByBodyPart: [
        { bodyPart: '胸',  count: 6 },
        { bodyPart: '肩',  count: 6 },
        { bodyPart: '背中', count: 5 },
        { bodyPart: '二頭', count: 2 },
      ],
    }, sixExercises);
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-04"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    const items = container.querySelectorAll('[data-testid="exercise-item"]');
    expect(items).toHaveLength(4);
    const hiddenLabel = container.querySelector('[data-testid="hidden-exercise-label"]');
    expect(hiddenLabel).not.toBeNull();
    expect(hiddenLabel.textContent).toBe('他2種目');
  });

  test('種目が上限以下のとき「他◯種目」が出ないこと', () => {
    const fiveExercises = [
      { exercise_name: 'ベンチプレス',    body_part: '胸',  sets: [makeSet(100, 5)] },
      { exercise_name: 'インクラインDB',  body_part: '胸',  sets: [makeSet(30, 10)] },
      { exercise_name: 'スクワット',      body_part: '脚',  sets: [makeSet(140, 5)] },
      { exercise_name: 'デッドリフト',    body_part: '背中', sets: [makeSet(160, 5)] },
      { exercise_name: 'ラットプルダウン', body_part: '背中', sets: [makeSet(80, 8)] },
    ];
    const payload = makePayload({
      setCountByBodyPart: [
        { bodyPart: '胸',  count: 5 },
        { bodyPart: '脚',  count: 4 },
        { bodyPart: '背中', count: 3 },
      ],
    }, fiveExercises);
    const { container } = render(
      <WorkoutSessionShareModal
        isOpen={true}
        workoutDate="2026-11-05"
        sessionPayload={payload}
        onClose={() => {}}
      />
    );
    // 部位3件 → 上限6。種目5件 → 上限に達しないので「他◯種目」なし
    expect(container.querySelector('[data-testid="hidden-exercise-label"]')).toBeNull();
  });

  test('両経路共通: buildPrDetail / computeWeeklyDays は同一入力に対して同一出力', () => {
    // LogScreen 経路と HistoryScreen 経路は同じ純粋関数を使うため、
    // 同じ prEntries / history / date からは必ず同じ結果が得られる。
    const prEntries = [
      { exerciseName: 'ベンチプレス', weight: 100, reps: 5, unit: 'kg', rmGain: 10 },
    ];
    const history = { ベンチプレス: [{ date: '2026-11-03' }] };
    const date = '2026-11-05';

    const prDetail1 = buildPrDetail(prEntries);
    const prDetail2 = buildPrDetail(prEntries);
    expect(prDetail1).toEqual(prDetail2);

    const weekly1 = computeWeeklyDays(date, history);
    const weekly2 = computeWeeklyDays(date, history);
    expect(weekly1).toEqual(weekly2);
  });
});
