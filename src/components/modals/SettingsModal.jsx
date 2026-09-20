import { useCallback, useEffect, useRef, useState } from "react";
import NotificationSettings from "../NotificationSettings";
import { BILLING_ENABLED } from "../../constants/features";
import { SPLIT_TYPE_DESCRIPTIONS } from "../../utils/generateOnboardingPlan";

// ─── Profile field definitions ────────────────────────────────────────────────

const PROFILE_FIELD_DEFS = [
    {
        id: "goal",
        label: "目標",
        type: "single",
        resetsPlan: false,
        options: [
            { label: "体づくり・見た目改善", value: "体づくり" },
            { label: "筋力アップ",           value: "筋力アップ" },
            { label: "継続習慣・健康維持",   value: "継続習慣" },
            { label: "ダイエット・減量",      value: "ダイエット" },
        ],
    },
    {
        id: "level",
        label: "経験レベル",
        type: "single",
        resetsPlan: true,
        options: [
            { label: "初心者（1年未満）", value: "初心者" },
            { label: "中級者（1〜3年）",  value: "中級者" },
            { label: "上級者（3年以上）", value: "上級者" },
        ],
    },
    {
        id: "frequency",
        label: "週の頻度",
        type: "frequency",
        resetsPlan: true,
    },
    {
        id: "trainingYears",
        label: "筋トレ歴",
        type: "single",
        resetsPlan: false,
        options: [
            { label: "1年未満", value: "1年未満" },
            { label: "1〜3年",  value: "1〜3年" },
            { label: "3〜5年",  value: "3〜5年" },
            { label: "5年以上", value: "5年以上" },
        ],
    },
    {
        id: "preferredSplit",
        label: "分割スタイル",
        type: "single",
        resetsPlan: true,
        options: [
            { label: "上半身 / 下半身",   value: "upper_lower", desc: SPLIT_TYPE_DESCRIPTIONS.upper_lower },
            { label: "Push / Pull / Legs", value: "ppl",         desc: SPLIT_TYPE_DESCRIPTIONS.ppl },
            { label: "部位別分割",         value: "body_part",   desc: SPLIT_TYPE_DESCRIPTIONS.body_part },
            { label: "アーノルド分割",     value: "arnold",      desc: SPLIT_TYPE_DESCRIPTIONS.arnold },
            { label: "全身法",             value: "fullbody",    desc: SPLIT_TYPE_DESCRIPTIONS.fullbody },
            { label: "特に決めてない",     value: "none",        desc: SPLIT_TYPE_DESCRIPTIONS.none },
            { label: "自分でカスタム →",  value: "custom", isCustomTrigger: true },
        ],
    },
    {
        id: "location",
        label: "トレーニング場所",
        type: "single",
        resetsPlan: true,
        options: [
            { label: "ジム", value: "ジム" },
            { label: "自宅", value: "自宅" },
        ],
    },
    {
        id: "hasDumbbells",
        label: "ダンベルの有無",
        type: "single",
        resetsPlan: true,
        showIf: (answers) => (answers?.location || "") === "自宅",
        options: [
            { label: "ある（ダンベルあり）", value: "ある" },
            { label: "なし（自重のみ）",     value: "なし" },
        ],
    },
    {
        id: "gender",
        label: "性別",
        type: "single",
        resetsPlan: false,
        options: [
            { label: "男性",           value: "男性" },
            { label: "女性",           value: "女性" },
            { label: "その他・回答しない", value: "その他" },
        ],
    },
    {
        id: "birthdate",
        label: "生年月日",
        type: "birthdate",
        resetsPlan: false,
    },
    {
        id: "bodyWeight",
        label: "体重",
        type: "bodyweight_input",
        resetsPlan: false,
    },
];

// Body parts available for custom split editor
const CUSTOM_SPLIT_BODY_PARTS = [
    "胸", "背中", "肩", "二頭", "三頭",
    "四頭", "ハムストリングス", "尻", "腹筋",
];

// Short display labels for body part chips in editor
const BP_CHIP_LABELS = {
    "ハムストリングス": "ハム",
};

const CUSTOM_SPLIT_STORAGE_KEY = "customSplitSequence";

function loadCustomSplitSequence() {
    try {
        const stored = JSON.parse(localStorage.getItem(CUSTOM_SPLIT_STORAGE_KEY) || "null");
        if (Array.isArray(stored) && stored.length > 0) return stored;
    } catch {}
    return null;
}

function formatProfileFieldValue(fieldDef, answers) {
    const val = answers?.[fieldDef.id];
    if (fieldDef.id === "bodyWeight") {
        return val ? `${val}kg` : "未設定";
    }
    if (!val) return "未設定";
    if (fieldDef.id === "birthdate") {
        const parts = val.split("-");
        if (parts.length === 3) return `${parts[0]}年${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日`;
        return val;
    }
    if (fieldDef.id === "frequency") return `週${val}回`;
    if (fieldDef.id === "preferredSplit" && val === "custom") {
        const seq = loadCustomSplitSequence();
        if (seq?.length) return `カスタム（${seq.length}分割）`;
        return "自分でカスタム";
    }
    if (fieldDef.options) {
        const opt = fieldDef.options.find(o => o.value === val);
        return opt ? opt.label.replace(" →", "") : val;
    }
    return val;
}

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

const BODY_PARTS_FOR_TARGETS = ["胸", "背中", "四頭", "ハム", "尻", "肩", "二頭", "三頭", "腹筋"];

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
  onManageStripePortal = null,
  dailyFreeAiLimit = 5,
  aiUsageCount = 0,
  onForceSyncHistory = null,
  weekStartDay = "monday",
  setWeekStartDay,
  weeklySetTargets = {},
  setWeeklySetTargets,
  aiPlanEnabled = true,
  onSetAiPlanEnabled,
  onboardingAnswers = null,
  onSaveProfileField,
  onSaveBodyWeight,
  onSaveCustomSplit,
}) {
  const scrollLockRef = useRef({ top: 0, body: {}, html: {} });
  const [showProManager, setShowProManager] = useState(false);
  const [proStatusData, setProStatusData] = useState(null);
  const [proActionBusy, setProActionBusy] = useState(false);
  const [proMessage, setProMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [profileEditorField, setProfileEditorField] = useState(null); // fieldDef being edited
  const [profileEditorValue, setProfileEditorValue] = useState(null);
  const [profileEditorBirthYear, setProfileEditorBirthYear] = useState("");
  const [profileEditorBirthMonth, setProfileEditorBirthMonth] = useState("");
  const [profileEditorBirthDay, setProfileEditorBirthDay] = useState("");
  // Expanded description in ProfileFieldEditorSheet (option value or null)
  const [editorExpandedDesc, setEditorExpandedDesc] = useState(null);
  // Custom split editor state (shown inline within ProfileFieldEditorSheet)
  const [showCustomSplitEditor, setShowCustomSplitEditor] = useState(false);
  const [customDayCount, setCustomDayCount] = useState(3);
  const [customDays, setCustomDays] = useState([]); // [{ label, bodyParts: Set }]

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
      setSyncMessage("");
      setProfileEditorField(null);
      return;
    }
    if (showProManager) refreshProStatus({ silent: true });
  }, [isOpen, showProManager, refreshProStatus]);

  const openProfileEditor = (fieldDef) => {
    const currentVal = onboardingAnswers?.[fieldDef.id] ?? null;
    setProfileEditorField(fieldDef);
    setProfileEditorValue(
        fieldDef.type === "frequency" ? (currentVal || "3") :
        fieldDef.type === "bodyweight_input" ? (currentVal || "") :
        currentVal
    );
    if (fieldDef.type === "birthdate" && currentVal) {
      const parts = currentVal.split("-");
      setProfileEditorBirthYear(parts[0] || "");
      setProfileEditorBirthMonth(parts[1] ? String(parseInt(parts[1], 10)) : "");
      setProfileEditorBirthDay(parts[2] ? String(parseInt(parts[2], 10)) : "");
    } else {
      setProfileEditorBirthYear("");
      setProfileEditorBirthMonth("");
      setProfileEditorBirthDay("");
    }
  };

  const closeProfileEditor = () => {
    setProfileEditorField(null);
    setShowCustomSplitEditor(false);
    setEditorExpandedDesc(null);
  };

  const saveProfileEditorValue = () => {
    if (!profileEditorField) return;
    // Special handling for bodyweight_input
    if (profileEditorField.type === "bodyweight_input") {
      const n = Number(profileEditorValue);
      if (n > 0) onSaveBodyWeight?.(n);
      closeProfileEditor();
      return;
    }
    if (!onSaveProfileField) return;
    let val = profileEditorValue;
    if (profileEditorField.type === "birthdate") {
      const y = parseInt(profileEditorBirthYear, 10);
      const m = parseInt(profileEditorBirthMonth, 10);
      const d = parseInt(profileEditorBirthDay, 10);
      if (!y || !m || !d) { closeProfileEditor(); return; }
      val = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const testDate = new Date(val);
      if (isNaN(testDate.getTime())) { closeProfileEditor(); return; }
    }
    if (val === null || val === undefined) { closeProfileEditor(); return; }
    onSaveProfileField(profileEditorField.id, val);
    closeProfileEditor();
  };

  // Build initial days array for custom split editor
  const buildInitialCustomDays = (dayCount) => {
    const existing = loadCustomSplitSequence();
    if (existing?.length === dayCount) {
      return existing.map(d => ({ label: d.label || "", bodyParts: new Set(d.bodyParts || []) }));
    }
    return Array.from({ length: dayCount }, (_, i) =>
      existing?.[i]
        ? { label: existing[i].label || "", bodyParts: new Set(existing[i].bodyParts || []) }
        : { label: "", bodyParts: new Set() }
    );
  };

  const openCustomSplitEditor = () => {
    const existing = loadCustomSplitSequence();
    const initialCount = existing?.length || 3;
    setCustomDayCount(initialCount);
    setCustomDays(buildInitialCustomDays(initialCount));
    setShowCustomSplitEditor(true);
  };

  const handleCustomDayCountChange = (n) => {
    setCustomDayCount(n);
    setCustomDays(prev => {
      const next = [...prev];
      while (next.length < n) next.push({ label: "", bodyParts: new Set() });
      return next.slice(0, n);
    });
  };

  const toggleCustomBodyPart = (dayIdx, bp) => {
    setCustomDays(prev => prev.map((d, i) => {
      if (i !== dayIdx) return d;
      const next = new Set(d.bodyParts);
      if (next.has(bp)) next.delete(bp); else next.add(bp);
      return { ...d, bodyParts: next };
    }));
  };

  const saveCustomSplit = () => {
    const sequence = customDays.map((d, i) => ({
      label: d.label.trim() || `Day${i + 1}`,
      bodyParts: [...d.bodyParts],
    }));
    onSaveCustomSplit?.(sequence);
    closeProfileEditor();
  };

  const isCustomSplitValid = customDays.length > 0 && customDays.every(d => d.bodyParts.size > 0);

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

  const handleManageSubscription = async () => {
    const isNative = isNativePurchaseEnvironment();
    console.log("[manage subscription] clicked", { isNative, hasPortal: Boolean(onManageStripePortal) });
    // Web PWA (Stripe): ネイティブ環境でなければ Stripe カスタマーポータルを開く
    if (!isNative && onManageStripePortal) {
      console.log("[manage subscription] calling Stripe portal");
      setProActionBusy(true);
      try {
        const ok = await onManageStripePortal();
        console.log("[manage subscription] portal result", { ok });
        if (!ok) setProMessage("ポータルを開けませんでした。再度お試しください。");
      } finally {
        setProActionBusy(false);
      }
      return;
    }
    // ネイティブ (Apple/Google): managementURL があればそちらへ、なければ標準設定画面
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
          {["AI Coach無制限", "重量設定の相談", "弱点部位の改善提案", "全期間データ閲覧（無料は直近3ヶ月）"].map((item) => (
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
              disabled={proActionBusy}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 16,
                background: "var(--card2)",
                border: "1px solid var(--border2)",
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 900,
                opacity: proActionBusy ? 0.7 : 1,
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
              {BILLING_ENABLED && showProManager ? "Proプラン管理" : "設定"}
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

          {BILLING_ENABLED && showProManager ? proPlanManager : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
                通知
              </div>
              <NotificationSettings user={user} />
            </div>

            {BILLING_ENABLED && (
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
            )}

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
                {onForceSyncHistory && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const count = onForceSyncHistory();
                        setSyncMessage(
                          count > 0
                            ? `${count}件の記録を同期キューに追加しました。`
                            : "同期対象の記録がありません。"
                        );
                        setTimeout(() => setSyncMessage(""), 4000);
                      }}
                      style={{
                        width: "100%",
                        padding: "14px 16px",
                        borderRadius: 14,
                        background: "var(--card2)",
                        border: "1px solid var(--border2)",
                        color: "var(--text)",
                        fontSize: 14,
                        fontWeight: 900,
                      }}
                    >
                      記録を再同期
                    </button>
                    {syncMessage && (
                      <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                        {syncMessage}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
                トレーニング設定
              </div>
              <div style={{
                background: "var(--card)",
                borderRadius: 20,
                padding: 16,
                border: "1px solid var(--border2)",
                boxShadow: "var(--shadow-card)",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}>
                {/* AI plan toggle */}
                {onSetAiPlanEnabled && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>AIプランの提案</div>
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                        記録画面に次のメニューを表示する
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSetAiPlanEnabled?.(!aiPlanEnabled)}
                      style={{
                        width: 44,
                        height: 26,
                        borderRadius: 13,
                        border: "none",
                        background: aiPlanEnabled
                          ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                          : "var(--border2)",
                        position: "relative",
                        cursor: "pointer",
                        flexShrink: 0,
                        transition: "background 0.2s",
                      }}
                      aria-checked={aiPlanEnabled}
                      role="switch"
                    >
                      <span style={{
                        position: "absolute",
                        top: 3, left: aiPlanEnabled ? 21 : 3,
                        width: 20, height: 20,
                        borderRadius: "50%",
                        background: "#fff",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                      }} />
                    </button>
                  </div>
                )}

                {/* Week start day */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", marginBottom: 8 }}>週の開始日</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {[
                      { value: 0, label: "日" },
                      { value: 1, label: "月" },
                      { value: 2, label: "火" },
                      { value: 3, label: "水" },
                      { value: 4, label: "木" },
                      { value: 5, label: "金" },
                      { value: 6, label: "土" },
                    ].map((opt) => {
                      const selected = Number(weekStartDay) === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setWeekStartDay?.(opt.value)}
                          style={{
                            flex: 1,
                            padding: "9px 0",
                            borderRadius: 11,
                            border: selected ? "none" : "1px solid var(--border2)",
                            background: selected
                              ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                              : "var(--card2)",
                            color: selected ? "#fff" : "var(--text2)",
                            fontSize: 12,
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Weekly set targets */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", marginBottom: 8 }}>週間セット目標</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {BODY_PARTS_FOR_TARGETS.map((bp) => {
                      const target = weeklySetTargets[bp] ?? 10;
                      return (
                        <div key={bp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", minWidth: 36 }}>{bp}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button
                              type="button"
                              onClick={() => setWeeklySetTargets?.((prev) => ({ ...prev, [bp]: Math.max(1, (prev[bp] ?? 10) - 1) }))}
                              style={{
                                width: 32, height: 32, borderRadius: 999,
                                border: "1px solid var(--border2)", background: "var(--card2)",
                                color: "var(--text)", fontSize: 18, fontWeight: 900, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}
                            >
                              −
                            </button>
                            <span style={{ width: 28, textAlign: "center", fontSize: 14, fontWeight: 900, color: "var(--text)" }}>
                              {target}
                            </span>
                            <button
                              type="button"
                              onClick={() => setWeeklySetTargets?.((prev) => ({ ...prev, [bp]: Math.min(50, (prev[bp] ?? 10) + 1) }))}
                              style={{
                                width: 32, height: 32, borderRadius: 999,
                                border: "1px solid var(--border2)", background: "var(--card2)",
                                color: "var(--text)", fontSize: 18, fontWeight: 900, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Profile field rows */}
                {onSaveProfileField && (
                  <>
                    <div style={{ height: 1, background: "var(--border2)", margin: "4px 0" }} />
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", marginBottom: 4 }}>プロフィール</div>
                    {PROFILE_FIELD_DEFS.filter(f => !f.showIf || f.showIf(onboardingAnswers)).map(fieldDef => (
                      <button
                        key={fieldDef.id}
                        type="button"
                        onClick={() => openProfileEditor(fieldDef)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          background: "none",
                          border: "none",
                          padding: "4px 0",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                          {fieldDef.label}
                          {fieldDef.resetsPlan && (
                            <span style={{ fontSize: 10, color: "var(--accent)", marginLeft: 5, fontWeight: 900 }}>
                              AIプラン再構築
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, color: "var(--text3)" }}>
                            {formatProfileFieldValue(fieldDef, onboardingAnswers)}
                          </span>
                          <span style={{ color: "var(--text3)", fontSize: 16 }}>›</span>
                        </div>
                      </button>
                    ))}
                  </>
                )}
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
                <div style={{ display: "flex", gap: 12, justifyContent: "center", paddingBottom: 4 }}>
                  <a
                    href="https://training-log-mu.vercel.app/privacy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 13, color: "var(--text3)", textDecoration: "underline" }}
                  >
                    プライバシーポリシー
                  </a>
                  <span style={{ color: "var(--text3)", fontSize: 13 }}>·</span>
                  <a
                    href="https://training-log-mu.vercel.app/privacy.html#利用規約"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 13, color: "var(--text3)", textDecoration: "underline" }}
                  >
                    利用規約
                  </a>
                </div>
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

      {/* Profile field editor bottom sheet */}
      {profileEditorField && (
        <div
          onClick={closeProfileEditor}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 401,
            background: "rgba(15, 23, 42, 0.54)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "0 12px calc(12px + var(--safe-bottom, 0px))",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 430,
              background: "var(--card-modal)",
              borderRadius: "24px 24px 20px 20px",
              border: "1px solid rgba(18, 199, 194, 0.12)",
              boxShadow: "0 22px 44px rgba(15, 23, 42, 0.22)",
              maxHeight: "80dvh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--border2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {showCustomSplitEditor && (
                  <button
                    type="button"
                    onClick={() => setShowCustomSplitEditor(false)}
                    style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 22, lineHeight: 1, padding: 0, cursor: "pointer" }}
                  >
                    ←
                  </button>
                )}
                <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>
                  {showCustomSplitEditor ? "カスタム分割を設定" : profileEditorField.label}
                </div>
              </div>
              <button type="button" onClick={closeProfileEditor} style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 26, lineHeight: 1, padding: 0 }}>×</button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
              {/* ── Custom split editor ── */}
              {showCustomSplitEditor ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 900, background: "rgba(18,199,194,0.08)", borderRadius: 10, padding: "7px 10px" }}>
                    保存するとAIプランの進行がリセットされます
                  </div>

                  {/* Day count selector */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", marginBottom: 8 }}>何分割？</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[2, 3, 4, 5, 6, 7].map(n => {
                        const sel = customDayCount === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => handleCustomDayCountChange(n)}
                            style={{
                              flex: 1,
                              padding: "10px 0",
                              borderRadius: 12,
                              background: sel ? "linear-gradient(135deg, var(--accent), var(--accent2))" : "var(--card2)",
                              border: sel ? "none" : "1px solid var(--border2)",
                              color: sel ? "#fff" : "var(--text2)",
                              fontSize: 14,
                              fontWeight: 900,
                              cursor: "pointer",
                            }}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Day cards */}
                  {customDays.map((day, dayIdx) => (
                    <div
                      key={dayIdx}
                      style={{
                        background: "var(--card2)",
                        borderRadius: 16,
                        padding: 14,
                        border: "1px solid var(--border2)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text3)", minWidth: 36 }}>
                          Day{dayIdx + 1}
                        </span>
                        <input
                          type="text"
                          placeholder={`Day${dayIdx + 1}`}
                          value={day.label}
                          onChange={e => setCustomDays(prev => prev.map((d, i) => i === dayIdx ? { ...d, label: e.target.value } : d))}
                          style={{
                            flex: 1,
                            padding: "8px 10px",
                            borderRadius: 10,
                            background: "var(--card)",
                            border: "1px solid var(--border2)",
                            color: "var(--text)",
                            fontSize: 13,
                            fontWeight: 800,
                            outline: "none",
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {CUSTOM_SPLIT_BODY_PARTS.map(bp => {
                          const sel = day.bodyParts.has(bp);
                          return (
                            <button
                              key={bp}
                              type="button"
                              onClick={() => toggleCustomBodyPart(dayIdx, bp)}
                              style={{
                                padding: "6px 11px",
                                borderRadius: 999,
                                background: sel ? "linear-gradient(135deg, var(--accent), var(--accent2))" : "var(--card)",
                                border: sel ? "none" : "1px solid var(--border2)",
                                color: sel ? "#fff" : "var(--text2)",
                                fontSize: 12,
                                fontWeight: 900,
                                cursor: "pointer",
                              }}
                            >
                              {BP_CHIP_LABELS[bp] || bp}
                            </button>
                          );
                        })}
                      </div>
                      {day.bodyParts.size === 0 && (
                        <div style={{ fontSize: 11, color: "#EF4444", fontWeight: 800 }}>1つ以上選択してください</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {profileEditorField.resetsPlan && (
                    <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 900, marginBottom: 12, background: "rgba(18,199,194,0.08)", borderRadius: 10, padding: "7px 10px" }}>
                      この項目を変更するとAIプランの進行がリセットされます
                    </div>
                  )}

                  {profileEditorField.type === "single" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {profileEditorField.options.map(opt => {
                        if (opt.isCustomTrigger) {
                          const isCurrentCustom = profileEditorValue === "custom";
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={openCustomSplitEditor}
                              style={{
                                width: "100%",
                                padding: "13px 16px",
                                borderRadius: 14,
                                background: isCurrentCustom ? "rgba(18,199,194,0.12)" : "var(--card2)",
                                border: isCurrentCustom ? "1px solid rgba(18,199,194,0.4)" : "1px solid var(--border2)",
                                color: "var(--text)",
                                fontSize: 14,
                                fontWeight: 900,
                                textAlign: "left",
                                cursor: "pointer",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <span>{opt.label}</span>
                              {isCurrentCustom && (
                                <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 900 }}>
                                  {loadCustomSplitSequence()?.length ? `${loadCustomSplitSequence()?.length}分割設定済み` : ""}
                                </span>
                              )}
                            </button>
                          );
                        }
                        const selected = profileEditorValue === opt.value;
                        const descOpen = editorExpandedDesc === opt.value;
                        const hasDesc = Boolean(opt.desc);
                        return (
                          <div key={opt.value}>
                            <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditorExpandedDesc(null);
                                  setProfileEditorValue(opt.value);
                                }}
                                style={{
                                  flex: 1,
                                  padding: "13px 16px",
                                  borderRadius: hasDesc ? "14px 0 0 14px" : 14,
                                  background: selected ? "linear-gradient(135deg, var(--accent), var(--accent2))" : "var(--card2)",
                                  border: selected ? "none" : "1px solid var(--border2)",
                                  color: selected ? "#fff" : "var(--text)",
                                  fontSize: 14,
                                  fontWeight: 900,
                                  textAlign: "left",
                                  cursor: "pointer",
                                }}
                              >
                                {opt.label}
                              </button>
                              {hasDesc && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditorExpandedDesc(descOpen ? null : opt.value);
                                  }}
                                  style={{
                                    flexShrink: 0,
                                    width: 40,
                                    background: descOpen ? "rgba(18,199,194,0.18)" : selected ? "rgba(255,255,255,0.15)" : "var(--card)",
                                    border: selected ? "none" : "1px solid var(--border2)",
                                    borderLeft: "none",
                                    borderRadius: "0 14px 14px 0",
                                    color: descOpen ? "var(--accent)" : "var(--text3)",
                                    fontSize: 14,
                                    fontWeight: 900,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                  aria-label="詳しく見る"
                                >
                                  ?
                                </button>
                              )}
                            </div>
                            {descOpen && opt.desc && (
                              <div style={{
                                marginTop: 5,
                                padding: "10px 13px",
                                background: "rgba(18,199,194,0.06)",
                                borderRadius: 11,
                                border: "1px solid rgba(18,199,194,0.16)",
                                fontSize: 12,
                                color: "var(--text2)",
                                lineHeight: 1.7,
                              }}>
                                {opt.desc}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {profileEditorField.type === "frequency" && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
                      {[1,2,3,4,5,6,7].map(n => {
                        const selected = String(profileEditorValue) === String(n);
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setProfileEditorValue(String(n))}
                            style={{
                              padding: "12px 0",
                              borderRadius: 12,
                              background: selected ? "linear-gradient(135deg, var(--accent), var(--accent2))" : "var(--card2)",
                              border: selected ? "none" : "1px solid var(--border2)",
                              color: selected ? "#fff" : "var(--text2)",
                              fontSize: 15,
                              fontWeight: 900,
                              cursor: "pointer",
                            }}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {profileEditorField.type === "birthdate" && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ flex: 2 }}>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, fontWeight: 800 }}>年</div>
                        <input
                          type="number"
                          placeholder="1990"
                          value={profileEditorBirthYear}
                          onChange={e => setProfileEditorBirthYear(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "12px 10px",
                            borderRadius: 12,
                            background: "var(--card2)",
                            border: "1px solid var(--border2)",
                            color: "var(--text)",
                            fontSize: 15,
                            fontWeight: 900,
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, fontWeight: 800 }}>月</div>
                        <input
                          type="number"
                          placeholder="1"
                          min="1" max="12"
                          value={profileEditorBirthMonth}
                          onChange={e => setProfileEditorBirthMonth(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "12px 10px",
                            borderRadius: 12,
                            background: "var(--card2)",
                            border: "1px solid var(--border2)",
                            color: "var(--text)",
                            fontSize: 15,
                            fontWeight: 900,
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, fontWeight: 800 }}>日</div>
                        <input
                          type="number"
                          placeholder="1"
                          min="1" max="31"
                          value={profileEditorBirthDay}
                          onChange={e => setProfileEditorBirthDay(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "12px 10px",
                            borderRadius: 12,
                            background: "var(--card2)",
                            border: "1px solid var(--border2)",
                            color: "var(--text)",
                            fontSize: 15,
                            fontWeight: 900,
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {profileEditorField.type === "bodyweight_input" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="70"
                        autoFocus
                        value={profileEditorValue || ""}
                        onChange={e => setProfileEditorValue(e.target.value)}
                        style={{
                          width: 100,
                          padding: "12px 10px",
                          borderRadius: 12,
                          background: "var(--card2)",
                          border: "1px solid var(--border2)",
                          color: "var(--text)",
                          fontSize: 22,
                          fontWeight: 900,
                          textAlign: "right",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text2)" }}>kg</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Save button */}
            <div style={{ padding: "12px 18px calc(8px + var(--safe-bottom, 0px))", borderTop: "1px solid var(--border2)" }}>
              <button
                type="button"
                onClick={showCustomSplitEditor ? saveCustomSplit : saveProfileEditorValue}
                disabled={showCustomSplitEditor && !isCustomSplitValid}
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  borderRadius: 16,
                  background: (showCustomSplitEditor && !isCustomSplitValid)
                    ? "var(--card2)"
                    : "linear-gradient(135deg, var(--accent), var(--accent2))",
                  border: (showCustomSplitEditor && !isCustomSplitValid) ? "1px solid var(--border2)" : "none",
                  color: (showCustomSplitEditor && !isCustomSplitValid) ? "var(--text3)" : "#fff",
                  fontSize: 15,
                  fontWeight: 950,
                  boxShadow: (showCustomSplitEditor && !isCustomSplitValid) ? "none" : "var(--shadow-soft)",
                  cursor: (showCustomSplitEditor && !isCustomSplitValid) ? "not-allowed" : "pointer",
                }}
              >
                {showCustomSplitEditor ? "この分割で保存する" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
