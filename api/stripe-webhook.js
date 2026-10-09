// =============================================================================
// STRIPE WEBHOOK — the thing that makes payment stop being a manual job
// =============================================================================
// Runs as a Vercel serverless function at /api/stripe-webhook. Stripe calls it
// when something happens to a subscription, and it writes the one field the app
// cares about: client_links.paid.
//
// It uses the Supabase SERVICE ROLE key, which bypasses row-level security.
// That is the point — no athlete may write their own paid flag, so the only
// thing allowed to is a server Stripe has authenticated. The service role key
// must never appear in a VITE_ variable or anywhere else the browser can read.
//
// Setup is in README-STRIPE.md.
// =============================================================================
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Stripe signs the raw bytes. Any parsing before verification changes them and
// every event fails the signature check.
export const config = { api: { bodyParser: false } };

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !whSecret || !supaUrl || !supaKey) {
    // Loud, because a webhook that silently does nothing is how you find out
    // three weeks later that nobody has been unlocked.
    console.error("stripe-webhook: missing env", {
      STRIPE_SECRET_KEY: !!secret, STRIPE_WEBHOOK_SECRET: !!whSecret,
      SUPABASE_URL: !!supaUrl, SUPABASE_SERVICE_ROLE_KEY: !!supaKey,
    });
    return res.status(500).json({ error: "Server is not configured" });
  }

  const stripe = new Stripe(secret);
  let event;
  try {
    event = stripe.webhooks.constructEvent(await rawBody(req), req.headers["stripe-signature"], whSecret);
  } catch (err) {
    console.error("stripe-webhook: bad signature —", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Setting the same value twice is harmless, which is what makes this safe
  // against Stripe's retries — it delivers every event at least once.
  const setPaid = async (match, paid, extra = {}) => {
    const { error, data } = await db.from("client_links")
      .update({ paid, ...extra }).match(match).select("client_user_id");
    if (error) { console.error("stripe-webhook: update failed —", error.message, match); throw error; }
    if (!data || !data.length) console.warn("stripe-webhook: no athlete matched", match);
    return data || [];
  };

  try {
    switch (event.type) {
      // Someone paid. The Payment Link carries their Supabase user id in
      // client_reference_id — see paymentLinkFor() in src/App.jsx.
      case "checkout.session.completed": {
        const s = event.data.object;
        const userId = s.client_reference_id;
        if (!userId) {
          console.warn("stripe-webhook: checkout with no client_reference_id, session", s.id);
          break;
        }
        await setPaid({ client_user_id: userId }, true, {
          stripe_customer_id: typeof s.customer === "string" ? s.customer : s.customer?.id || null,
          stripe_subscription_id: typeof s.subscription === "string" ? s.subscription : s.subscription?.id || null,
        });
        console.log("stripe-webhook: unlocked", userId);
        break;
      }

      // Cancelled, or Stripe gave up collecting. past_due stays unlocked —
      // a card that failed once is not somebody to lock out mid-programme.
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const paid = event.type !== "customer.subscription.deleted" && ACTIVE.has(sub.status);
        await setPaid({ stripe_subscription_id: sub.id }, paid);
        console.log("stripe-webhook: subscription", sub.id, sub.status, "-> paid", paid);
        break;
      }

      default:
        break;
    }
  } catch {
    // 500 so Stripe retries. The error is already logged above.
    return res.status(500).json({ error: "Could not record that" });
  }

  return res.status(200).json({ received: true });
}
