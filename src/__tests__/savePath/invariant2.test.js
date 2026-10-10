/**
 * 不変条件2: オフラインで入れた記録が再起動後も残る
 *
 * バグの再現条件:
 *   useHistoryHandlers.js の localDraftHasUnsavedChanges 計算で
 *   `draftForDate?.meta?.hasUnsavedChanges === true` の条件が false になると、
 *   ローカルドラフトが「内容はあるが変更なし」と判定され、
 *   emptyDraft パスが適用されてオフライン編集が失われる。
 *
 * テスト有効性の証明手順（手動):
 *   1. このテストが緑であることを確認
 *   2. useHistoryHandlers.js L136 を
 *        draftForDate?.meta?.hasUnsavedChanges === false ||
 *      に書き換える（true → false に変更）
 *   3. このテストが赤になることを確認
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

// "useWorkoutLog:set_add" → normalizeWorkoutEditSource → "set_add"
// getWorkoutEditReasonFromSource("set_add") → "set_add"（truthy）
// → isUnsavedUserWorkoutDraft が true を返す genuine source
const GENUINE_SOURCE = 'useWorkoutLog:set_add';

describe('不変条件2: オフラインで入れた記録が再起動後も残る', () => {
    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test(
        'hasUnsavedChanges: true の genuine ドラフトは handleLogForDate で applyLogDraftState に渡される',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // 前提1: ユーザーは DATE にオフラインでスクワットを記録した
            //         → localStorage にユーザー操作由来のドラフトがある
            //         → hasUnsavedChanges: true（Supabase 未同期）
            // 前提2: Supabase にはまだその記録が届いていない（savedWorkout: null）
            // 前提3: pendingChange なし
            const h = makeHarness({
                pendingChange: null,
                savedWorkout: null,
                localDraft: {
                    sessionEx: [
                        { id: 'Squat', name: 'Squat', label: null, bodyPart: null, order: 0 },
                    ],
                    logData: {
                        Squat: [{ weight: '80', reps: '5', unit: 'kg' }],
                    },
                    exerciseUnits: {},
                    todayLabels: [],
                    meta: {
                        date: DATE,
                        keyDate: DATE,
                        draftDate: DATE,
                        workoutDate: DATE,
                        source: GENUINE_SOURCE,
                        hasUnsavedChanges: true,
                    },
                },
                persistentDeleted: {},
            });

            // ── Act ──────────────────────────────────────────────────────────
            h.logForDate(DATE);

            // ── Assert ───────────────────────────────────────────────────────
            expect(h.applyLogDraftState).toHaveBeenCalledTimes(1);

            // ローカルドラフトの Squat が適用されていること
            const sessionEx = h.appliedSessionEx;
            expect(sessionEx?.length ?? 0).toBeGreaterThan(0);
            expect(sessionEx?.some((ex) => ex.name === 'Squat')).toBe(true);
        }
    );
});
