import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const REST_TIMER_NOTIFICATION_ID = 522022;
const REST_TIMER_TITLE = "休憩終了";
const REST_TIMER_BODY = "次のセットに入りましょう";

let webNotificationTimeoutId = null;

const isNativeLocalNotificationAvailable = () =>
  typeof Capacitor?.isNativePlatform === "function" && Capacitor.isNativePlatform();

const clearWebRestTimerNotification = () => {
  if (webNotificationTimeoutId != null) {
    window.clearTimeout(webNotificationTimeoutId);
    webNotificationTimeoutId = null;
  }
};

async function requestNativeNotificationPermission() {
  const current = await LocalNotifications.checkPermissions();
  if (current?.display === "granted") return true;

  const requested = await LocalNotifications.requestPermissions();
  return requested?.display === "granted";
}

async function scheduleNativeRestTimerNotification(seconds) {
  const allowed = await requestNativeNotificationPermission();
  if (!allowed) return false;

  await LocalNotifications.cancel({
    notifications: [{ id: REST_TIMER_NOTIFICATION_ID }],
  });

  await LocalNotifications.schedule({
    notifications: [
      {
        id: REST_TIMER_NOTIFICATION_ID,
        title: REST_TIMER_TITLE,
        body: REST_TIMER_BODY,
        schedule: {
          at: new Date(Date.now() + seconds * 1000),
          allowWhileIdle: true,
        },
        extra: {
          type: "rest-timer",
        },
      },
    ],
  });

  return true;
}

async function requestWebNotificationPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return false;
  if (!window.isSecureContext) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

async function showWebRestTimerNotification() {
  const options = {
    body: REST_TIMER_BODY,
    icon: "/app-icon-192.png",
    badge: "/icon-48.png",
    tag: "pump-rest-timer",
    data: {
      url: "/?screen=log",
    },
  };

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration?.showNotification) {
        await registration.showNotification(REST_TIMER_TITLE, options);
        return;
      }
    }
  } catch {}

  try {
    new Notification(REST_TIMER_TITLE, options);
  } catch {}
}

async function scheduleWebRestTimerNotification(seconds) {
  clearWebRestTimerNotification();

  const allowed = await requestWebNotificationPermission();
  if (!allowed) return false;

  webNotificationTimeoutId = window.setTimeout(() => {
    webNotificationTimeoutId = null;
    showWebRestTimerNotification();
  }, seconds * 1000);

  return true;
}

export async function cancelRestTimerNotification() {
  clearWebRestTimerNotification();

  if (!isNativeLocalNotificationAvailable()) return;

  try {
    await LocalNotifications.cancel({
      notifications: [{ id: REST_TIMER_NOTIFICATION_ID }],
    });
  } catch {}
}

export async function scheduleRestTimerNotification(seconds) {
  const normalizedSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!normalizedSeconds) return false;

  await cancelRestTimerNotification();

  if (isNativeLocalNotificationAvailable()) {
    try {
      return await scheduleNativeRestTimerNotification(normalizedSeconds);
    } catch {
      return false;
    }
  }

  return scheduleWebRestTimerNotification(normalizedSeconds);
}
