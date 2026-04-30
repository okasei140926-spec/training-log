import { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabase";
import {
  getCurrentPushSubscription,
  getPushSupportState,
  registerPushServiceWorker,
  serializePushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "../lib/pushNotifications";

const vapidPublicKey = process.env.REACT_APP_VAPID_PUBLIC_KEY;

async function persistSubscription(userId, subscription, enabled = true) {
  if (!userId) {
    throw new Error("ログイン情報が取得できませんでした");
  }

  const serialized = serializePushSubscription(subscription);

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: serialized.endpoint,
      keys: serialized.keys,
      enabled,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("push subscription upsert failed", {
      error,
      userId,
      endpoint: serialized.endpoint,
    });
    throw new Error("通知情報の保存に失敗しました");
  }
}

async function disableSubscription(userId, endpoint) {
  if (!endpoint) return;

  const { error } = await supabase
    .from("push_subscriptions")
    .update({
      enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("endpoint", endpoint);

  if (error) {
    console.error("push subscription disable failed", { error, userId, endpoint });
    throw new Error("通知情報の更新に失敗しました");
  }
}

export default function NotificationSettings({ user }) {
  const support = useMemo(() => getPushSupportState(), []);
  const [permission, setPermission] = useState(
    typeof Notification === "undefined" ? "default" : Notification.permission
  );
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let isActive = true;

    const syncExistingSubscription = async () => {
      if (!user?.id || !support.supported) return;

      try {
        await registerPushServiceWorker();
        const subscription = await getCurrentPushSubscription();
        if (!isActive) return;

        setPermission(Notification.permission);
        setEnabled(Boolean(subscription && Notification.permission === "granted"));

        if (subscription && Notification.permission === "granted") {
          await persistSubscription(user.id, subscription, true);
        }
      } catch (error) {
        console.error("push subscription sync failed", {
          error,
          message: error?.message,
          userId: user?.id,
          permission: typeof Notification === "undefined" ? "unknown" : Notification.permission,
          hasVapidPublicKey: Boolean(vapidPublicKey),
        });
      }
    };

    syncExistingSubscription();

    return () => {
      isActive = false;
    };
  }, [support.supported, user?.id]);

  const handleEnable = async () => {
    if (busy) return;

    if (!user?.id) {
      setMessage("ログイン情報が取得できませんでした");
      return;
    }

    if (!support.supported) {
      setMessage(support.message);
      return;
    }

    if (!vapidPublicKey) {
      setMessage("VAPID公開キーが設定されていません");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      await registerPushServiceWorker();
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);

      if (nextPermission !== "granted") {
        setEnabled(false);
        setMessage(
          nextPermission === "denied"
            ? "通知がブロックされています。iPhoneの設定でIRON LOGの通知を許可してください"
            : "通知を許可するとテスト通知を受け取れます。"
        );
        return;
      }

      const subscription = await subscribeToPush(vapidPublicKey);
      await persistSubscription(user.id, subscription, true);
      setEnabled(true);
      setMessage("通知を有効にしました。");
    } catch (error) {
      console.error("push enable failed", {
        error,
        message: error?.message,
        userId: user?.id,
        permission: typeof Notification === "undefined" ? "unknown" : Notification.permission,
        hasVapidPublicKey: Boolean(vapidPublicKey),
      });
      setMessage(error?.message || "通知の有効化に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!user?.id || busy) return;

    setBusy(true);
    setMessage("");

    try {
      const subscription = await unsubscribeFromPush();
      await disableSubscription(user.id, subscription?.endpoint);
      setEnabled(false);
      setPermission(typeof Notification === "undefined" ? "default" : Notification.permission);
      setMessage("通知をオフにしました。");
    } catch (error) {
      console.error("push disable failed", {
        error,
        message: error?.message,
        userId: user?.id,
      });
      setMessage(error?.message || "通知の停止に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const handleSendTest = async () => {
    if (!user?.id || busy) return;

    setBusy(true);
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        setMessage("ログインが必要です。");
        return;
      }

      const response = await fetch("/api/send-test-push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data?.error || "テスト通知の送信に失敗しました。");
        return;
      }

      setMessage("テスト通知を送信しました。");
    } catch (error) {
      console.error("push test send failed", error);
      setMessage("テスト通知の送信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: "var(--card)",
        borderRadius: 20,
        padding: 16,
        marginBottom: 14,
        border: "1px solid var(--border2)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
        通知設定
      </div>
      <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.7, marginBottom: 12 }}>
        記録リマインドやFriends通知の基盤です。iPhoneではホーム画面に追加したあとに使えます。
      </div>

      {!support.supported ? (
        <div
          style={{
            background: "var(--card2)",
            border: "1px solid var(--border2)",
            borderRadius: 14,
            padding: "12px 14px",
            fontSize: 12,
            color: "var(--text2)",
            lineHeight: 1.7,
          }}
        >
          {support.message || "この環境では通知を利用できません。"}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            {enabled ? (
              <button
                onClick={handleDisable}
                disabled={busy}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--card2)",
                  border: "1px solid var(--border2)",
                  color: "var(--text2)",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                通知をオフにする
              </button>
            ) : (
              <button
                onClick={handleEnable}
                disabled={busy}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "linear-gradient(135deg, var(--accent), #4ADE80)",
                  border: "1px solid transparent",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 800,
                  boxShadow: "var(--shadow-soft)",
                }}
              >
                通知を有効にする
              </button>
            )}

            <button
              onClick={handleSendTest}
              disabled={busy || !enabled}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                background: enabled ? "linear-gradient(135deg, var(--accent2), #7DD3FC)" : "var(--card2)",
                border: "1px solid transparent",
                color: enabled ? "#fff" : "var(--text4)",
                fontSize: 12,
                fontWeight: 800,
                opacity: enabled ? 1 : 0.7,
              }}
            >
              テスト通知を送る
            </button>
          </div>

          <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.7 }}>
            状態: {enabled ? "通知ON" : permission === "denied" ? "通知拒否中" : "通知OFF"}
          </div>
        </>
      )}

      {message && (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: message.includes("失敗") ? "#FF7A7A" : "var(--text2)",
            lineHeight: 1.6,
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
