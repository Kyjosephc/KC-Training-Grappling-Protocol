# Taking payment automatically

Right now you mark people paid by hand. This replaces that: an athlete hits the
paywall, taps Pay, and the app unlocks itself about a second later. If they
cancel, it locks itself again.

Everything on this page is a one-time setup. Work through it in order — about
twenty minutes. Nothing is live until the last step.

---

## 1. Run the SQL

Supabase → SQL Editor → New query → paste all of
`STEP-9-RUN-THIS-IN-SUPABASE.sql` from your Downloads folder → Run.

It adds two columns so the webhook can find an athlete again when they cancel.

## 2. Make the Stripe account and the product

1. Go to stripe.com and create an account. You will need your bank details and
   some business information — this is the longest part, and the only part only
   you can do.
2. In the Stripe dashboard, **Product catalogue** → **Add product**.
   - Name: Strength Matrix
   - Price: **15.00 USD**, **Recurring**, **Monthly**
   - Save.
3. On that product, **Create payment link**.
   - Under *After payment*, choose **Redirect customers to your website** and
     enter `https://strength-matrix-kyjosephc.vercel.app`
   - Create the link, then copy it. It looks like `https://buy.stripe.com/aEU...`

## 3. Get your three keys

You need three secrets. Keep them somewhere safe and do not paste them into
anything public — any one of them is enough for someone to take money or read
every athlete's data.

| What | Where to find it |
|---|---|
| Stripe secret key | Stripe → Developers → API keys → **Secret key** (starts `sk_live_`) |
| Supabase URL | Supabase → Project Settings → API → Project URL |
| Supabase service role key | Supabase → Project Settings → API → **service_role** (NOT the anon key) |

The webhook secret comes in step 5.

## 4. Put them in Vercel

Vercel → your project → **Settings** → **Environment Variables**. Add each one
as **Secret** (not Plain), for **Production**:

```
STRIPE_SECRET_KEY            sk_live_...
SUPABASE_URL                 https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY    eyJ...
```

And one more, as **Plain**, because the browser needs to read it:

```
VITE_COACH_PAYMENT_LINK      https://buy.stripe.com/aEU...
```

> The service role key bypasses every security rule in your database. It belongs
> only in the three Secret variables above. It must never be given a name
> starting with `VITE_` — anything named that way is compiled into the public
> JavaScript and visible to anyone who opens the page.

## 5. Point Stripe at the webhook

1. Deploy first, so the endpoint exists: `git push`, and wait for Vercel to
   finish.
2. Stripe → **Developers** → **Webhooks** → **Add endpoint**.
3. Endpoint URL:
   `https://strength-matrix-kyjosephc.vercel.app/api/stripe-webhook`
4. Select these events and nothing else:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Add the endpoint, then copy its **Signing secret** (starts `whsec_`).
6. Back in Vercel, add it as a **Secret**:

```
STRIPE_WEBHOOK_SECRET        whsec_...
```

7. Redeploy so the new variable is picked up (Vercel → Deployments → the latest
   one → ⋯ → Redeploy).

## 6. Test it before you tell anyone

Use a real card and your own account — it is $15 and you can refund yourself.

1. Make a fresh signup with an email you control.
2. Log a week, then skip ahead to week 2 so the paywall appears.
3. Tap **Pay $15 and unlock**.
4. Pay. You should land back on the site, and within about a minute the paywall
   should be gone without you touching the Coach Dashboard.
5. Stripe → Developers → Webhooks → your endpoint. The event should be listed
   with a green **200**.
6. Refund yourself: Stripe → Payments → the payment → Refund. Then cancel the
   subscription (Stripe → Customers → your test customer → cancel). Within a
   minute that account should be locked again.

If step 4 does not unlock: open the webhook in Stripe and read the response.

| What it says | What it means |
|---|---|
| 400 Invalid signature | `STRIPE_WEBHOOK_SECRET` is wrong, or you did not redeploy after adding it |
| 500 Server is not configured | One of the four Secret variables is missing or misspelled |
| 200 but still locked | Check the Vercel function logs — probably "no athlete matched", meaning the payment did not carry the athlete's id. That happens if someone pays from the signup screen before their account exists; mark them paid by hand that once. |

---

## What happens after

- Someone pays → unlocked within seconds, no action from you.
- Someone cancels → locked at the end of the period they paid for.
- A card fails → they **stay unlocked** while Stripe retries. Only a genuine
  cancellation locks them out. Somebody mid-programme should not lose access
  over an expired card.
- You can still mark anyone paid by hand in the Coach Dashboard — for a friend,
  a comp, or anyone who pays you another way. That still works and the webhook
  will not undo it unless they had a Stripe subscription that then ended.

## Running it on test mode first

If you would rather not use a live card: flip the Stripe dashboard to **Test
mode** (top right), repeat steps 2-5 with the test keys (`sk_test_`, and a test
webhook secret), and pay with card number `4242 4242 4242 4242`, any future
expiry, any CVC. Remember to swap the keys back to live afterwards.
