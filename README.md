# Kola

One link to sell, get paid and build trust. Buyers pay into escrow and sellers get paid when the order arrives.

> "Kola" is a working name.

## What works today

| Page | What it does |
|---|---|
| `/` | Landing page |
| `/login` | Sign in with an email link (no password) |
| `/onboarding` | New sellers pick their link, like `kola.link/toluadire` |
| `/dashboard` | Copy your link, see your trust score, manage products and delivery fee, see orders, mark orders shipped |
| `/{handle}` | The public link page: buyers pick items and pay into escrow |
| `/order/{id}/{secret}` | The buyer's private order page: track it, release payment, or report a problem |

### How escrow works

```
Buyer pays on Paystack ──► order "held"  (seller sees it, can't get the money)
                           buyer gets a secret 4-digit delivery code
Seller clicks "Mark as shipped" ──► order "shipped"  (auto-release timer starts)
On delivery, buyer gives the code ──► seller enters it ──► "released" immediately
   or buyer clicks "I've received it" ──► "released"  (seller's completed orders +1)
   or "Something's wrong" ──► order "disputed"  (money frozen, Kola decides)
Nobody does anything ──► daily job releases it when the timer runs out

Order released ──► payout queued ──► Paystack transfer to the seller's bank ──► "Paid to your bank"
```

### Delivery code: sellers get paid on the spot

- Every order gets a random 4-digit code. Only the **buyer** can see it, on their order page. Sellers can't read it, and the database enforces this.
- The buyer gives it to the rider or seller **only when they're holding the item**. The seller types it in the dashboard and the money is released and paid out immediately.
- **After 5 wrong tries, code entry locks** for that order, so the code can't be guessed. The buyer can still confirm on their order page.

### Auto-release timer depends on trust

If nobody confirms, enters the code or disputes, the money releases automatically after:

| Seller | Waiting time after "shipped" |
|---|---|
| Fewer than 10 completed orders | 5 days |
| Trust score 60+ | 3 days |
| Trust score 85+ and no lost disputes | 48 hours |

The seller sees their current waiting time on the dashboard, which encourages them to build trust. The rules live in `autoReleaseHours()` in `src/lib/trust.ts`. The daily job runs once a day, so a release can happen up to a day after the timer ends. Run the job more often (for example hourly, on a paid Vercel plan) for tighter timing.

### How seller payouts work

- The seller adds their bank and 10-digit account number in the dashboard. Kola checks the **account name with Paystack** before saving and keeps only the last 4 digits.
- When an order is released, a payout of **item price + delivery** is queued. Kola keeps the buyer-protection fee. The payout is sent straight away if the seller has a bank account. Otherwise it waits until they add one.
- **It can't be paid twice:** there's one payout per order (enforced by the database) and one Paystack reference per attempt, and Paystack refuses a repeated reference.
- **If the outcome is unclear** (for example a network error), the payout stays "sending" and the daily job checks it with Paystack. A new attempt starts only after Paystack says the transfer failed and the seller updates their bank details.
- Paystack's webhook updates payouts to **"Paid to your bank"** or **"Payout failed"**.

- **Prices are always worked out on the server.** The browser only sends which items and how many.
- **A payment counts only when Paystack confirms it**, through the webhook or a direct check when the buyer returns. The amount must match the order exactly.
- **Each step changes an order only from the expected status**, so double clicks or repeated webhooks can't release money twice.
- **Buyers don't need an account.** Their order link contains a secret token, and only a hash of it is stored.

### WhatsApp messages

Kola sends order updates on WhatsApp (Meta's WhatsApp Business Cloud API):

| When | To | Message |
|---|---|---|
| Payment confirmed | Buyer | Payment held + **delivery code** + order link |
| Payment confirmed | Seller | New paid order, address, "ask for the code" |
| Seller marks shipped | Buyer | Tracking, code reminder, auto-release time |
| Up to 36h before auto-release | Buyer | "Did your order arrive?" with **Yes / Not yet / Something's wrong** buttons |
| Order released | Buyer | Order complete + **Great / Okay / Not good** rating buttons |
| Payout confirmed by Paystack | Seller | You've been paid, trust score, auto-release time |
| Buyer opens a dispute | Seller | The complaint + **Offer a replacement** button |

- **Opt-in only:** buyers tick a box at checkout; sellers save their number in the dashboard.
- **Reply buttons work:** "Yes, it arrived" releases the payment, "Not yet" holds it for 2 more days (once per order), and ratings are saved. Kola only acts if the tap comes from the buyer's or seller's own number.
- **Never sent twice:** each message is logged once per order. Failed sends are retried by the daily job (up to 3 tries).
- **Never blocks payments:** if WhatsApp is down or not set up, orders and payouts carry on normally.
- The exact wording to submit to Meta is in **`docs/whatsapp-templates.md`**.

### Not built yet

- **Refunds and dispute decisions.** For now an admin handles them by hand in Paystack and the Supabase table editor.
- **Telling the seller when a buyer taps "Not yet"**, and acting on "Offer a replacement". Kola records it, and an admin follows up for now.

## Run it on your computer

You need Node.js 20 or newer.

```powershell
npm install
npm run dev
```

Open http://localhost:3000.

**Demo mode:** until the keys below are set, the app shows sample data. Try http://localhost:3000/toluadire. You can fill the basket, but paying and signing in are switched off.

## Set up the keys

### 1. Supabase (database and sign-in)

1. Create a free account and project at https://supabase.com. Pick a region close to Nigeria. Europe (for example Frankfurt or London) is usually the fastest option.
2. Open **SQL Editor → New query**, paste everything from `supabase/migrations/0001_init.sql`, and click **Run**. Then do the same with `0002_escrow.sql`, `0003_payouts.sql`, `0004_delivery_code.sql` and `0005_whatsapp.sql`, in that order.
3. Open **Project Settings → API** and copy the **Project URL**, the **anon public** key and the **service_role** key.
4. In this folder, copy `.env.example` to a new file called `.env.local` and paste the values in. The service_role key is a master key: never share it or commit it.
5. Open **Authentication → URL Configuration** and add `http://localhost:3000/auth/callback` to **Redirect URLs**.

> Supabase's built-in email sender only sends a few emails per hour. Before launch, connect a real email provider (for example Resend) under **Authentication → Emails → SMTP settings**.

### 2. Paystack (payments): use test mode

1. Create an account at https://paystack.com. You can use test mode before your business is verified.
2. Open **Settings → API Keys & Webhooks** and copy the **Test Secret Key** (`sk_test_...`) into `PAYSTACK_SECRET_KEY` in `.env.local`.
3. Pay with Paystack's test cards, listed in their docs under "Test Payments". No real money moves.
4. **Payouts (Transfers):**
   - Paystack must enable Transfers on your account. On live accounts this needs a verified business.
   - Under **Settings → Preferences**, turn **off OTP for transfers**. Otherwise every payout waits for a code, and the dashboard says so.
   - Payouts come from your Paystack balance, so money from buyers must have settled there first.
   - Paystack charges a small fee per transfer, which comes out of Kola's margin.
   - In test mode, use the test bank account details from Paystack's docs ("Test Payments"). Resolving real account numbers may not work in test mode.
5. **Webhook:** Paystack can't reach `localhost`. While testing locally, the order page checks the payment directly when the buyer returns from Paystack, so local testing still works. After deploying, set the **Test Webhook URL** to `https://your-site/api/paystack/webhook`.

### 3. WhatsApp (optional: leave the keys empty to switch it off)

1. Create an app at https://developers.facebook.com, add the **WhatsApp** product, and connect a phone number for Kola. Meta gives you a free test number to start with.
2. From **WhatsApp → API Setup**, copy the **access token** into `WHATSAPP_TOKEN` and the **Phone number ID** into `WHATSAPP_PHONE_NUMBER_ID`. Use a **permanent System User token** (Business Settings → System users), because the token on the setup page expires after 24 hours.
3. From **App settings → Basic**, copy the **App secret** into `WHATSAPP_APP_SECRET`. Make up any `WHATSAPP_VERIFY_TOKEN`.
4. Set `ORDER_LINK_SECRET` to a long random string. Messages need it to include the buyer's order link.
5. Create the 7 message templates exactly as written in `docs/whatsapp-templates.md` and wait for approval.
6. **Webhook** (for the reply buttons): in **WhatsApp → Configuration**, set the callback URL to `https://your-site/api/whatsapp/webhook`, enter your verify token, and subscribe to **messages**. Like Paystack, this needs a public address, so it works after deploying. Locally, messages still send, but button taps won't reach your computer.
7. While testing with Meta's test number, add your own phone as an allowed recipient in **API Setup**.

### 4. Restart

Stop the dev server (Ctrl+C) and run `npm run dev` again.

### Try the full flow

1. Go to `/login`, sign in, create your link, set a delivery fee, add your payout bank account and add a product.
2. Open your link in a private/incognito window and buy the product with a Paystack test card.
3. You land on the order page and it shows **"Paid · money held"**.
4. In your dashboard, the order appears. Click **Mark as shipped**.
5. Copy the 4-digit **delivery code** from the order page, enter it next to the order in your dashboard, and click **Release payment**. Alternatively, on the order page, click **"I've received it"**. Your completed-orders count goes up and the payout is sent. The dashboard shows it under **Payouts**, and the order changes to "Paid to your bank" once Paystack confirms. Locally, without the webhook, that confirmation is picked up by the daily job. You can also run the job by hand:

```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/cron/auto-release -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } -UseBasicParsing
```
(Set `$env:CRON_SECRET` to the same value as in `.env.local` first.)

## Deploying (Vercel)

1. Push this folder to a GitHub repository and import it at https://vercel.com.
2. Add the same environment variables. Set `NEXT_PUBLIC_SITE_URL` to your real address, and set `CRON_SECRET` to a long random string.
3. Add `https://your-site/auth/callback` to the Supabase redirect URLs, set the webhook URL in Paystack, and set the WhatsApp webhook URL in Meta.
4. `vercel.json` runs the auto-release job once a day at 07:00 UTC, which is 08:00 in Lagos. Vercel's free plan allows daily cron jobs.

## How the code is organised

```
src/
  app/
    page.tsx                      landing page
    [handle]/page.tsx, cart.tsx   seller link page + basket/checkout
    [handle]/actions.ts           creates the order and starts the Paystack payment
    order/[id]/[token]/           buyer's private order page: confirm or dispute
    api/paystack/webhook/         Paystack tells us a payment succeeded
    api/cron/auto-release/        daily job: auto-release, payouts, WhatsApp reminders and retries
    api/whatsapp/webhook/         WhatsApp reply-button taps
    login/, auth/callback/        email sign-in
    onboarding/                   choose your link
    dashboard/                    seller dashboard, orders, shipping
  components/                     shared UI
  lib/
    money.ts                      naira/kobo helpers and buyer-protection fee
    orders.ts                     order tokens, "mark paid", status labels
    paystack.ts                   Paystack API (payments, banks, transfers) + webhook signature check
    payouts.ts                    seller payout engine (send, retry, reconcile)
    banks.ts                      cached list of Nigerian banks
    whatsapp.ts                   WhatsApp API: send, phone numbers, webhook signature check
    notify.ts                     which WhatsApp message goes out at each order event
    whatsapp-replies.ts           what happens when someone taps a reply button
    order-links.ts                builds buyers' private order links
    release.ts                    what happens after any release (payout + message)
    trust.ts                      trust score formula
    data.ts                       database reads (plus demo data)
    supabase/                     Supabase clients (admin.ts = server-only master key)
  proxy.ts                        keeps sellers signed in
supabase/migrations/              database tables, security rules, escrow functions
```

## Rules this code follows

- **Money is stored in kobo** (whole numbers). Never store naira as decimals.
- **Sellers can't edit their own trust numbers or move order money.** Only server code can, and the database enforces it.
- **Never trust the browser about prices or payments.** Prices come from the database and payments are confirmed with Paystack.

## Next build steps

1. **Admin dispute screen:** refund or release, with photo uploads from the buyer.
2. **SMS fallback** (for example Termii) for buyers without WhatsApp.
3. **ID verification:** NIN/BVN via a KYC provider, which sets `id_verified`.

**Before taking real money**, talk to a fintech lawyer about CBN rules for holding customer funds, and confirm with Paystack how long funds may sit in your balance before payout.
