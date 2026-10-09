# Taking real money

Everything you built and tested works. This swaps it from Stripe's sandbox to
the real thing. Nothing you did in the sandbox carries over — the product, the
payment link and the webhook all have to be made again in live mode. That is
normal and it is the same three screens you already did once.

Work through it in order. About thirty minutes, most of it waiting on Stripe.

---

## Part 1 — Activate the account

In Stripe, click **Verify your business** (the button in the blue bar at the
top) or **Activate payments**.

Stripe will ask for:

- Your legal name and date of birth
- Your home address
- Your **SSN** (or the last 4, then possibly the full number)
- What the business does — say personal training / fitness coaching, and
  describe it as an online strength and conditioning program
- Your **business type** — if you have not set up an LLC, choose
  **Individual / Sole proprietor**. That is normal and completely fine.
- A **bank account** — routing number and account number. This is where your
  money lands.

Stripe usually approves within a few minutes, sometimes a day. You cannot take
real payments until it does.

> Use your own real details. Do not let anyone else — me included — enter these
> for you.

## Part 2 — Leave the sandbox

Top left of Stripe, where it says **Sandbox** / **Test mode**, click it and
switch to your live account. The blue sandbox bar at the top should disappear.

Everything below happens in live mode. If you still see the sandbox bar, stop —
you will build it all in the wrong place again.

## Part 3 — Make the product again, in live

1. **Product catalog** → **Create product**
2. Name: `Strength Matrix`
3. Price: `15.00` USD, **One-off** — not recurring. They pay once and keep it.
4. Save.
5. On the product page → **Create payment link**
6. Under **After payment** → **Redirect customers to your website**:
   ```
   https://strength-matrix-kyjosephc.vercel.app
   ```
7. Create it and copy the link. A live one starts `https://buy.stripe.com/`
   with **no** `test_` in it.

## Part 4 — Make the webhook again, in live

1. **Developers** (bottom left) → **Webhooks** → **Add endpoint**
2. URL:
   ```
   https://strength-matrix-kyjosephc.vercel.app/api/stripe-webhook
   ```
3. Events — the same three:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Name it `Strength Matrix app`
5. Create it, then reveal and copy the **Signing secret** (`whsec_...`).
   This is a different secret from your sandbox one.

## Part 5 — Swap three values in Vercel

Vercel → your project → **Settings** → **Environment Variables**. **Edit** each
of these three. Leave everything else alone.

| Variable | New value |
|---|---|
| `VITE_COACH_PAYMENT_LINK` | the live `buy.stripe.com/...` link from Part 3 |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Secret key. Starts **`sk_live_`** |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_...` from Part 4 |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` do not change.

Then **Deployments** → newest → **···** → **Redeploy**.

## Part 6 — Test it with your own card, then refund yourself

Do not skip this. It is $15 and you get it back.

1. Private window → your site → sign up with an email you control
2. Skip ahead to week 2 so the paywall shows
3. **Pay $15 once and unlock** — use your real card
4. The paywall should clear on its own within a minute
5. Stripe → Developers → Webhooks → your endpoint → **Event deliveries** →
   `checkout.session.completed` should show **200**
6. Refund yourself: Stripe → **Payments** → click the payment → **Refund**

A refund does not re-lock the athlete. If you ever need to lock someone out,
set them to unpaid in the Coach Dashboard.

---

## Getting the money into your bank

Stripe does this on its own once your bank account is connected. You do not
have to "cash out" — it pushes the money to you.

**The first one takes a while.** After your first real payment, Stripe
typically schedules the first payout to land within **7–14 days**. That delay
is a one-off; it is Stripe making sure a new account is legitimate.

**After that** it runs on a schedule, usually every couple of business days.
You can see every payout and its expected date under **Balances** in the left
sidebar.

**To change how often you get paid** — daily, weekly, monthly, or on demand —
go to **Settings** → **Payouts** (or Balances → Payout settings). If you switch
to manual, you press a button when you want the money rather than waiting.

### What you actually keep

Stripe currently charges **2.9% + 30¢** per successful card payment in the US,
with no monthly fee and no setup fee.

On a $15 sale:

```
$15.00  what they pay
-$0.74  Stripe's cut (2.9% = $0.44, plus 30¢)
-------
$14.26  what reaches your bank
```

Ten clients is about $142. A hundred is about $1,426.

Check the current rate on your own dashboard before you rely on these numbers —
fees change and yours may differ.

### One thing worth saying

This is business income. Stripe will issue you a 1099-K if you cross the
reporting threshold, and the income is taxable whether or not you get one. Keep
your Stripe records, and it is worth twenty minutes with an accountant before
this gets big. I am not one.
