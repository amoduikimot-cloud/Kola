import { NextResponse, type NextRequest } from "next/server";
import { extractReplies, isValidMetaSignature } from "@/lib/whatsapp";
import { handleReply } from "@/lib/whatsapp-replies";

/**
 * WhatsApp webhook. Set it in Meta: WhatsApp → Configuration → Webhook
 *   Callback URL: https://<your-site>/api/whatsapp/webhook
 *   Verify token: the same value as WHATSAPP_VERIFY_TOKEN
 *   Subscribe to: messages
 */

// Meta checks the URL once when you save it.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

// Incoming messages: we only act on taps of our reply buttons.
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!isValidMetaSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  for (const reply of extractReplies(body)) {
    try {
      await handleReply(reply.from, reply.payload);
    } catch (e) {
      console.error("[whatsapp webhook] reply failed", reply.messageId, e);
    }
  }
  // Always 200 so Meta doesn't keep resending.
  return NextResponse.json({ received: true });
}
