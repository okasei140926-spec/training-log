/**
 * calcProgressionTarget テスト
 *
 * テスト対象:
 *   calcProgressionTarget (components/LogScreen.jsx)
 *
 * 背景:
 *   dispUnit が "BW" のとき convertKgValueForDisplayUnit が 0 を返すため
 *   "0自重 × N" と表示されるバグがあった。
 *   dispUnit==="BW" 時に重量ベース経路から自重ベースに fallback するよう修正した。
 *
 * テストできていること:
 *   - 重量セット、dispUnit=kg → 重量+1rep または weight+2.5kg
 *   - 重量セット、dispUnit=BW → 自重ベースに fallback（"0自重" 問題の修正確認）
 *   - 純粋 BW セット群 → "自重" + maxReps+1
 *   - prevSets 空/null → null
 *
 * テストできていないこと:
 *   - LogScreen JSX 内での実際のレンダリング
 */

// LogScreen.jsx の依存をモック
jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));
jest.mock('../context/UserSettingsContext', () => ({
    useUserSettings: () => ({}),
}));
jest.mock('../utils/workoutSessions', () => ({}));
jest.mock('../utils/styles', () => ({ S: {} }));
jest.mock('../utils/setCountByBodyPart', () => ({ getSetCountByBodyPart: jest.fn() }));
jest.mock('../components/modals/AddExModal', () => () => null);
jest.mock('../components/modals/LogExerciseHistoryModal', () => () => null);
jest.mock('../components/modals/WorkoutSessionShareModal', () => () => null);
jest.mock('../components/log/SetRow', () => ({ default: () => null }));
jest.mock('../components/WorkoutElapsedTimer', () => () => null);
jest.mock('@dnd-kit/core', () => ({
    DndContext: () => null,
    PointerSensor: class {},
    closestCenter: jest.fn(),
    useSensor: jest.fn(),
    useSensors: jest.fn(),
}));
jest.mock('@dnd-kit/sortable', () => ({
    SortableContext: () => null,
    useSortable: jest.fn(() => ({
        attributes: {},
        listeners: {},
        setNodeRef: jest.fn(),
        transform: null,
        transition: null,
        isDragging: false,
    })),
    verticalListSortingStrategy: jest.fn(),
}));
jest.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: jest.fn() } } }));

import { calcProgressionTarget } from '../components/LogScreen';

// PROG_REP_MAX=12, PROG_REP_MIN=8, PROG_WEIGHT_INC_KG=2.5

describe('calcProgressionTarget: 重量セット kg モード', () => {
    test('前回 10rep → 今回 11rep（重量維持）', () => {
        const prevSets = [{ weight: '80', unit: 'kg', reps: 10 }];
        const result = calcProgressionTarget(prevSets, 'kg', 'kg');
        expect(result).not.toBeNull();
        expect(result.reps).toBe(11);
        expect(result.weightDisplay).toBe('80');
        expect(result.unit).toBe('kg');
    });

    test('前回 12rep（PROG_REP_MAX）→ 今回 +2.5kg、8rep', () => {
        const prevSets = [{ weight: '80', unit: 'kg', reps: 12 }];
        const result = calcProgressionTarget(prevSets, 'kg', 'kg');
        expect(result).not.toBeNull();
        expect(result.reps).toBe(8);
        expect(result.weightDisplay).toBe('82.5');
        expect(result.unit).toBe('kg');
    });
});

describe('calcProgressionTarget: dispUnit=BW（バグ修正確認）', () => {
    test('前回が数値セット、dispUnit=BW → "自重" に fallback し "0自重" にならない', () => {
        // 修正前: convertKgValueForDisplayUnit(80, "BW") = 0 → "0自重 × 8"
        // 修正後: BW fallback → { weightDisplay: "自重", unit: "", reps: 8 }
        const prevSets = [{ weight: '80', unit: 'kg', reps: 9 }];
        const result = calcProgressionTarget(prevSets, 'kg', 'BW');
        expect(result).not.toBeNull();
        expect(result.weightDisplay).toBe('自重');
        expect(result.unit).toBe('');
        expect(result.weightDisplay).not.toBe('0');
    });

    test('前回が数値セット、BW fallback → reps は PROG_REP_MIN', () => {
        // maxBWReps=0 なので PROG_REP_MIN(8) を返す
        const prevSets = [{ weight: '80', unit: 'kg', reps: 9 }];
        const result = calcProgressionTarget(prevSets, 'kg', 'BW');
        expect(result.reps).toBe(8); // PROG_REP_MIN
    });

    test('前回に BW セットも混在する場合、BW fallback → maxBWReps+1', () => {
        const prevSets = [
            { weight: '80', unit: 'kg', reps: 9 },
            { weight: 'BW', reps: 10 },
        ];
        const result = calcProgressionTarget(prevSets, 'kg', 'BW');
        expect(result.weightDisplay).toBe('自重');
        expect(result.reps).toBe(11); // maxBWReps(10)+1
    });
});

describe('calcProgressionTarget: 純粋 BW セット', () => {
    test('BW セットのみ → "自重"、maxReps+1', () => {
        const prevSets = [
            { weight: 'BW', reps: 9 },
            { weight: 'BW', reps: 10 },
        ];
        const result = calcProgressionTarget(prevSets, 'BW', 'BW');
        expect(result).not.toBeNull();
        expect(result.weightDisplay).toBe('自重');
        expect(result.unit).toBe('');
        expect(result.reps).toBe(11);
    });
});

describe('calcProgressionTarget: 空・null', () => {
    test('prevSets が null → null', () => {
        expect(calcProgressionTarget(null, 'kg', 'kg')).toBeNull();
    });

    test('prevSets が空配列 → null', () => {
        expect(calcProgressionTarget([], 'kg', 'kg')).toBeNull();
    });

    test('reps が 0 のセットは無視される', () => {
        const prevSets = [{ weight: '80', unit: 'kg', reps: 0 }];
        expect(calcProgressionTarget(prevSets, 'kg', 'kg')).toBeNull();
    });
});
