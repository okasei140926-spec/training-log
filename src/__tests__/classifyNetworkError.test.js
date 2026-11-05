/**
 * classifyNetworkError 単体テスト
 *
 * テスト対象: appHelpers.js の classifyNetworkError
 *
 * 分類ルール:
 *   - AbortError / abort / failed to fetch / offline / statement timeout
 *       → "通信環境を確認してください"
 *   - 401 / jwt / unauthorized
 *       → "ログインし直してください"
 *   - その他
 *       → "記録を読み込めませんでした"
 */

jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));

import { classifyNetworkError } from '../utils/appHelpers';

const NETWORK  = "通信環境を確認してください";
const AUTH     = "ログインし直してください";
const GENERIC  = "記録を読み込めませんでした";

// ── AbortError / タイムアウト / オフライン ──────────────────────────────────

describe('classifyNetworkError: ネットワーク・タイムアウト系 → 通信環境', () => {
    test('error.name === "AbortError"', () => {
        const e = new Error("Fetch is aborted");
        e.name = "AbortError";
        expect(classifyNetworkError(e)).toBe(NETWORK);
    });

    test('message に "aborted" を含む', () => {
        expect(classifyNetworkError(new Error("fetch aborted by user"))).toBe(NETWORK);
    });

    test('message に "failed to fetch" を含む（大文字小文字不問）', () => {
        expect(classifyNetworkError(new Error("Failed to fetch"))).toBe(NETWORK);
    });

    test('error.__offlineEarlyExit が true', () => {
        const e = { message: "navigator.onLine is false — network unavailable", __offlineEarlyExit: true };
        expect(classifyNetworkError(e)).toBe(NETWORK);
    });

    test('message に "statement timeout" を含む', () => {
        expect(classifyNetworkError(new Error("statement timeout"))).toBe(NETWORK);
    });

    test('message に "canceling statement" を含む', () => {
        expect(classifyNetworkError(new Error("canceling statement due to conflict"))).toBe(NETWORK);
    });
});

// ── Auth / 401 ──────────────────────────────────────────────────────────────

describe('classifyNetworkError: 認証エラー → ログインし直してください', () => {
    test('error.status === 401', () => {
        const e = Object.assign(new Error("Unauthorized"), { status: 401 });
        expect(classifyNetworkError(e)).toBe(AUTH);
    });

    test('error.statusCode === 401', () => {
        const e = { message: "unauthorized", statusCode: 401 };
        expect(classifyNetworkError(e)).toBe(AUTH);
    });

    test('message に "jwt" を含む', () => {
        expect(classifyNetworkError(new Error("JWT expired"))).toBe(AUTH);
    });

    test('message に "unauthorized" を含む（大文字小文字不問）', () => {
        expect(classifyNetworkError(new Error("User Unauthorized"))).toBe(AUTH);
    });
});

// ── その他 ──────────────────────────────────────────────────────────────────

describe('classifyNetworkError: その他 → 記録を読み込めませんでした', () => {
    test('Supabase 500 エラー', () => {
        const e = Object.assign(new Error("internal server error"), { status: 500 });
        expect(classifyNetworkError(e)).toBe(GENERIC);
    });

    test('不明なエラー文字列', () => {
        expect(classifyNetworkError(new Error("something went wrong"))).toBe(GENERIC);
    });

    test('null を渡す', () => {
        expect(classifyNetworkError(null)).toBe(GENERIC);
    });

    test('undefined を渡す', () => {
        expect(classifyNetworkError(undefined)).toBe(GENERIC);
    });

    test('空オブジェクト', () => {
        expect(classifyNetworkError({})).toBe(GENERIC);
    });
});
