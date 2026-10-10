/**
 * 不変条件3: 部分削除で trustedRows が必ずクリアされる
 *
 * バグの再現条件:
 *   useHistoryHandlers.js の handleDeleteHistory で
 *   _clearTrustedRowsForDate が shouldClearDateArtifacts の条件外（無条件）で
 *   呼ばれていないと、部分削除（他の種目が残る日付）では
 *   trustedRows に削除済み種目の行が残り zombie restore が起きる。
 *
 * テスト有効性の証明手順（手動):
 *   1. このテストが緑であることを確認
 *   2. useHistoryHandlers.js L582-587 の
 *        if (deletedTargetDate) {
 *            _clearTrustedRowsForDate(...)
 *        }
 *      ブロックを
 *        if (shouldClearDateArtifacts && deletedTargetDate) {
 *            _clearTrustedRowsForDate(...)
 *        }
 *      に書き換える（shouldClearDateArtifacts 条件を追加）
 *   3. このテストが赤になることを確認（setHistory がモックのため
 *      shouldClearDateArtifacts は false のまま → clearTrustedRows が呼ばれない）
 *   4. 元に戻す → 再び緑
 */

jest.mock('../../utils/appHelpers', () => ({
    ...jest.requireActual('../../utils/appHelpers'),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
    addPersistentDeletedDate: jest.fn(),
    removePersistentDeletedDate: jest.fn(),
}));

jest.mock('../../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
}));

import { makeHarness } from '../../testUtils/savePathHarness';

const DATE = '2024-01-15';

describe('不変条件3: 部分削除で trustedRows がクリアされる', () => {
    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test(
        'handleDeleteHistory を呼ぶと shouldClearDateArtifacts に関わらず ' +
        'applyTrustedWorkoutRowsSnapshot が呼ばれる',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // 前提: trustedWorkoutRows に DATE の行がある
            //        → _clearTrustedRowsForDate が呼ばれたとき _wRemoved > 0 になる
            //          → applyTrustedWorkoutRowsSnapshot が呼ばれる
            // setHistory はモックなので callback は実行されず、
            // shouldClearDateArtifacts は false のまま。
            // それでも _clearTrustedRowsForDate は呼ばれるべき。
            const h = makeHarness({
                trustedWorkoutRows: [
                    { date: DATE, exercise_name: 'BenchPress', id: 'row-1' },
                ],
            });

            // ── Act ──────────────────────────────────────────────────────────
            // BenchPress の historyIdx=0 の記録を削除する
            // （harness の setHistory はモックなので history 実体は変わらないが
            //   deletedTargetDate = DATE は確定する）
            h.deleteHistory('BenchPress', 0, DATE);

            // ── Assert ───────────────────────────────────────────────────────
            // _clearTrustedRowsForDate → applyTrustedWorkoutRowsSnapshot が呼ばれること
            expect(h.applyTrustedWorkoutRowsSnapshot).toHaveBeenCalledTimes(1);

            // 呼ばれた際の引数: DATE の行が除去されたフィルタ済み配列
            const [filteredRows] = h.applyTrustedWorkoutRowsSnapshot.mock.calls[0];
            expect(filteredRows).toEqual([]);  // 行が1つだけで全部クリアされる
        }
    );
});
