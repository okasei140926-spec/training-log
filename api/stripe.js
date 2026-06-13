import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const authSupabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const adminSupabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const getBearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
};

const getTodayKeyInTokyo = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const getStripe = () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" });
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, stripe-signature");
}

const authenticateUser = async (req) => {
  const accessToken = getBearerToken(req);
  if (!accessToken) return { user: null, error: "ログインが必要です" };
  const { data: { user }, error } = await authSupabase.auth.getUser(accessToken);
  if (error || !user?.id) return { user: null, error: "ログインが必要です" };
  return { user, accessToken };
};

// POST /api/stripe?action=create-checkout
async function handleCreateCheckout(req, res) {
  const stripe = getStripe();
  const stripePriceId = process.env.STRIPE_PRICE_ID;
  const appUrl = process.env.REACT_APP_URL || "https://training-log-mu.vercel.app";

  if (!stripe || !stripePriceId) {
    return res.status(500).json({ error: "Stripe設定が不足しています。" });
  }

  const { user, error: authError } = await authenticateUser(req);
  if (authError || !user) return res.status(401).json({ error: authError });

  const { data: subscription } = await adminSupabase
    .from("pump_pro_subscriptions")
    .select("stripe_customer_id, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subscription?.active) {
    return res.status(400).json({ error: "すでにPro会員です。" });
  }

  let stripeCustomerId = subscription?.stripe_customer_id || null;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    stripeCustomerId = customer.id;

    await adminSupabase
      .from("pump_pro_subscriptions")
      .upsert(
        {
          user_id: user.id,
          stripe_customer_id: stripeCustomerId,
          active: false,
          provider: "stripe",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url: `${appUrl}/?stripe_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/?stripe_checkout=cancel`,
    subscription_data: {
      metadata: { supabase_user_id: user.id },
    },
  });

  return res.status(200).json({ url: session.url });
}

// POST /api/stripe?action=activate
async function handleActivate(req, res) {
  const stripe = getStripe();
  if (!stripe) return res.status(500).json({ error: "Stripe設定が不足しています。" });

  const { user, error: authError } = await authenticateUser(req);
  if (authError || !user) return res.status(401).json({ error: authError });

  const { session_id: sessionId } = req.body || {};
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "session_idが必要です" });
  }

  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
  } catch (err) {
    console.error("stripe session retrieve failed", err);
    return res.status(400).json({ error: "Stripeセッションの取得に失敗しました。" });
  }

  if (checkoutSession.payment_status !== "paid") {
    return res.status(400).json({ error: "支払いが完了していません。" });
  }

  const sub = checkoutSession.subscription;
  const subUserId = sub?.metadata?.supabase_user_id || checkoutSession.metadata?.supabase_user_id;

  if (subUserId && subUserId !== user.id) {
    return res.status(403).json({ error: "セッションが一致しません。" });
  }

  const stripeCustomerId = checkoutSession.customer;
  const stripeSubscriptionId = typeof sub === "string" ? sub : sub?.id;
  const expiresAt = sub?.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const { error: upsertError } = await adminSupabase
    .from("pump_pro_subscriptions")
    .upsert(
      {
        user_id: user.id,
        active: true,
        provider: "stripe",
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId || null,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    console.error("activate stripe checkout upsert failed", upsertError);
    return res.status(500).json({ error: "Pro有効化に失敗しました。" });
  }

  const usageDate = getTodayKeyInTokyo();
  const { data: usageRow } = await adminSupabase
    .from("ai_chat_usage")
    .select("usage_count")
    .eq("user_id", user.id)
    .eq("usage_date", usageDate)
    .maybeSingle();

  return res.status(200).json({
    success: true,
    isPro: true,
    aiUsage: {
      usageDate,
      isPro: true,
      usageCount: Number(usageRow?.usage_count || 0),
      remaining: null,
      dailyLimit: 5,
    },
  });
}

// POST /api/stripe?action=portal
async function handlePortal(req, res) {
  const stripe = getStripe();
  const appUrl = process.env.REACT_APP_URL || "https://training-log-mu.vercel.app";

  if (!stripe) return res.status(500).json({ error: "Stripe設定が不足しています。" });

  const { user, error: authError } = await authenticateUser(req);
  if (authError || !user) return res.status(401).json({ error: authError });

  const { data: subscription } = await adminSupabase
    .from("pump_pro_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const stripeCustomerId = subscription?.stripe_customer_id;
  if (!stripeCustomerId) {
    return res.status(404).json({ error: "Stripeの顧客情報が見つかりません。" });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: appUrl,
  });

  return res.status(200).json({ url: portalSession.url });
}

// POST /api/stripe?action=webhook  (called by Stripe)
const getUserIdForCustomer = async (customerId) => {
  const { data } = await adminSupabase
    .from("pump_pro_subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.user_id || null;
};

const handleSubscriptionChange = async (stripe, sub, isDeleted = false) => {
  const userId =
    sub.metadata?.supabase_user_id ||
    (await getUserIdForCustomer(sub.customer));

  if (!userId) {
    console.warn("stripe-webhook: no user found for customer", sub.customer);
    return;
  }

  const active = !isDeleted && sub.status === "active";
  const expiresAt = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const { error } = await adminSupabase
    .from("pump_pro_subscriptions")
    .upsert(
      {
        user_id: userId,
        active,
        provider: "stripe",
        stripe_customer_id: sub.customer,
        stripe_subscription_id: sub.id,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) console.error("stripe-webhook: upsert failed", error);
};

async function handleWebhook(req, res) {
  const stripe = getStripe();
  if (!stripe) return res.status(500).json({ error: "Stripe設定が不足しています。" });

  const eventId = req.body?.id;
  const eventType = req.body?.type;

  if (!eventId || typeof eventId !== "string") {
    return res.status(400).json({ error: "Invalid event payload" });
  }

  // Verify by fetching from Stripe directly (Vercel auto-parses JSON, raw body unavailable)
  let event;
  try {
    event = await stripe.events.retrieve(eventId);
  } catch (err) {
    console.error("stripe-webhook: event retrieve failed", err);
    return res.status(400).json({ error: "イベントの検証に失敗しました。" });
  }

  if (event.type !== eventType) {
    return res.status(400).json({ error: "Event type mismatch" });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionChange(stripe, event.data.object, false);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionChange(stripe, event.data.object, true);
        break;

      case "invoice.paid": {
        const subId = event.data.object.subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await handleSubscriptionChange(stripe, sub, false);
        }
        break;
      }

      case "invoice.payment_failed": {
        const subId = event.data.object.subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          if (sub.status !== "active") {
            await handleSubscriptionChange(stripe, sub, true);
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("stripe-webhook: handler error", err);
    return res.status(500).json({ error: "Webhook処理に失敗しました。" });
  }

  return res.status(200).json({ received: true });
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  if (!authSupabase || !adminSupabase) {
    return res.status(500).json({ error: "DB設定が不足しています。" });
  }

  const action = req.query.action;

  switch (action) {
    case "create-checkout":
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      return handleCreateCheckout(req, res);

    case "activate":
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      return handleActivate(req, res);

    case "portal":
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      return handlePortal(req, res);

    case "webhook":
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      return handleWebhook(req, res);

    default:
      return res.status(404).json({ error: "Unknown action" });
  }
}
