/**
 * 不変条件1: 削除した記録が復活しない
 *
 * バグの再現条件:
 *   useHistoryHandlers.js の shouldUseSavedWorkout の計算に
 *   !hasPendingDeleteIntent が含まれていない場合、
 *   handleLogForDate が trustedHistory から復元したデータを
 *   applyLogDraftState に渡してしまう（削除が無効化される）。
 *
 * テスト有効性の証明手順（手動):
 *   1. このテストが緑であることを確認
 *   2. useHistoryHandlers.js L160 を
 *        shouldUseSavedWorkout = hasSavedWorkout && !shouldUseLocalDraft;
 *      に書き換える（!hasPendingDeleteIntent を外す）
 *   3. このテストが赤になることを確認
 *   4. 元に戻す → 再び緑
 */

// ── jest.mock はホイストされるため最上部に置く ──────────────────────────────

// appHelpers は useHistoryHandlers.js が loadPersistentDeletedDates を直接 import
// しているため、テストで制御するにはモックが必要。
// 他の関数（normalizeDraftDateKey, withDraftDateMeta 等）はそのまま使う。
jest.mock('../../utils/appHelpers', () => ({
    ...jest.requireActual('../../utils/appHelpers'),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
    addPersistentDeletedDate: jest.fn(),
    removePersistentDeletedDate: jest.fn(),
}));

// logWriteTrace はテスト中に副作用を出さないよう黙らせる。
jest.mock('../../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
}));

// helpers はモックしない。
// getValidWorkoutDatesFromHistory({}) は trustedHistory={} に対して
// 自然に [] を返すため、実装そのままで動作する。

// ── テスト本体 ────────────────────────────────────────────────────────────────
import { makeHarness } from '../../testUtils/savePathHarness';

const DATE = '2024-01-15';

describe('不変条件1: 削除した記録が復活しない', () => {
    beforeEach(() => {
        // localStorage はテスト間で共有されないよう毎回クリア
        localStorage.clear();
        // loadPersistentDeletedDates のデフォルト返り値をリセット
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test(
        '削除ペンディング中の日付で handleLogForDate を呼んでも ' +
        '保存済みの種目が applyLogDraftState に渡されない',
        () => {
            // ── Arrange ─────────────────────────────────────────────────────
            // 前提1: ユーザーは DATE の記録を削除した
            //         → pendingChange に explicitDelete: true が入っている
            //         → まだ Supabase へのデリートは完了していない
            // 前提2: trustedHistory（Supabase キャッシュ）には
            //         Bench Press のデータがまだ残っている
            // 前提3: localStorage にローカルドラフトはない
            // 前提4: persistentDeletedDates には入っていない（Gate A を通過させる）
            const h = makeHarness({
                pendingChange: {
                    date: DATE,
                    explicitDelete: true,
                    deleteScope: 'date',
                },
                savedWorkout: {
                    date: DATE,
                    exercises: ['Bench Press'],
                },
                localDraft: null,
                persistentDeleted: {},
            });

            // ── Act ──────────────────────────────────────────────────────────
            // ユーザーが DELETE 後にもう一度その日付をカレンダーで開く
            h.logForDate(DATE);

            // ── Assert ───────────────────────────────────────────────────────
            // applyLogDraftState は必ず1回呼ばれる
            // （shouldUseSavedWorkout が false の場合 emptyDraft パスで呼ばれる）
            expect(h.applyLogDraftState).toHaveBeenCalledTimes(1);

            // 適用されたドラフトに Bench Press が含まれていてはいけない
            // sessionEx が null（empty パス）か [] であることを確認
            const sessionEx = h.appliedSessionEx;
            expect(sessionEx?.length ?? 0).toBe(0);
        }
    );
});
