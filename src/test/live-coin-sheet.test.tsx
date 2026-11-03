import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createCoinVenmoOrder: vi.fn(async () => ({
    ok: true as const,
    orderId: "order-1",
    referenceCode: "CU-ABC234",
    amountCents: 99,
    amountUsd: "0.99",
    note: "Coolerup coins CU-ABC234",
    recipient: "Samantha-Barnes-168",
    venmoUrl: "https://venmo.com/?txn=pay",
    appUrl: "venmo://paycharge",
  })),
}));

vi.mock("@/lib/coins.functions", () => ({
  coinPaymentStatus: async () => ({
    stripeConfigured: false,
    venmoConfigured: true,
    venmoRecipient: "Samantha-Barnes-168",
    packs: [],
  }),
  createCoinVenmoOrder: mocks.createCoinVenmoOrder,
  createCoinCheckout: async () => ({ ok: false, message: "not used" }),
}));

import { LiveCoinSheet } from "@/components/LiveCoinSheet";

/**
 * Buying coins inside a LIVE stream must start a real Venmo order without
 * navigating away, so the buyer can keep watching while they pay.
 */
describe("LiveCoinSheet", () => {
  beforeEach(() => {
    mocks.createCoinVenmoOrder.mockClear();
  });

  it("starts a Venmo order for the chosen pack", async () => {
    const onOrderCreated = vi.fn();
    render(
      <LiveCoinSheet
        open
        onOpenChange={() => {}}
        balance={100}
        signedIn
        onOrderCreated={onOrderCreated}
        onSignIn={() => {}}
      />,
    );

    const pack = await screen.findByRole("button", { name: /100 coins/i });
    await waitFor(() => expect(pack).toBeEnabled());
    fireEvent.click(pack);

    await waitFor(() =>
      expect(mocks.createCoinVenmoOrder).toHaveBeenCalledWith({ data: { packId: "coins-100" } }),
    );
    expect(onOrderCreated).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, referenceCode: "CU-ABC234" }),
    );
  });

  it("asks a signed-out viewer to sign in instead of buying", async () => {
    const onSignIn = vi.fn();
    render(
      <LiveCoinSheet
        open
        onOpenChange={() => {}}
        balance={null}
        signedIn={false}
        onOrderCreated={() => {}}
        onSignIn={onSignIn}
      />,
    );

    const pack = await screen.findByRole("button", { name: /500 coins/i });
    await waitFor(() => expect(pack).toBeEnabled());
    fireEvent.click(pack);

    expect(onSignIn).toHaveBeenCalled();
    expect(mocks.createCoinVenmoOrder).not.toHaveBeenCalled();
  });
});
