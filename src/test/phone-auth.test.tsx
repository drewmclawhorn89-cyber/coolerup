import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const signInWithOtpMock = vi.fn();
const verifyOtpMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => signInWithOtpMock(...args),
      verifyOtp: (...args: unknown[]) => verifyOtpMock(...args),
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("PhoneAuthForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!document.elementFromPoint) {
      document.elementFromPoint = () => null;
    }
    signInWithOtpMock.mockResolvedValue({ error: null });
    verifyOtpMock.mockResolvedValue({
      data: { session: { access_token: "tok" } },
      error: null,
    });
    getSessionMock.mockResolvedValue({ data: { session: null } });
  });

  it("sends OTP with normalized E.164 phone and verifies only once on 6 digits", async () => {
    const { PhoneAuthForm } = await import("@/components/PhoneAuthDialog");
    const onSuccess = vi.fn();

    render(<PhoneAuthForm onSuccess={onSuccess} />);

    const phoneInput = screen.getByLabelText(/Phone number/i);
    fireEvent.change(phoneInput, { target: { value: "+1+1 (555) 123-4567" } });
    expect((phoneInput as HTMLInputElement).value).toBe("+1 (555) 123-4567");

    fireEvent.click(screen.getByRole("button", { name: /Send Code/i }));

    await waitFor(() => {
      expect(signInWithOtpMock).toHaveBeenCalledWith({
        phone: "+15551234567",
        options: { shouldCreateUser: true },
      });
    });

    const otpInput = await screen.findByLabelText(/Verification code/i);
    fireEvent.change(otpInput, { target: { value: "123456" } });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
    expect(verifyOtpMock).toHaveBeenCalledWith({
      phone: "+15551234567",
      token: "123456",
      type: "sms",
    });
  });

  it("shows an inline alert without looping when OTP verification fails", async () => {
    verifyOtpMock.mockResolvedValue({
      data: { session: null },
      error: { message: "Token has expired or is invalid" },
    });

    const { PhoneAuthForm } = await import("@/components/PhoneAuthDialog");
    const onSuccess = vi.fn();

    render(<PhoneAuthForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/Phone number/i), {
      target: { value: "+15551234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send Code/i }));

    const otpInput = await screen.findByLabelText(/Verification code/i);
    fireEvent.change(otpInput, { target: { value: "654321" } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("wrong or expired");
    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
