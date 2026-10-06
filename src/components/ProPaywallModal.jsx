import { useEffect, useCallback, useState, useRef } from "react";
import { getRevenueCatAvailability, getRevenueCatPriceString } from "../lib/revenueCat";

export const PAYWALL_CONTENT = {
    ai_limit: {
        headline: "AI Coachをもっと使う",
        subheadline: "無料相談は本日分を使い切りました。Pump Proでできること：",
    },
    stagnation: {
        headline: "伸び悩みの原因を、AIが診断",
        subheadline: "止まってる種目の「なぜ？」を、記録からAIが解明します",
    },
    general: {
        headline: "記録から、次の一手まで。",
        subheadline: "Pump Proでできること：",
    },
};

const PRO_FEATURES = [
    { text: "AI Coach を何度でも相談できる", sub: "1日5回の制限なし" },
    { text: "AIが全期間のデータで分析・提案", sub: "長期トレンドをもとにした的確なアドバイス" },
    { text: "伸び悩む種目の原因をAIが診断", sub: "「なぜ伸びない？」で記録を深掘り" },
];

// Per-call timeouts and absolute deadlines for auto vs manual-retry paths.
// Auto: extended to 20 s total to survive Apple sandbox latency (App Store review).
// Manual: extended to 30 s since the user explicitly asked to retry.
const TIMEOUT_AUTO = 10000;
const TIMEOUT_MANUAL = 15000;
const DEADLINE_AUTO = 20000;
const DEADLINE_MANUAL = 30000;

export function ProPaywallCard({ source = "general", onStartPro, onClose, onRestorePro, isPro = false }) {
    const content = PAYWALL_CONTENT[source] || PAYWALL_CONTENT.general;
    const [restoreBusy, setRestoreBusy] = useState(false);
    const [restoreMsg, setRestoreMsg] = useState("");
    // retrying: true while the second (and final) automatic attempt is in flight
    const [priceState, setPriceState] = useState({ price: null, loading: true, error: false, offline: false, retrying: false });
    const retryCountRef = useRef(0);
    const deadlineTimerRef = useRef(null);
    const openedAtRef = useRef(Date.now());

    // Purchase UI state machine.
    // ui: "idle" | "purchasing" | "verifying" | "succeeded" | "failed"
    // (cancelled silently resets to "idle" — nothing shown)
    const [purchaseUI, setPurchaseUI] = useState({ ui: "idle", reason: null });
    const purchasedAtRef = useRef(null);
    const verifyTimerRef = useRef(null);

    const logPaywallState = useCallback((state, extra = {}) => {
        const elapsedMs = openedAtRef.current != null ? Date.now() - openedAtRef.current : null;
        console.log("[WP] paywall:state", {
            state,
            elapsedMs,
            packageId: extra.packageId ?? null,
            errorCode: extra.errorCode ?? null,
            errorMessage: extra.errorMessage ?? null,
            isSandbox: extra.isSandbox ?? null,
        });
    }, []);

    // Logs UI-visible state transitions from the moment the user pressed the purchase button.
    const logPurchaseUI = useCallback((ui, reason = null) => {
        const elapsedMs = purchasedAtRef.current != null ? Date.now() - purchasedAtRef.current : null;
        console.log("[WP] paywall:ui", {
            ui,
            elapsedMs,
            reason: reason ?? null,
        });
    }, []);

    // Check once on mount whether the billing SDK is available on this platform.
    const isUnavailable = !getRevenueCatAvailability().native;

    // Start (or restart) the absolute deadline.
    // If the price has not been fetched successfully by the time it fires,
    // force-transition to error so the UI never shows "loading" beyond the deadline.
    const startDeadline = useCallback((deadlineMs) => {
        if (deadlineTimerRef.current) clearTimeout(deadlineTimerRef.current);
        deadlineTimerRef.current = setTimeout(() => {
            deadlineTimerRef.current = null;
            setPriceState((prev) => {
                if (!prev.loading) return prev; // already resolved — no-op
                const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
                logPaywallState("timeout", { errorMessage: isOffline ? "offline" : "deadline exceeded" });
                return { price: null, loading: false, error: true, offline: isOffline, retrying: false };
            });
        }, deadlineMs);
    }, [logPaywallState]);

    // timeoutMs is passed through to getRevenueCatPriceString so the auto and
    // manual-retry paths use different per-call timeouts.
    const fetchPrice = useCallback((opts = {}) => {
        const { isRetry = false, timeoutMs = TIMEOUT_AUTO } = opts;
        logPaywallState("fetching-offerings");
        setPriceState({ price: null, loading: true, error: false, offline: false, retrying: isRetry });
        getRevenueCatPriceString(timeoutMs)
            .then((price) => {
                // Success may arrive after the deadline fired — that's fine, show the price.
                retryCountRef.current = 0;
                if (price) {
                    logPaywallState("offerings-loaded");
                } else {
                    logPaywallState("offerings-empty");
                }
                setPriceState({ price, loading: false, error: false, offline: false, retrying: false });
            })
            .catch((err) => {
                const attempt = retryCountRef.current;
                const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
                if (attempt < 1) {
                    // One immediate retry with the same timeout — no delay, no loading flash.
                    retryCountRef.current = attempt + 1;
                    fetchPrice({ isRetry: true, timeoutMs });
                } else {
                    // Both attempts failed — show error; user can still press "再試行".
                    logPaywallState("offerings-error", {
                        errorCode: err?.code ?? null,
                        errorMessage: err?.message ?? String(err ?? "unknown"),
                    });
                    setPriceState({ price: null, loading: false, error: true, offline: isOffline, retrying: false });
                }
            });
    }, [logPaywallState]);

    useEffect(() => {
        // Skip price fetch on non-native platforms (web browser, simulator without StoreKit).
        if (isUnavailable) return undefined;
        openedAtRef.current = Date.now();
        logPaywallState("opened");
        retryCountRef.current = 0;
        startDeadline(DEADLINE_AUTO);
        fetchPrice({ timeoutMs: TIMEOUT_AUTO });
        return () => {
            if (deadlineTimerRef.current) clearTimeout(deadlineTimerRef.current);
        };
    }, [fetchPrice, isUnavailable, logPaywallState, startDeadline]);

    // Manual retry: reset deadline to the longer window so the user gets a fresh chance.
    const handleManualRetry = useCallback(() => {
        logPaywallState("retry");
        retryCountRef.current = 0;
        startDeadline(DEADLINE_MANUAL);
        fetchPrice({ timeoutMs: TIMEOUT_MANUAL });
    }, [fetchPrice, logPaywallState, startDeadline]);

    // Watch isPro while in "verifying" state.
    // RC's customerInfoUpdateListener fires asynchronously after a successful purchase;
    // when it does, isPro flips true and we can confirm success.
    useEffect(() => {
        if (purchaseUI.ui !== "verifying") return undefined;
        if (isPro) {
            logPurchaseUI("succeeded");
            setPurchaseUI({ ui: "succeeded", reason: null });
            const t = setTimeout(() => onClose?.(), 1500);
            return () => clearTimeout(t);
        }
        // 10-second hard timeout — if entitlement still not reflected, show error guidance.
        if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
        verifyTimerRef.current = setTimeout(() => {
            verifyTimerRef.current = null;
            logPurchaseUI("failed", "verifying-timeout");
            setPurchaseUI({ ui: "failed", reason: "verifying-timeout" });
        }, 10000);
        return () => {
            if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [purchaseUI.ui, isPro]);

    const handleStartPro = useCallback(async () => {
        if (purchaseUI.ui === "purchasing" || purchaseUI.ui === "verifying") return;
        purchasedAtRef.current = Date.now();
        logPurchaseUI("purchasing");
        setPurchaseUI({ ui: "purchasing", reason: null });
        try {
            const result = await onStartPro?.();
            const outcome = result?.outcome ?? (result === true ? "succeeded" : "failed");
            if (outcome === "succeeded") {
                logPurchaseUI("succeeded");
                setPurchaseUI({ ui: "succeeded", reason: null });
                setTimeout(() => onClose?.(), 1500);
            } else if (outcome === "verifying") {
                logPurchaseUI("verifying");
                setPurchaseUI({ ui: "verifying", reason: null });
                // Actual success/failure will be resolved by the isPro useEffect above.
            } else if (outcome === "cancelled") {
                logPurchaseUI("cancelled");
                setPurchaseUI({ ui: "idle", reason: null });
            } else {
                const reason = result?.reason ?? "unknown";
                logPurchaseUI("failed", reason);
                setPurchaseUI({ ui: "failed", reason });
            }
        } catch (err) {
            logPurchaseUI("failed", "exception");
            setPurchaseUI({ ui: "failed", reason: "exception" });
        }
    }, [purchaseUI.ui, onStartPro, onClose, logPurchaseUI]);

    const handleRestore = async () => {
        if (!onRestorePro || restoreBusy) return;
        setRestoreBusy(true);
        setRestoreMsg("");
        try {
            const result = await onRestorePro();
            if (result?.plan?.isPro) {
                setRestoreMsg("購入を復元しました。");
            } else {
                setRestoreMsg("復元できる購入が見つかりませんでした。");
            }
        } catch {
            setRestoreMsg("購入の復元を確認できませんでした。");
        } finally {
            setRestoreBusy(false);
        }
    };

    return (
        <div
            style={{
                position: "relative",
                overflow: "hidden",
                width: "100%",
                maxWidth: 620,
                margin: "4px auto 0",
                boxSizing: "border-box",
                padding: "20px 18px 16px",
                borderRadius: 22,
                background:
                    "radial-gradient(circle at 82% 10%, rgba(51, 225, 219, 0.28), transparent 34%), linear-gradient(145deg, rgba(8, 28, 32, 0.97), rgba(13, 63, 68, 0.94) 52%, rgba(18, 199, 194, 0.18))",
                border: "1px solid rgba(51, 225, 219, 0.28)",
                color: "var(--text)",
                boxShadow: "0 18px 38px rgba(15, 94, 99, 0.20)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
            }}
        >
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.06), transparent 40%)", pointerEvents: "none" }} />
            {/* 閉じるボタン */}
            <button
                type="button"
                aria-label="Pro案内を閉じる"
                onClick={onClose}
                style={{
                    position: "absolute",
                    zIndex: 2,
                    top: 12,
                    right: 12,
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(8, 28, 32, 0.50)",
                    color: "rgba(255,255,255,0.72)",
                    fontSize: 18,
                    lineHeight: 1,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                ×
            </button>
            {/* ヘッダー */}
            <div style={{ position: "relative", zIndex: 1, paddingRight: 34 }}>
                <div
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 9px",
                        borderRadius: 999,
                        background: "rgba(51, 225, 219, 0.14)",
                        border: "1px solid rgba(51, 225, 219, 0.26)",
                        color: "#A7FFFB",
                        fontSize: 10,
                        fontWeight: 900,
                        letterSpacing: 1.2,
                        marginBottom: 10,
                    }}
                >
                    PUMP PRO
                </div>
                <div style={{ fontSize: 20, fontWeight: 950, color: "#FFFFFF", lineHeight: 1.15, marginBottom: 6 }}>
                    {content.headline}
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.82)", lineHeight: 1.6 }}>
                    {content.subheadline}
                </div>
            </div>
            {/* 特典リスト */}
            <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                {PRO_FEATURES.map(({ text, sub }) => (
                    <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span style={{ color: "#33E1DB", fontSize: 14, fontWeight: 900, lineHeight: 1.5, flexShrink: 0 }}>✓</span>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.4 }}>{text}</div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.68)", lineHeight: 1.4 }}>{sub}</div>
                        </div>
                    </div>
                ))}
            </div>
            {/* 購入ボタン・購入結果フィードバック */}
            {isUnavailable ? (
                <div style={{ position: "relative", zIndex: 1, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.68)", lineHeight: 1.7, padding: "4px 8px" }}>
                    このデバイスでは購入手続きができません。<br />
                    iOS アプリからご購入いただけます。
                </div>
            ) : purchaseUI.ui === "succeeded" ? (
                /* (a) 購入成功・権限反映済み */
                <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "12px 0" }}>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#33E1DB" }}>
                        Pump Pro が有効になりました
                    </div>
                </div>
            ) : purchaseUI.ui === "verifying" ? (
                /* (b) 購入成功・権限反映待ち */
                <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "8px 0" }}>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.80)", marginBottom: 4 }}>
                        購入を確認しています...
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.52)" }}>
                        しばらくお待ちください
                    </div>
                </div>
            ) : purchaseUI.ui === "failed" ? (
                /* (d) 購入失敗（キャンセル以外） */
                <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginBottom: 8, lineHeight: 1.6 }}>
                        {purchaseUI.reason === "verifying-timeout"
                            ? "購入の反映に時間がかかっています。「購入を復元」をお試しください。"
                            : "購入手続きを完了できませんでした。もう一度お試しください。"}
                    </div>
                    <button
                        type="button"
                        onClick={() => setPurchaseUI({ ui: "idle", reason: null })}
                        style={{
                            background: "none",
                            border: "1px solid rgba(255,255,255,0.30)",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                            borderRadius: 10,
                            padding: "6px 16px",
                            cursor: "pointer",
                        }}
                    >
                        もう一度試す
                    </button>
                </div>
            ) : priceState.error ? (
                /* 価格取得エラー */
                <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.70)", marginBottom: 8 }}>
                        {priceState.offline
                            ? "オフラインのため読み込みできません。接続を確認して再試行してください。"
                            : "価格の読み込みに時間がかかっています。しばらくしてから再試行してください。"}
                    </div>
                    <button
                        type="button"
                        onClick={handleManualRetry}
                        style={{
                            background: "none",
                            border: "1px solid rgba(255,255,255,0.30)",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                            borderRadius: 10,
                            padding: "6px 16px",
                            cursor: "pointer",
                        }}
                    >
                        再試行
                    </button>
                </div>
            ) : (
                /* idle / purchasing: 通常の購入ボタン */
                <>
                    {priceState.loading && priceState.offline && (
                        <div style={{ position: "relative", zIndex: 1, textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.58)" }}>
                            オフラインです。接続を確認しています...
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={handleStartPro}
                        disabled={priceState.loading || purchaseUI.ui === "purchasing"}
                        className="pressable"
                        style={{
                            position: "relative",
                            zIndex: 1,
                            width: "100%",
                            padding: "14px 14px",
                            borderRadius: 18,
                            border: "none",
                            background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                            color: "#fff",
                            fontSize: 15,
                            fontWeight: 900,
                            boxShadow: "0 14px 26px rgba(18, 199, 194, 0.26)",
                            opacity: (priceState.loading || purchaseUI.ui === "purchasing") ? 0.6 : 1,
                        }}
                    >
                        {purchaseUI.ui === "purchasing"
                            ? "処理中..."
                            : priceState.loading
                                ? (priceState.retrying ? "価格情報を再取得しています..." : "価格を取得中...")
                                : `Pump Pro を始める — ${priceState.price}/月`}
                    </button>
                </>
            )}
            {/* Apple審査必須：自動更新の説明 */}
            {!priceState.loading && !priceState.error && priceState.price && (
                <div style={{ position: "relative", zIndex: 1, fontSize: 11, color: "rgba(255,255,255,0.70)", lineHeight: 1.65, textAlign: "center" }}>
                    {priceState.price}/月で1か月ごとに自動更新。更新日の24時間前までにキャンセルしない限り自動で更新されます。
                    管理・キャンセルは iOS 設定 → Apple ID → サブスクリプションから。
                </div>
            )}
            {/* Apple審査必須：復元ボタン（非ネイティブでは表示しない） */}
            {!isUnavailable && onRestorePro && (
                <button
                    type="button"
                    onClick={handleRestore}
                    disabled={restoreBusy}
                    style={{
                        position: "relative",
                        zIndex: 1,
                        background: "none",
                        border: "none",
                        color: "rgba(255,255,255,0.68)",
                        fontSize: 12,
                        fontWeight: 700,
                        textDecoration: "underline",
                        opacity: restoreBusy ? 0.5 : 1,
                    }}
                >
                    {restoreBusy ? "復元中..." : "購入を復元"}
                </button>
            )}
            {restoreMsg ? (
                <div style={{ position: "relative", zIndex: 1, fontSize: 11, color: "rgba(255,255,255,0.75)", textAlign: "center" }}>
                    {restoreMsg}
                </div>
            ) : null}
            {/* Apple審査必須：利用規約・プライバシーポリシーリンク */}
            <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
                <a
                    href="https://training-log-mu.vercel.app/privacy.html#利用規約"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 10, color: "rgba(255,255,255,0.52)", textDecoration: "underline" }}
                >
                    利用規約
                </a>
                <a
                    href="https://training-log-mu.vercel.app/privacy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 10, color: "rgba(255,255,255,0.52)", textDecoration: "underline" }}
                >
                    プライバシーポリシー
                </a>
            </div>
        </div>
    );
}

export function ProPaywallModal({ isOpen, source = "general", onStartPro, onClose, onRestorePro, isPro = false }) {
    if (!isOpen) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 900,
                background: "rgba(5, 16, 18, 0.54)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "calc(18px + var(--safe-top)) 16px calc(18px + var(--safe-bottom))",
                boxSizing: "border-box",
            }}
        >
            <div
                onClick={(event) => event.stopPropagation()}
                style={{
                    width: "min(620px, 100%)",
                    maxHeight: "calc(100svh - var(--safe-top) - var(--safe-bottom) - 36px)",
                    overflowY: "auto",
                    WebkitOverflowScrolling: "touch",
                    borderRadius: 24,
                }}
            >
                <ProPaywallCard
                    source={source}
                    onStartPro={onStartPro}
                    onClose={onClose}
                    onRestorePro={onRestorePro}
                    isPro={isPro}
                />
            </div>
        </div>
    );
}
