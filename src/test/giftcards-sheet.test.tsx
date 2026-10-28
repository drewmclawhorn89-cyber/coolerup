import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { email: "buyer@example.com" } } }) } },
}));

vi.mock("@/lib/googlepay", () => ({
  HAS_STRIPE: false,
  googlePayDiagnose: async () => ({ ready: false, reason: "no-api" }),
  requestGooglePay: async () => ({ ok: false, reason: "cancelled" }),
}));

vi.mock("@/lib/giftcards.functions", () => ({
  giftCardStatus: async () => ({ providerConfigured: false, stripeConfigured: false }),
  purchaseGiftCard: async () => ({ ok: false, message: "not used" }),
  reserveGiftCardOrder: async () => ({ ok: false, message: "not used" }),
}));

import { GiftCardSheet } from "@/components/GiftCardSheet";
import { giftCardById } from "@/lib/giftcards";

/**
 * The checkout sheet is the money path, so it must show the real denominations
 * from the catalogue and a total that matches the server-side price.
 */
describe("GiftCardSheet", () => {
  it("shows the retailer's denominations and the total", async () => {
    const amazon = giftCardById("amazon")!;
    render(<GiftCardSheet card={amazon} handle="drew" onClose={() => {}} />);

    expect(await screen.findByText("Amazon gift card")).toBeInTheDocument();
    // Every denomination Amazon sells is offered.
    [10, 25, 50, 100, 200].forEach((amount) => {
      expect(screen.getByRole("button", { name: `$${amount}` })).toBeInTheDocument();
    });
    // Default amount is the second denomination (25) and is charged in full.
    expect(screen.getByText("Total today")).toBeInTheDocument();
    expect(screen.getAllByText("$25.00").length).toBeGreaterThan(0);
  });

  it("renders nothing when no card is selected", () => {
    const { container } = render(<GiftCardSheet card={null} handle="drew" onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
