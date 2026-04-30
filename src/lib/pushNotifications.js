function isProbablyIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

function createPushError(message, cause) {
  const error = new Error(message);
  if (cause) error.cause = cause;
  return error;
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    window.navigator.standalone === true
  );
}

export function getPushSupportState() {
  if (typeof window === "undefined") {
    return { supported: false, message: "この環境では通知を利用できません。" };
  }

  if (!window.isSecureContext) {
    return { supported: false, message: "通知は HTTPS 環境でのみ使えます。" };
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { supported: false, message: "この端末やブラウザでは通知に対応していません。" };
  }

  if (isProbablyIOS() && !isStandaloneDisplayMode()) {
    return {
      supported: false,
      requiresInstall: true,
      message: "iPhoneではホーム画面に追加したあとに通知を有効にできます。",
    };
  }

  return { supported: true, message: "" };
}

export async function registerPushServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw createPushError("Service Workerに対応していません");
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return registration;
  } catch (error) {
    throw createPushError("Service Workerの登録に失敗しました", error);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export async function getCurrentPushSubscription() {
  try {
    const registration = await registerPushServiceWorker();
    return await registration.pushManager.getSubscription();
  } catch (error) {
    throw createPushError("現在の通知状態の取得に失敗しました", error);
  }
}

export async function subscribeToPush(vapidPublicKey) {
  if (!vapidPublicKey) {
    throw createPushError("VAPID公開キーが設定されていません");
  }

  if (typeof Notification === "undefined") {
    throw createPushError("通知機能に対応していません");
  }

  if (Notification.permission === "denied") {
    throw createPushError("通知がブロックされています。iPhoneの設定でIRON LOGの通知を許可してください");
  }

  try {
    const registration = await registerPushServiceWorker();
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) return existingSubscription;

    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  } catch (error) {
    throw createPushError("Push購読の作成に失敗しました", error);
  }
}

export async function unsubscribeFromPush() {
  try {
    const registration = await registerPushServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return null;

    const serialized = subscription.toJSON();
    await subscription.unsubscribe();
    return {
      endpoint: serialized.endpoint,
      keys: serialized.keys || {},
    };
  } catch (error) {
    throw createPushError("Push購読の解除に失敗しました", error);
  }
}

export function serializePushSubscription(subscription) {
  const json = subscription?.toJSON?.();
  if (!json?.endpoint) {
    throw createPushError("Push購読の endpoint が取得できませんでした");
  }

  if (!json?.keys?.p256dh || !json?.keys?.auth) {
    throw createPushError("Push購読の keys が不足しています");
  }

  return {
    endpoint: json.endpoint,
    keys: json.keys,
  };
}
