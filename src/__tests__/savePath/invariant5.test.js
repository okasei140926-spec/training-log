/**
 * 不変条件5: 削除済みの日付が起動時に Supabase へ再アップロードされない
 *
 * バグの再現条件:
 *   handleLogForDate が shouldUseSavedWorkout パスで保存するドラフトに
 *   payloadOrigin: "canonicalDisplayHistory" が設定されない場合、
 *   rescueUnsyncedDrafts が `isRemoteOriginContent` チェックで弾けず
 *   削除済み種目を再アップロードしてしまう（zombie upload）。
 *
 * テスト有効性の証明手順（手動):
 *   1. このテストが緑であることを確認
 *   2. useHistoryHandlers.js L324 の
 *        payloadOrigin: "canonicalDisplayHistory",
 *      行を削除する
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

describe('不変条件5: カレンダー開封で保存されるドラフトに payloadOrigin が設定される', () => {
    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test(
        'shouldUseSavedWorkout パスでは saveDraftForDate が ' +
        'payloadOrigin: "canonicalDisplayHistory" かつ hasUnsavedChanges: false で呼ばれる',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // 前提1: Supabase に DATE の記録がある（savedWorkout: Bench Press）
            // 前提2: ローカルにドラフトはない（localDraft: null）
            // 前提3: pendingChange なし（deleteIntent なし）
            // → shouldUseSavedWorkout = true → L321-334 のパスが通る
            //   → saveDraftForDate が呼ばれ payloadOrigin がセットされる
            const h = makeHarness({
                pendingChange: null,
                savedWorkout: {
                    date: DATE,
                    exercises: ['BenchPress'],
                },
                localDraft: null,
                persistentDeleted: {},
            });

            // ── Act ──────────────────────────────────────────────────────────
            h.logForDate(DATE);

            // ── Assert ───────────────────────────────────────────────────────
            // saveDraftForDate が1回呼ばれていること
            expect(h.saveDraftForDate).toHaveBeenCalledTimes(1);

            // 保存されたドラフトに payloadOrigin が設定されていること
            const savedDraft = h.savedDraft;
            expect(savedDraft?.meta?.payloadOrigin).toBe('canonicalDisplayHistory');

            // hasUnsavedChanges: false であること（rescue 対象外になる）
            expect(savedDraft?.meta?.hasUnsavedChanges).toBe(false);
        }
    );
});
