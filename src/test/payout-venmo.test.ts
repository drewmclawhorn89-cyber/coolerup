import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: rpcMock },
}));

import { myWallet, requestPayout, setMyVenmoHandle } from "@/lib/payouts";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("one-tap cashouts", () => {
  it("asks for the whole balance with no arguments", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, amount: 12.5, destination: "drew", diamonds: 1250 },
      error: null,
    });

    const result = await requestPayout();

    expect(result.ok).toBe(true);
    expect(result.amount).toBe(12.5);
    expect(result.destination).toBe("drew");
    expect(rpcMock).toHaveBeenCalledWith("request_payout", {
      p_amount: null,
      p_method: "venmo",
      p_destination: null,
    });
  });

  it("sends a typed handle through without a popup", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, amount: 10, destination: "drew" }, error: null });

    await requestPayout({ destination: "@Drew" });

    expect(rpcMock).toHaveBeenCalledWith("request_payout", {
      p_amount: null,
      p_method: "venmo",
      p_destination: "Drew",
    });
  });

  it("rejects a handle that cannot be a Venmo username before calling the database", async () => {
    const result = await requestPayout({ destination: "no spaces allowed" });

    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("explains a missing handle in words a creator can act on", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, error: "venmo_handle_required" }, error: null });

    const result = await requestPayout();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Add your Venmo username first");
  });

  it("explains the minimum", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, error: "below_minimum" }, error: null });

    const result = await requestPayout({ amount: 2 });

    expect(result.error).toBe("The minimum cashout is $10.00");
  });
});

describe("saving a creator's own Venmo", () => {
  it("stores a valid handle", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, venmoHandle: "drew-mc" }, error: null });

    const result = await setMyVenmoHandle("@drew-mc");

    expect(result).toEqual({ ok: true, venmoHandle: "drew-mc" });
    expect(rpcMock).toHaveBeenCalledWith("set_my_venmo_handle", { p_handle: "@drew-mc" });
  });

  it("refuses an invalid handle locally", async () => {
    const result = await setMyVenmoHandle("a b");

    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("wallet handle", () => {
  it("reads the saved handle so the page can show where money goes", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, diamonds: 0, realBalance: 0, cashable: 0, venmoHandle: "drew" },
      error: null,
    });

    const wallet = await myWallet();

    expect(wallet.venmoHandle).toBe("drew");
  });

  it("falls back to no handle when the migration is missing", async () => {
    rpcMock.mockRejectedValue(new Error("function does not exist"));

    const wallet = await myWallet();

    expect(wallet.venmoHandle).toBeNull();
    expect(wallet.cashable).toBe(0);
  });
});
