import { useEffect, useRef } from "react";
import NotificationSettings from "../NotificationSettings";

export default function SettingsModal({
  isOpen,
  onClose,
  user,
  onLogout,
  onExportData,
  onDeleteAccount,
  accountActionBusy = false,
}) {
  const scrollLockRef = useRef({ top: 0, body: {}, html: {} });

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

  if (!isOpen) return null;

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
              設定
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

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
                通知
              </div>
              <NotificationSettings user={user} />
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
        </div>
      </div>
    </div>
  );
}
