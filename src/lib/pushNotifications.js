function isProbablyIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
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
    throw new Error("serviceWorker not supported");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return registration;
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
  const registration = await registerPushServiceWorker();
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(vapidPublicKey) {
  const registration = await registerPushServiceWorker();
  const existingSubscription = await registration.pushManager.getSubscription();
  if (existingSubscription) return existingSubscription;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export async function unsubscribeFromPush() {
  const registration = await registerPushServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;

  const serialized = subscription.toJSON();
  await subscription.unsubscribe();
  return {
    endpoint: serialized.endpoint,
    keys: serialized.keys || {},
  };
}

export function serializePushSubscription(subscription) {
  const json = subscription?.toJSON?.();
  if (!json?.endpoint || !json?.keys) return null;

  return {
    endpoint: json.endpoint,
    keys: json.keys,
  };
}
