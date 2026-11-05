/**
 * homeUtils 単体テスト
 *
 * テスト対象:
 *   - getDefaultRecoveryPart (home/homeUtils.js)
 *   - calcMonthlyTrainingDays (home/homeUtils.js)
 */

jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));

import { getDefaultRecoveryPart, calcMonthlyTrainingDays } from '../components/home/homeUtils';

// ── getDefaultRecoveryPart ──────────────────────────────────────────────────

describe('getDefaultRecoveryPart: AI プランの部位が recoveries に存在するとき', () => {
    const recoveries = [
        { part: "背中", status: "good" },
        { part: "胸",   status: "excellent" },
        { part: "肩",   status: "tired" },
    ];

    test('nextPlanDay.bodyParts[0] が recoveries にあれば返す', () => {
        expect(getDefaultRecoveryPart({ bodyParts: ["胸", "肩"] }, recoveries)).toBe("胸");
    });

    test('nextPlanDay.bodyParts[0] が recoveries にあれば recoveries[0] より優先', () => {
        // recoveries[0] は "背中" だが、プランの先頭は "肩"
        expect(getDefaultRecoveryPart({ bodyParts: ["肩"] }, recoveries)).toBe("肩");
    });
});

describe('getDefaultRecoveryPart: AI プランの部位が recoveries にない / プランなし', () => {
    const recoveries = [
        { part: "背中", status: "good" },
        { part: "胸",   status: "excellent" },
    ];

    test('nextPlanDay.bodyParts[0] が recoveries にない → recoveries[0] を返す', () => {
        expect(getDefaultRecoveryPart({ bodyParts: ["腹筋"] }, recoveries)).toBe("背中");
    });

    test('nextPlanDay が null → recoveries[0] を返す', () => {
        expect(getDefaultRecoveryPart(null, recoveries)).toBe("背中");
    });

    test('nextPlanDay が undefined → recoveries[0] を返す', () => {
        expect(getDefaultRecoveryPart(undefined, recoveries)).toBe("背中");
    });

    test('nextPlanDay.bodyParts が空配列 → recoveries[0] を返す', () => {
        expect(getDefaultRecoveryPart({ bodyParts: [] }, recoveries)).toBe("背中");
    });

    test('recoveries が空配列かつプランなし → null を返す', () => {
        expect(getDefaultRecoveryPart(null, [])).toBeNull();
    });
});

// ── calcMonthlyTrainingDays ──────────────────────────────────────────────────

describe('calcMonthlyTrainingDays: 今月・先月の日数カウント', () => {
    // now = 2026-11-15 と仮定
    const now = new Date(2026, 10, 15); // month は 0-indexed

    const sessions = [
        // 今月（2026-11）: 3日
        { date: "2026-11-01" },
        { date: "2026-11-08" },
        { date: "2026-11-15" },
        // 先月（2026-10）同期カットオフ内（≤10-15）: 2日
        { date: "2026-10-10" },
        { date: "2026-10-15" },
        // 先月だがカットオフ超え（10-16以降）: カウントしない
        { date: "2026-10-20" },
        // 2ヶ月前: カウントしない
        { date: "2026-09-05" },
    ];

    test('今月のトレーニング日数は 3', () => {
        expect(calcMonthlyTrainingDays(sessions, now).thisDays).toBe(3);
    });

    test('先月同期カットオフ内のトレーニング日数は 2', () => {
        expect(calcMonthlyTrainingDays(sessions, now).prevDays).toBe(2);
    });

    test('どちらも 0 なら null を返す', () => {
        expect(calcMonthlyTrainingDays([], now)).toBeNull();
    });

    test('今月だけある場合も結果を返す（prevDays=0）', () => {
        const result = calcMonthlyTrainingDays([{ date: "2026-11-01" }], now);
        expect(result).not.toBeNull();
        expect(result.thisDays).toBe(1);
        expect(result.prevDays).toBe(0);
    });

    test('allSessions が null でもクラッシュしない → null', () => {
        expect(calcMonthlyTrainingDays(null, now)).toBeNull();
    });
});

describe('calcMonthlyTrainingDays: 月初（1日）のカットオフ', () => {
    // now = 2026-11-01
    const now = new Date(2026, 10, 1);

    const sessions = [
        { date: "2026-11-01" },
        { date: "2026-10-01" }, // 先月1日 ≤ カットオフ(10-01) → カウント
        { date: "2026-10-02" }, // カットオフ超え → カウントしない
    ];

    test('月初でも先月1日はカウントされる', () => {
        const result = calcMonthlyTrainingDays(sessions, now);
        expect(result.thisDays).toBe(1);
        expect(result.prevDays).toBe(1);
    });
});

describe('calcMonthlyTrainingDays: 1月→前年12月（年をまたぐ）', () => {
    // now = 2027-01-15
    const now = new Date(2027, 0, 15); // month は 0-indexed → 0=1月

    const sessions = [
        // 今月（2027-01）: 2日
        { date: "2027-01-10" },
        { date: "2027-01-15" },
        // 先月（2026-12）同期カットオフ内（≤12-15）: 3日
        { date: "2026-12-01" },
        { date: "2026-12-10" },
        { date: "2026-12-15" },
        // 先月だがカットオフ超え
        { date: "2026-12-20" },
        // 2ヶ月前（2026-11）: カウントしない
        { date: "2026-11-30" },
    ];

    test('prevMonth が前年12月になる（new Date(2027, -1, 1) の折り返し）', () => {
        const result = calcMonthlyTrainingDays(sessions, now);
        expect(result.thisDays).toBe(2);
        expect(result.prevDays).toBe(3);
    });

    test('11月のセッションはカウントされない', () => {
        const result = calcMonthlyTrainingDays(sessions, now);
        expect(result.prevDays).toBe(3); // 12/20 は除外、11/30 は除外
    });
});

describe('calcMonthlyTrainingDays: 先月が31日、今月が30日（今月末が30日の場合）', () => {
    // now = 2026-11-30（11月は30日まで）
    // 今月のカットオフ: 10-30
    // 10月31日 (10-31) > カットオフ(10-30) → カウントしない
    const now = new Date(2026, 10, 30); // 11月30日

    const sessions = [
        { date: "2026-11-30" },
        { date: "2026-10-30" }, // ≤ カットオフ(10-30) → カウント
        { date: "2026-10-31" }, // > カットオフ(10-30) → カウントしない
    ];

    test('10月31日はカットオフ(10-30)を超えるためカウントされない', () => {
        const result = calcMonthlyTrainingDays(sessions, now);
        expect(result.thisDays).toBe(1);
        expect(result.prevDays).toBe(1); // 10-31 はカウントされない
    });
});

describe('calcMonthlyTrainingDays: prevDays が 0 でも null を返さない', () => {
    // 今月は記録があるが先月の同期期間には記録なし → 比較を null にしない
    // now = 2026-11-05 (月初5日間だけが対象になるケース)
    const now = new Date(2026, 10, 5);

    const sessions = [
        { date: "2026-11-01" },
        { date: "2026-11-05" },
        // 2026-10-01〜10-05 には記録なし（10-10 以降のみ）
        { date: "2026-10-10" },
    ];

    test('thisDays=2, prevDays=0 で null ではなく { thisDays: 2, prevDays: 0 } を返す', () => {
        const result = calcMonthlyTrainingDays(sessions, now);
        expect(result).not.toBeNull();
        expect(result.thisDays).toBe(2);
        expect(result.prevDays).toBe(0);
    });
});
