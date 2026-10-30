/**
 * 自重種目の単位初期値テスト
 *
 * テスト対象:
 *   getDefaultUnitForExercise (useWorkoutLog.js)
 *
 * 背景:
 *   自重種目（懸垂・ディップスなど）を新規追加したとき、
 *   単位の初期値が "kg" になっていた。
 *   exerciseUnits[name] にユーザーの保存値がない場合に
 *   isBodyweightExerciseName(name) で BW を返すよう修正した。
 *
 * ユーザーが一度でも単位を変更した場合は exerciseUnits[name] が
 * 存在するためそちらが優先される。
 */

jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));

import { getDefaultUnitForExercise } from '../features/workout/useWorkoutLog';

describe('getDefaultUnitForExercise', () => {
    test('懸垂を追加すると単位が BW になること', () => {
        expect(getDefaultUnitForExercise('懸垂', {})).toBe('BW');
    });

    test('ディップスを追加すると単位が BW になること', () => {
        expect(getDefaultUnitForExercise('ディップス', {})).toBe('BW');
    });

    test('ベンチプレスを追加すると単位が kg になること', () => {
        expect(getDefaultUnitForExercise('ベンチプレス', {})).toBe('kg');
    });

    test('exerciseUnits に "懸垂": "kg" が保存されている場合は kg が優先されること', () => {
        expect(getDefaultUnitForExercise('懸垂', { '懸垂': 'kg' })).toBe('kg');
    });

    test('種目名が空文字のときに例外が出ないこと', () => {
        expect(() => getDefaultUnitForExercise('', {})).not.toThrow();
    });

    test('種目名が undefined のときに例外が出ないこと', () => {
        expect(() => getDefaultUnitForExercise(undefined, {})).not.toThrow();
    });

    test('exerciseUnits が undefined のときに例外が出ないこと', () => {
        expect(() => getDefaultUnitForExercise('懸垂', undefined)).not.toThrow();
        expect(getDefaultUnitForExercise('懸垂', undefined)).toBe('BW');
    });

    test('チンニングも BW になること（キーワード部分一致）', () => {
        expect(getDefaultUnitForExercise('チンニング', {})).toBe('BW');
    });

    test('プルアップも BW になること', () => {
        expect(getDefaultUnitForExercise('プルアップ', {})).toBe('BW');
    });

    test('腕立て伏せも BW になること', () => {
        expect(getDefaultUnitForExercise('腕立て伏せ', {})).toBe('BW');
    });

    test('exerciseUnits に "ベンチプレス": "lbs" が保存されている場合は lbs が優先されること', () => {
        expect(getDefaultUnitForExercise('ベンチプレス', { 'ベンチプレス': 'lbs' })).toBe('lbs');
    });

    test('exerciseUnits に "懸垂": "BW" が保存されている場合は BW が返ること（ユーザー選択と一致）', () => {
        expect(getDefaultUnitForExercise('懸垂', { '懸垂': 'BW' })).toBe('BW');
    });
});

// ─── addSet の 0-sets ケース ──────────────────────────────────────────────────
//
// ─── addSet の 0-sets ケースについて ────────────────────────────────────────
//
// addSet は useWorkoutLog 内の非 export フック関数のため、
// renderHook を使わずに直接テストできない。
// 以下のテストは getDefaultUnitForExercise を直接呼んでおり、
// addSet 自体（savedExerciseUnits = draft.exerciseUnits || {} の代入）は
// テストで保護されていない。
// addSet の保護には renderHook を使ったフックテストが必要。

describe('addSet が呼ぶ引数パターンの確認（addSet 自体は未テスト）', () => {
    test('保存値なしで 懸垂 → BW になること', () => {
        // addSet: savedExerciseUnits = {} のとき
        expect(getDefaultUnitForExercise('懸垂', {})).toBe('BW');
    });

    test('保存値なしで ベンチプレス → kg になること', () => {
        expect(getDefaultUnitForExercise('ベンチプレス', {})).toBe('kg');
    });

    test('exerciseUnits に "懸垂": "kg" が保存されている場合は kg が優先される', () => {
        // addSet: savedExerciseUnits = {"懸垂": "kg"} のとき
        // ※ addSet 側の savedExerciseUnits = {} に戻してもこのテストは FAIL しない
        expect(getDefaultUnitForExercise('懸垂', { '懸垂': 'kg' })).toBe('kg');
    });
});
