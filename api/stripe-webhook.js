import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminSupabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, stripe-signature");
}

const getUserIdForCustomer = async (customerId) => {
  const { data } = await adminSupabase
    .from("pump_pro_subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.user_id || null;
};

const handleSubscriptionChange = async (sub, isDeleted = false) => {
  if (!adminSupabase) return;

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
        expires_at: isDeleted ? expiresAt : expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("stripe-webhook: upsert failed", error);
  }
};

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return res.status(500).json({ error: "Stripe設定が不足しています。" });
  }

  if (!adminSupabase) {
    return res.status(500).json({ error: "DB設定が不足しています。" });
  }

  const eventId = req.body?.id;
  const eventType = req.body?.type;

  if (!eventId || typeof eventId !== "string") {
    return res.status(400).json({ error: "Invalid event payload" });
  }

  // Verify authenticity by fetching the event directly from Stripe
  // (Vercel auto-parses JSON bodies so raw body is unavailable for signature verification)
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });

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
      case "customer.subscription.updated": {
        const sub = event.data.object;
        await handleSubscriptionChange(sub, false);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await handleSubscriptionChange(sub, true);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await handleSubscriptionChange(sub, false);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          // Only deactivate if the subscription itself is no longer active
          if (sub.status !== "active") {
            await handleSubscriptionChange(sub, true);
          }
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge and ignore
        break;
    }
  } catch (err) {
    console.error("stripe-webhook: handler error", err);
    return res.status(500).json({ error: "Webhook処理に失敗しました。" });
  }

  return res.status(200).json({ received: true });
}
