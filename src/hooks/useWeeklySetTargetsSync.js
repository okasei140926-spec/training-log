import { useCallback, useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";

// デバウンス間隔: 1500ms
// 理由: +/- カウンターは連続タップが多い。1.5s あればひと連続の操作が収まり、
//       かつ設定モーダルを閉じるまでの通常操作時間（数秒）よりは短いため
//       自然にタイマーが発火することも多い。万一タイマーが発火しなくても
//       モーダルの onClose で必ず flush するので変更は失われない。
export const WEEKLY_SET_TARGETS_DEBOUNCE_MS = 1500;

/**
 * weeklySetTargets の変更を Supabase にデバウンス書き込みするフック。
 *
 * - handleSave: React state と localStorage を即時更新し、Supabase 書き込みをデバウンス
 * - flush: 保留中のタイマーをキャンセルし、未送信の変更を即座に Supabase に書き込む
 *
 * flush が走るタイミング:
 *   1. モーダルの onClose（SettingsModal / BottomNav タブ切り替え）
 *   2. visibilitychange イベント（タブが hidden になったとき）
 *   3. pagehide イベント（ブラウザタブ閉鎖・ページ離脱）
 *   4. コンポーネントのアンマウント
 *   5. デバウンスタイマーの自然発火（1500ms 後）
 *
 * ※ Capacitor（iOS）での visibilitychange / pagehide の発火は未確認。
 *    ネイティブのアプリ完全終了ケースは CapacitorApp.appStateChange での対応が別途必要。
 */
export function useWeeklySetTargetsSync({ userId, setWeeklySetTargets }) {
    const timerRef = useRef(null);
    // null: 保留なし / それ以外: 未送信の最新値
    const pendingRef = useRef(null);

    const flush = useCallback(async () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const pending = pendingRef.current;
        if (pending === null || !userId) return;
        pendingRef.current = null;
        const { error, count } = await supabase
            .from("profiles")
            .update({ weekly_set_targets: pending }, { count: "exact" })
            .eq("id", userId);
        if (error) {
            console.error("[weeklySetTargets] Supabase update failed:", error?.message, error);
        } else if (count === 0) {
            console.error("[weeklySetTargets] profiles row not found — update wrote 0 rows", { userId });
        }
    }, [userId]);

    const handleSave = useCallback((newTargets) => {
        setWeeklySetTargets(newTargets);
        pendingRef.current = newTargets;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, WEEKLY_SET_TARGETS_DEBOUNCE_MS);
    }, [setWeeklySetTargets, flush]);

    // ブラウザタブ非表示・ページ離脱・アンマウント時に保留中の変更を即送信する。
    // デバウンスタイマーが発火する前にページが閉じられた場合の取りこぼしを防ぐ。
    // Capacitor（iOS）での visibilitychange / pagehide の発火は未確認。
    useEffect(() => {
        const onHidden = () => {
            if (document.visibilityState === "hidden") flush();
        };
        const onPageHide = () => { flush(); };

        document.addEventListener("visibilitychange", onHidden);
        window.addEventListener("pagehide", onPageHide);

        return () => {
            document.removeEventListener("visibilitychange", onHidden);
            window.removeEventListener("pagehide", onPageHide);
            flush();
        };
    }, [flush]);

    return { handleSave, flush };
}
