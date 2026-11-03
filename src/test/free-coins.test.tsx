import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  myFreeCoinClaim: vi.fn(
    async (): Promise<{ claimed: boolean; coins?: number; nextClaimAt?: string }> => ({
      claimed: false,
    }),
  ),
  claimFreeCoins: vi.fn(async () => ({
    ok: true as const,
    coins: 10,
    balance: 42,
    nextClaimAt: new Date(Date.now() + 3_600_000).toISOString(),
  })),
  setBalance: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, signIn: vi.fn() }),
}));

vi.mock("@/lib/coins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/coins")>();
  return {
    ...actual,
    useCoins: () => ({
      balance: 32,
      diamonds: 0,
      totalEarned: 0,
      loading: false,
      refresh: vi.fn(),
      setBalance: mocks.setBalance,
    }),
    myFreeCoinClaim: mocks.myFreeCoinClaim,
    claimFreeCoins: mocks.claimFreeCoins,
  };
});

import { VenmoFreeCoins } from "@/components/VenmoFreeCoins";
import { claimAgo, formatCountdown, freeCoinStats, msUntil } from "@/lib/coins";

describe("free coin helpers", () => {
  it("formats countdowns", () => {
    expect(formatCountdown(0)).toBe("00m 00s");
    expect(formatCountdown(63_000)).toBe("01m 03s");
    expect(formatCountdown(3_723_000)).toBe("1h 02m 03s");
  });

  it("clamps negative time to zero", () => {
    expect(msUntil("2020-01-01T00:00:00Z", Date.now())).toBe(0);
  });

  it("rolls claims into today/all-time stats and top claimers", () => {
    const now = new Date("2026-05-10T12:00:00Z");
    const rows = [
      {
        id: "1",
        user_id: "a",
        username: "maya",
        claimed_at: "2026-05-10T09:00:00Z",
        venmo_clicked: true,
        coins_given: 10,
      },
      {
        id: "2",
        user_id: "a",
        username: "maya",
        claimed_at: "2026-05-09T09:00:00Z",
        venmo_clicked: true,
        coins_given: 10,
      },
      {
        id: "3",
        user_id: "b",
        username: "drew",
        claimed_at: "2026-05-10T10:00:00Z",
        venmo_clicked: true,
        coins_given: 10,
      },
    ];
    const stats = freeCoinStats(rows, now);
    expect(stats.todayCount).toBe(2);
    expect(stats.todayCoins).toBe(20);
    expect(stats.totalCount).toBe(3);
    expect(stats.topClaimers[0]).toMatchObject({ name: "maya", claims: 2, coins: 20 });
  });

  it("describes claim age", () => {
    const now = Date.parse("2026-05-10T12:00:00Z");
    expect(claimAgo("2026-05-10T11:59:40Z", now)).toBe("just now");
    expect(claimAgo("2026-05-10T11:56:00Z", now)).toBe("4m ago");
    expect(claimAgo("2026-05-10T10:00:00Z", now)).toBe("2h ago");
  });
});

describe("VenmoFreeCoins", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
    mocks.myFreeCoinClaim.mockClear();
    mocks.claimFreeCoins.mockClear();
    mocks.setBalance.mockClear();
    mocks.myFreeCoinClaim.mockResolvedValue({ claimed: false });
  });

  it("shows the free coins button and claims after confirming", async () => {
    render(<VenmoFreeCoins />);

    const button = await screen.findByRole("button", { name: /Get 10 Free Coins via Venmo/i });
    fireEvent.click(button);

    expect(await screen.findByText(/Did you open Venmo\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm \+10/i }));

    await waitFor(() => expect(mocks.claimFreeCoins).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.setBalance).toHaveBeenCalledWith(42));
  });

  it("shows a countdown when today's claim is already used", async () => {
    mocks.myFreeCoinClaim.mockResolvedValue({
      claimed: true,
      coins: 10,
      nextClaimAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    render(<VenmoFreeCoins />);

    expect(await screen.findByRole("button", { name: /Next free coins in/i })).toBeDisabled();
  });
});
