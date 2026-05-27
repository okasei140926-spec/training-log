import { useCallback, useEffect, useRef, useState } from "react";
import NotificationSettings from "../NotificationSettings";

const isDevelopmentBuild = process.env.NODE_ENV !== "production";

const formatPlanDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const openNativeSubscriptionSettings = () => {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  const url = /Android/i.test(userAgent)
    ? "https://play.google.com/store/account/subscriptions"
    : "https://apps.apple.com/account/subscriptions";
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
};

const isNativePurchaseEnvironment = () => {
  if (typeof window === "undefined") return false;
  return window.location?.protocol === "capacitor:";
};

export default function SettingsModal({
  isOpen,
  onClose,
  user,
  onLogout,
  onExportData,
  onDeleteAccount,
  accountActionBusy = false,
  isPro = false,
  proPlan = null,
  onStartPro,
  onRestorePro,
  onDeactivateProDev,
  onRefreshProStatus,
  dailyFreeAiLimit = 5,
  aiUsageCount = 0,
}) {
  const scrollLockRef = useRef({ top: 0, body: {}, html: {} });
  const [showProManager, setShowProManager] = useState(false);
  const [proStatusData, setProStatusData] = useState(null);
  const [proActionBusy, setProActionBusy] = useState(false);
  const [proMessage, setProMessage] = useState("");

  const plan = proStatusData?.plan || proPlan || {
    isPro,
    status: isPro ? "pro" : "free",
    label: isPro ? "Pro" : "Free",
    renewalStopped: false,
    expiresAt: null,
  };
  const planStatus = plan.status || (plan.isPro ? "pro" : "free");
  const planLabel =
    planStatus === "canceled_active"
      ? "Pro（解約済み・期限内）"
      : plan.isPro
        ? "Pro"
        : "Free";
  const usageText = plan.isPro
    ? "AI相談 無制限"
    : `AI相談 1日${dailyFreeAiLimit}回まで`;
  const usageCountText = plan.isPro
    ? "Pro 無制限"
    : `${Math.min(Number(aiUsageCount) || 0, dailyFreeAiLimit)}/${dailyFreeAiLimit}`;

  const refreshProStatus = useCallback(async ({ silent = false } = {}) => {
    if (!onRefreshProStatus) return null;
    if (!silent) {
      setProActionBusy(true);
      setProMessage("");
    }
    try {
      const data = await onRefreshProStatus();
      if (data?.plan) {
        setProStatusData(data);
        if (!silent) setProMessage("購入状態を確認しました。");
      } else if (!silent) {
        setProMessage("購入状態を確認できませんでした。");
      }
      return data;
    } finally {
      if (!silent) setProActionBusy(false);
    }
  }, [onRefreshProStatus]);

  const restoreProStatus = useCallback(async () => {
    const handler = onRestorePro || onRefreshProStatus;
    if (!handler) return null;
    setProActionBusy(true);
    setProMessage("");
    try {
      const data = await handler();
      if (data?.plan) {
        setProStatusData(data);
        setProMessage(data.plan.isPro ? "購入を復元しました。" : "復元できるPro購入は見つかりませんでした。");
      } else {
        setProMessage("購入を復元できませんでした。");
      }
      return data;
    } finally {
      setProActionBusy(false);
    }
  }, [onRefreshProStatus, onRestorePro]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const body = document.body;
    const html = document.documentElement;
    const scrollTop = window.scrollY || window.pageYOffset || 0;
    const scrollLock = scrollLockRef.current;

    scrollLock.top = scrollTop;
    scrollLock.body = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      touchAction: body.style.touchAction,
    };
    scrollLock.html = {
      overflow: html.style.overflow,
      overscrollBehavior: html.style.overscrollBehavior,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollTop}px`;
    body.style.width = "100%";
    body.style.touchAction = "none";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = scrollLock.body.overflow || "";
      body.style.position = scrollLock.body.position || "";
      body.style.top = scrollLock.body.top || "";
      body.style.width = scrollLock.body.width || "";
      body.style.touchAction = scrollLock.body.touchAction || "";
      html.style.overflow = scrollLock.html.overflow || "";
      html.style.overscrollBehavior = scrollLock.html.overscrollBehavior || "";
      window.scrollTo(0, scrollLock.top || 0);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setShowProManager(false);
      setProMessage("");
      return;
    }
    if (showProManager) refreshProStatus({ silent: true });
  }, [isOpen, showProManager, refreshProStatus]);

  if (!isOpen) return null;

  const handleDevTogglePro = async (nextIsPro) => {
    if (!isDevelopmentBuild) return;
    setProActionBusy(true);
    setProMessage("");
    try {
      const ok = nextIsPro ? await onStartPro?.() : await onDeactivateProDev?.();
      if (!ok) {
        setProMessage("開発用Pro状態の更新に失敗しました。");
        return;
      }
      const data = await onRefreshProStatus?.();
      if (data?.plan) setProStatusData(data);
      setProMessage(nextIsPro ? "開発用ProをONにしました。" : "開発用ProをOFFにしました。");
    } finally {
      setProActionBusy(false);
    }
  };

  const handleUpgrade = async () => {
    setProActionBusy(true);
    setProMessage("");
    try {
      const ok = await onStartPro?.();
      const data = await onRefreshProStatus?.();
      if (data?.plan) setProStatusData(data);
      if (ok) {
        setProMessage("Pump Proを有効化しました。");
        return;
      }
      if (!isNativePurchaseEnvironment()) {
        setProMessage("Pump ProはiOSアプリ版で購入できます。Web/PWAでは購入できない場合があります。");
        return;
      }
      if (isDevelopmentBuild) {
        setProMessage("RevenueCat購入を開始できませんでした。開発用切り替えも利用できます。");
      } else {
        setProMessage("購入を完了できませんでした。キャンセルされた場合、課金は発生していません。");
      }
    } finally {
      setProActionBusy(false);
    }
  };

  const handleManageSubscription = () => {
    const managementURL = plan.managementURL || plan.managementUrl;
    if (managementURL) {
      const opened = window.open(managementURL, "_blank", "noopener,noreferrer");
      if (!opened) window.location.assign(managementURL);
      return;
    }
    openNativeSubscriptionSettings();
  };

  const proPlanManager = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <button
        type="button"
        onClick={() => {
          setShowProManager(false);
          setProMessage("");
        }}
        style={{
          alignSelf: "flex-start",
          background: "var(--card2)",
          border: "1px solid var(--border2)",
          color: "var(--text2)",
          borderRadius: 999,
          padding: "8px 12px",
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        ← 設定へ戻る
      </button>

      <div
        style={{
          background: "linear-gradient(145deg, rgba(18,199,194,0.14), var(--card) 52%, var(--card2))",
          borderRadius: 22,
          padding: 18,
          border: "1px solid rgba(18, 199, 194, 0.22)",
          boxShadow: "var(--shadow-card)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 900, letterSpacing: 1.8 }}>
              PUMP PRO
            </div>
            <div style={{ fontSize: 22, color: "var(--text)", fontWeight: 950, marginTop: 4 }}>
              現在のプラン：{planLabel}
            </div>
          </div>
          <div
            style={{
              borderRadius: 999,
              padding: "8px 11px",
              background: plan.isPro ? "rgba(18,199,194,0.16)" : "var(--card2)",
              border: "1px solid rgba(18,199,194,0.22)",
              color: plan.isPro ? "var(--accent)" : "var(--text2)",
              fontSize: 12,
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            {usageCountText}
          </div>
        </div>

        <div style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.75 }}>
          {planStatus === "canceled_active"
            ? "Proは有効期限まで利用可能です。更新は停止されています。"
            : plan.isPro
              ? "Pump Proが有効です。AI Coachを回数制限なしで利用できます。"
              : `FreeプランではAI Coachを1日${dailyFreeAiLimit}回まで利用できます。ProにするとAI Coachを無制限で使えます。`}
        </div>

        {plan.expiresAt && (
          <div style={{ color: "var(--text3)", fontSize: 12, fontWeight: 800 }}>
            有効期限：{formatPlanDate(plan.expiresAt)}
          </div>
        )}

        <div
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--border2)",
            borderRadius: 16,
            padding: 14,
            display: "grid",
            gap: 10,
          }}
        >
          {["AI Coach無制限", "メニュー提案", "重量設定の相談", "記録分析", "弱点部位の改善提案"].map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text)", fontSize: 13, fontWeight: 800 }}>
              <span style={{ color: "var(--accent)", fontWeight: 950 }}>✓</span>
              {item}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!plan.isPro && (
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={proActionBusy}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 16,
                background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                color: "#fff",
                fontSize: 14,
                fontWeight: 950,
                opacity: proActionBusy ? 0.7 : 1,
                boxShadow: "var(--shadow-soft)",
              }}
            >
              Proにアップグレード
            </button>
          )}

          {plan.isPro && (
            <button
              type="button"
              onClick={handleManageSubscription}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 16,
                background: "var(--card2)",
                border: "1px solid var(--border2)",
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 900,
              }}
            >
              サブスクリプションを管理
            </button>
          )}

          <button
            type="button"
            onClick={restoreProStatus}
            disabled={proActionBusy}
            style={{
              width: "100%",
              padding: "13px 16px",
              borderRadius: 16,
              background: "var(--card)",
              border: "1px solid var(--border2)",
              color: "var(--text)",
              fontSize: 14,
              fontWeight: 900,
              opacity: proActionBusy ? 0.65 : 1,
            }}
          >
            購入を復元
          </button>
        </div>

        {isDevelopmentBuild && (
          <div
            style={{
              borderRadius: 16,
              padding: 12,
              border: "1px dashed rgba(18,199,194,0.28)",
              background: "rgba(18,199,194,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 9,
            }}
          >
            <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 900 }}>
              開発用Pro切り替え
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => handleDevTogglePro(true)}
                disabled={proActionBusy}
                style={{
                  padding: "11px 12px",
                  borderRadius: 14,
                  background: plan.isPro ? "linear-gradient(135deg, var(--accent), var(--accent2))" : "var(--card)",
                  color: plan.isPro ? "#fff" : "var(--text)",
                  border: "1px solid var(--border2)",
                  fontWeight: 900,
                }}
              >
                Pro ON
              </button>
              <button
                type="button"
                onClick={() => handleDevTogglePro(false)}
                disabled={proActionBusy}
                style={{
                  padding: "11px 12px",
                  borderRadius: 14,
                  background: !plan.isPro ? "var(--card2)" : "var(--card)",
                  color: "var(--text)",
                  border: "1px solid var(--border2)",
                  fontWeight: 900,
                }}
              >
                Pro OFF
              </button>
            </div>
          </div>
        )}

        {proMessage && (
          <div style={{ color: "var(--text2)", fontSize: 12, lineHeight: 1.6 }}>
            {proMessage}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(15, 23, 42, 0.44)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "calc(16px + var(--safe-top, 0px)) 12px calc(12px + var(--safe-bottom, 0px))",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--card-modal)",
          borderRadius: 28,
          border: "1px solid rgba(18, 199, 194, 0.12)",
          boxShadow: "0 22px 44px rgba(15, 23, 42, 0.16)",
          maxHeight: "calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 28px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            padding: "18px 16px calc(22px + var(--safe-bottom, 0px))",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: 44,
              height: 5,
              borderRadius: 999,
              background: "var(--border2)",
              margin: "0 auto 14px",
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.2 }}>
              {showProManager ? "Proプラン管理" : "設定"}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text3)",
                fontSize: 28,
                lineHeight: 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {showProManager ? proPlanManager : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
                通知
              </div>
              <NotificationSettings user={user} />
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
                Pro
              </div>
              <button
                type="button"
                onClick={() => setShowProManager(true)}
                style={{
                  width: "100%",
                  background: "var(--card)",
                  borderRadius: 20,
                  padding: 16,
                  border: "1px solid var(--border2)",
                  boxShadow: "var(--shadow-card)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  textAlign: "left",
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 950, color: "var(--text)", marginBottom: 5 }}>
                    Proプラン管理
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6 }}>
                    現在のプラン：{isPro ? "Pro" : "Free"} / {usageText}
                  </div>
                </div>
                <div style={{ color: "var(--text3)", fontSize: 22, fontWeight: 900 }}>›</div>
              </button>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
                データ
              </div>
              <div
                style={{
                  background: "var(--card)",
                  borderRadius: 20,
                  padding: 16,
                  border: "1px solid var(--border2)",
                  boxShadow: "var(--shadow-card)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={onExportData}
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    borderRadius: 14,
                    background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                    border: "1px solid transparent",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 900,
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  データを書き出す
                </button>
                <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.7 }}>
                  履歴、種目設定、下書きなどをJSONで保存します。
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
                アカウント
              </div>
              <div
                style={{
                  background: "var(--card)",
                  borderRadius: 20,
                  padding: 16,
                  border: "1px solid var(--border2)",
                  boxShadow: "var(--shadow-card)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={async () => {
                    await onLogout?.();
                    onClose?.();
                  }}
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    borderRadius: 14,
                    background: "var(--card2)",
                    border: "1px solid rgba(18, 199, 194, 0.1)",
                    color: "var(--text)",
                    fontSize: 14,
                    fontWeight: 800,
                  }}
                >
                  ログアウト
                </button>
                {user?.id && (
                  <button
                    type="button"
                    onClick={onDeleteAccount}
                    disabled={accountActionBusy}
                    style={{
                      width: "100%",
                      padding: "14px 16px",
                      borderRadius: 14,
                      background: "rgba(239, 68, 68, 0.10)",
                      border: "1px solid rgba(239, 68, 68, 0.24)",
                      color: "#DC2626",
                      fontSize: 14,
                      fontWeight: 900,
                      opacity: accountActionBusy ? 0.65 : 1,
                    }}
                  >
                    {accountActionBusy ? "削除中..." : "アカウントとデータを削除"}
                  </button>
                )}
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
