export type Profile = {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  location: string | null;
  id_verified: boolean;
  completed_orders: number;
  disputes_total: number;
  disputes_lost: number;
  delivery_fee_kobo: number;
  created_at: string;
};

export type Product = {
  id: string;
  seller_id: string;
  name: string;
  description: string | null;
  price_kobo: number;
  active: boolean;
  created_at: string;
};

export type OrderStatus = "pending_payment" | "held" | "shipped" | "delivered" | "released" | "disputed" | "refunded";

export type OrderItem = { product_id: string; name: string; price_kobo: number; qty: number };

export type Order = {
  id: string;
  seller_id: string;
  buyer_name: string;
  buyer_email: string | null;
  buyer_phone: string | null;
  buyer_address: string | null;
  items: OrderItem[];
  subtotal_kobo: number;
  delivery_kobo: number;
  fee_kobo: number;
  total_kobo: number;
  status: OrderStatus;
  payment_ref: string | null;
  tracking_number: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  released_at: string | null;
  auto_release_at: string | null;
  dispute_reason: string | null;
  dispute_details: string | null;
  disputed_at: string | null;
  created_at: string;
};

/** Columns safe to select for orders (never the buyer's token hash). */
export const ORDER_COLUMNS =
  "id, seller_id, buyer_name, buyer_email, buyer_phone, buyer_address, items, subtotal_kobo, delivery_kobo, fee_kobo, total_kobo, status, payment_ref, tracking_number, paid_at, shipped_at, released_at, auto_release_at, dispute_reason, dispute_details, disputed_at, created_at";
