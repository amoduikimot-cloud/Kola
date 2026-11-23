# Kola WhatsApp templates

Businesses can only *start* a WhatsApp conversation with a **template** that Meta has approved.
Create each template below in **WhatsApp Manager → Message templates → Create template**:

- **Category:** Utility (these are order updates, not marketing)
- **Language:** English (`en`). If you choose another code, set `WHATSAPP_TEMPLATE_LANG` to match.
- **Name:** exactly as written. The code sends these names.
- **Variables** (`{{1}}`, `{{2}}` …) must stay in this order. The code fills them in this order.
- Meta asks for **sample values** when you submit; the examples below each template work.
- `*text*` makes text bold in WhatsApp.
- Replace `https://kola.link` with your real site address (the same as `NEXT_PUBLIC_SITE_URL`).

Approval usually takes from a few minutes to a day. Until a template is approved, sending it fails. The message is kept in the log and the daily job retries it, up to 3 tries.

---

## Buyer messages

### 1. `kola_payment_held`. Sent when payment is confirmed

**Header (text):** Payment received

**Body:**
```
Hi {{1}}, your payment of *{{2}}* to *{{3}}* is held safely by Kola.

The seller gets paid only after you receive your order.

Your delivery code: *{{4}}*
Give it to the rider only when you're holding the item and it's right.
```
Samples: `Ngozi` · `₦67,445` · `Tolu's Adire House` · `4821`

**Footer:** Never share the code before delivery

**Buttons:**
| # | Type | Text | URL |
|---|---|---|---|
| 1 | Visit website (dynamic) | Track my order | `https://kola.link/order/{{1}}` |
| 2 | Visit website (dynamic) | Something's wrong | `https://kola.link/order/{{1}}` |

Sample URL value: `3f9a2c1e-1111-4222-8333-444455556666/abc123`

---

### 2. `kola_order_shipped`. Sent when the seller marks it shipped

**Header (text):** Your order is on its way

**Body:**
```
Good news: {{1}} has shipped your order.
Tracking: {{2}}

When it arrives, check it first. If it's right, give the rider your code *{{3}}*.

If you don't respond, payment releases to the seller on {{4}}.
```
Samples: `Tolu's Adire House` · `ABK-48213` · `4821` · `Thu, 26 Nov, 8:00 am`

**Buttons:** the same two dynamic URL buttons as template 1.

---

### 3. `kola_arrival_check`. Sent by the daily job, up to 36 hours before auto-release

**Header (text):** Did your order arrive?

**Body:**
```
Hi {{1}}, has your order from {{2}} arrived?

Payment releases to the seller {{3}} unless you tell us there's a problem.
```
Samples: `Ngozi` · `Tolu's Adire House` · `on Thu, 26 Nov, 8:00 am`

**Buttons (Quick reply):** `Yes, it arrived` · `Not yet` · `Something's wrong`

What each reply does:
- **Yes, it arrived:** releases the payment straight away (same as the button on the order page).
- **Not yet:** holds the payment for 2 more days (once per order) and replies with the new time.
- **Something's wrong:** replies with a link to report the problem.

---

### 4. `kola_order_complete`. Sent when the order is released

**Header (text):** Order complete

**Body:**
```
Your order is complete. *{{1}}* has been released to {{2}}.

Thanks for buying safely with Kola. How was your order? Your rating helps other buyers find honest sellers.
```
Samples: `₦66,500` · `Tolu's Adire House`

**Buttons (Quick reply):** `Great` · `Okay` · `Not good` (saved as rating 5 / 3 / 1)

---

## Seller messages

### 5. `kola_new_order`. Sent when a buyer's payment is confirmed

**Header (text):** New paid order

**Body:**
```
New paid order from *{{1}}*:
{{2}}

*{{3}}* is held for you in escrow.

Deliver to: {{4}}
Phone: {{5}}

At handover, ask the buyer for their 4-digit delivery code and enter it to get paid immediately.
```
Samples: `Ngozi O.` · `1 × Indigo adire two-piece, 1 × Aso-oke gele` · `₦66,500` · `12 Adeola Odeku St, Victoria Island, Lagos` · `08031234567`

**Buttons:**
| # | Type | Text | URL |
|---|---|---|---|
| 1 | Visit website (static) | Mark as shipped | `https://kola.link/dashboard` |
| 2 | Visit website (static) | Enter delivery code | `https://kola.link/dashboard` |

---

### 6. `kola_payout_sent`. Sent when Paystack confirms the bank transfer

**Header (text):** You've been paid

**Body:**
```
You've been paid. *{{1}}* is on its way to {{2}} for order {{3}}.

Your trust score: *{{4}}* · {{5}} completed orders
Your auto-release time: *{{6}}*

Keep delivering well to keep your fast payouts.
```
Samples: `₦66,500` · `GTBank ••••1234` · `KOLA-3F9A` · `97` · `1,285` · `2 days`

**Button:** Visit website (static): `View my payouts` → `https://kola.link/dashboard`

---

### 7. `kola_dispute_opened`. Sent when a buyer reports a problem

**Header (text):** A buyer reported a problem

**Body:**
```
Your buyer {{1}} reported a problem with order {{2}}: {{3}}.
"{{4}}"

*{{5}}* for this order is frozen until it's settled.

Reply within 24 hours with photos or details so Kola can decide fairly. If you don't reply, the buyer may be refunded.
```
Samples: `Chidi A.` · `KOLA-7C21` · `not what was shown` · `The gele came in a different colour from the photo.` · `₦28,500`

**Buttons (in this order):**
1. Visit website (static): `Respond with photos` → `https://kola.link/dashboard`
2. Quick reply: `Offer a replacement`

---

## Notes

- **Seller name changes:** if a seller's display name has special characters, WhatsApp shows them as typed.
- **Delivery codes are not login codes.** Submit these as **Utility**, not Authentication. If Meta re-categorises one, appeal and explain that it's a delivery handover code.
- **Opt-in:** buyers get messages only if they tick the WhatsApp box at checkout. Sellers get them only after saving their number in the dashboard. That's what WhatsApp's rules require.
- **Free replies:** the short text replies Kola sends after a button tap (for example "No problem. We've held the payment…") don't need templates. WhatsApp allows free text for 24 hours after the person messages you.
