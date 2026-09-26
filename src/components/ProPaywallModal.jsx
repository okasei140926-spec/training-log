import { useEffect, useCallback, useState, useRef } from "react";
import { getRevenueCatPriceString } from "../lib/revenueCat";

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

export function ProPaywallCard({ source = "general", onStartPro, onClose, onRestorePro }) {
    const content = PAYWALL_CONTENT[source] || PAYWALL_CONTENT.general;
    const [restoreBusy, setRestoreBusy] = useState(false);
    const [restoreMsg, setRestoreMsg] = useState("");
    const [priceState, setPriceState] = useState({ price: null, loading: true, error: false });
    const retryTimerRef = useRef(null);
    const retryCountRef = useRef(0);

    const fetchPrice = useCallback(() => {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        setPriceState({ price: null, loading: true, error: false });
        getRevenueCatPriceString()
            .then((price) => {
                retryCountRef.current = 0;
                setPriceState({ price, loading: false, error: false });
            })
            .catch(() => {
                const attempt = retryCountRef.current;
                setPriceState({ price: null, loading: false, error: true });
                // Auto-retry up to 2 times with 6s / 12s delay
                if (attempt < 2) {
                    retryCountRef.current = attempt + 1;
                    const delay = (attempt + 1) * 6000;
                    retryTimerRef.current = setTimeout(() => {
                        fetchPrice();
                    }, delay);
                }
            });
    }, []);

    useEffect(() => {
        retryCountRef.current = 0;
        fetchPrice();
        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        };
    }, [fetchPrice]);

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
            setRestoreMsg("復元に失敗しました。");
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
            {/* 購入ボタン */}
            {priceState.error ? (
                <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.70)", marginBottom: 8 }}>
                        価格を取得できませんでした
                    </div>
                    <button
                        type="button"
                        onClick={() => { retryCountRef.current = 0; fetchPrice(); }}
                        style={{
                            background: "none",
                            border: "1px solid rgba(255,255,255,0.30)",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                            borderRadius: 10,
                            padding: "6px 16px",
                        }}
                    >
                        再試行
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={onStartPro}
                    disabled={priceState.loading}
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
                        opacity: priceState.loading ? 0.6 : 1,
                    }}
                >
                    {priceState.loading
                        ? "価格を取得中..."
                        : `Pump Pro を始める — ${priceState.price}/月`}
                </button>
            )}
            {/* Apple審査必須：自動更新の説明 */}
            {!priceState.loading && !priceState.error && priceState.price && (
                <div style={{ position: "relative", zIndex: 1, fontSize: 11, color: "rgba(255,255,255,0.70)", lineHeight: 1.65, textAlign: "center" }}>
                    {priceState.price}/月で1か月ごとに自動更新。更新日の24時間前までにキャンセルしない限り自動で更新されます。
                    管理・キャンセルは iOS 設定 → Apple ID → サブスクリプションから。
                </div>
            )}
            {/* Apple審査必須：復元ボタン */}
            {onRestorePro && (
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

export function ProPaywallModal({ isOpen, source = "general", onStartPro, onClose, onRestorePro }) {
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
                />
            </div>
        </div>
    );
}
