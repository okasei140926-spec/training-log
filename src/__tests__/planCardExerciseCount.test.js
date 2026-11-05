/**
 * HomeScreen プランカードの種目数表示: 同一計算経路の検証
 *
 * 修正内容:
 *   HomeScreen は muscleEx[bp].length の合計（全候補数）を表示していた。
 *   buildSessionExercisesForPlanDay の戻り値件数（実際に生成される種目数）に修正した。
 *
 * このテストが検証すること:
 *   1. buildSessionExercisesForPlanDay が SESSION_COUNT[level] に従い種目数を制限する
 *   2. muscleEx ベースの旧計算は生成種目数と一致しない（旧実装が誤っていた証明）
 *   3. HomeScreen が nextPlanDayExerciseCount prop の値をカードに表示する
 *      （prop を無視して muscleEx ベースに戻すと "11種目" が表示されテストが FAIL する）
 *
 * 修正箇所を潰す手順（mutation test）:
 *   HomeScreen.jsx の `const exCount = nextPlanDayExerciseCount;` を
 *   `const exCount = (nextPlanDay.bodyParts||[]).reduce((s,bp) => s+(muscleEx?.[bp]?.length||0), 0);`
 *   に戻すと test 3 が FAIL する。
 */

jest.mock('../context/UserSettingsContext', () => ({
    useUserSettings: () => ({ bodyWeightKg: null }),
}));

jest.mock('../components/home/homeUtils', () => ({
    DEFAULT_PARTS: [],
    WEEKLY_CONSISTENCY_DATES: [],
    RECOVERY_META: {},
    getPerfNow: () => 0,
    shouldLogHomePerfDebug: () => false,
    formatDate: (d) => d,
    getWeekRange: () => ({ label: '', start: '', end: '' }),
    calcRecovery: () => ({ fatigue: 0, readiness: 0 }),
    collectRecentSessions: () => [],
    collectWeeklySets: () => ({}),
    collectWeeklyAggregationDebug: () => ({}),
    collectWeeklySetsFromSessions: () => ({}),
    collectWeeklyPartDetailFromSessions: () => ({}),
    collectPartDetail: () => ({}),
    summarizeSessionsByDate: () => ({}),
    summarizeExercisesForDates: () => ({}),
    sumBodyPartCounts: () => ({}),
    getRegressedBodyParts: () => [],
    bodyPartCountsSignature: () => '',
    getDefaultRecoveryPart: () => null,
    calcMonthlyTrainingDays: () => 0,
}));

jest.mock('../components/home/WeeklyTrainingModal', () => () => null);
jest.mock('../components/home/RecoveryModal', () => () => null);
jest.mock('../components/home/SessionModal', () => () => null);

jest.mock('../utils/helpers', () => ({
    sanitizeHistoryRecord: (r) => r,
}));

import React from 'react';
import { render, screen } from '@testing-library/react';
import HomeScreen from '../components/HomeScreen';
import { buildSessionExercisesForPlanDay } from '../utils/generateOnboardingPlan';

// ジムテンプレートの実際の種目数: 胸=4, 肩=4, 三頭=3 → 合計11
const MOCK_MUSCLE_EX = {
    '胸': Array(4).fill({ name: 'dummy' }),
    '肩': Array(4).fill({ name: 'dummy' }),
    '三頭': Array(3).fill({ name: 'dummy' }),
};

const PUSH_PARTS = ['胸', '肩', '三頭'];
const BASE_ANSWERS = {
    level: '中級者', favorites: [], preferredSplit: 'ppl', frequency: 3, location: 'ジム',
};

// ─────────────────────────────────────────────────────────────
// 1. buildSessionExercisesForPlanDay が SESSION_COUNT を守る
// ─────────────────────────────────────────────────────────────

describe('planCardExerciseCount: buildSessionExercisesForPlanDay の出力が表示値の源泉', () => {
    test('中級者 Push: 戻り値は 5 種目（SESSION_COUNT[中級者]）', () => {
        const exercises = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: BASE_ANSWERS,
            history: {},
        });
        expect(exercises.length).toBe(5);
    });

    test('muscleEx ベース計算は 11 になり生成種目数と一致しない（旧実装が誤っていた証明）', () => {
        const oldCount = PUSH_PARTS.reduce(
            (sum, bp) => sum + (MOCK_MUSCLE_EX[bp]?.length || 0), 0
        );
        const exercises = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: BASE_ANSWERS,
            history: {},
        });
        expect(oldCount).toBe(11);
        expect(exercises.length).toBe(5);
        expect(oldCount).not.toBe(exercises.length);
    });
});

// ─────────────────────────────────────────────────────────────
// 2. HomeScreen が nextPlanDayExerciseCount prop を表示に使う
//    （muscleEx ベースに戻すと "11種目" になり FAIL する）
// ─────────────────────────────────────────────────────────────

const MINIMAL_PROPS = {
    history: {},
    muscleEx: MOCK_MUSCLE_EX,
    exerciseBodyPartOverrides: {},
    hiddenBodyParts: [],
    onStartLog: () => {},
    user: { id: 'test-user' },
    aiPlanEnabled: true,
    isTodayCompleted: false,
    onStartNextPlanDay: () => {},
    nextPlanDay: { bodyParts: PUSH_PARTS, label: 'Push Day' },
};

describe('planCardExerciseCount: HomeScreen カードの種目数表示', () => {
    test('nextPlanDayExerciseCount=5 を渡すと "5種目" が表示される', () => {
        render(<HomeScreen {...MINIMAL_PROPS} nextPlanDayExerciseCount={5} />);
        expect(screen.getByText('5種目')).toBeInTheDocument();
    });

    test('nextPlanDayExerciseCount=5 のとき "11種目" は表示されない', () => {
        render(<HomeScreen {...MINIMAL_PROPS} nextPlanDayExerciseCount={5} />);
        expect(screen.queryByText('11種目')).not.toBeInTheDocument();
    });
});
