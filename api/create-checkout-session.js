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

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripePriceId = process.env.STRIPE_PRICE_ID;
  const appUrl = process.env.REACT_APP_URL || "https://training-log-mu.vercel.app";

  if (!stripeSecretKey || !stripePriceId) {
    return res.status(500).json({ error: "Stripe設定が不足しています。" });
  }

  if (!authSupabase || !adminSupabase) {
    return res.status(500).json({ error: "DB設定が不足しています。" });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const {
    data: { user },
    error: userError,
  } = await authSupabase.auth.getUser(accessToken);

  if (userError || !user?.id) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });

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
