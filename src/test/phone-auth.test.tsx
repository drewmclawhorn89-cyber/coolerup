import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const sendFirebasePhoneCodeMock = vi.fn();
const confirmFirebasePhoneCodeMock = vi.fn();
const clearFirebaseRecaptchaMock = vi.fn();

vi.mock("@/lib/firebase", () => ({
  sendFirebasePhoneCode: (...args: unknown[]) => sendFirebasePhoneCodeMock(...args),
  confirmFirebasePhoneCode: (...args: unknown[]) => confirmFirebasePhoneCodeMock(...args),
  clearFirebaseRecaptcha: (...args: unknown[]) => clearFirebaseRecaptchaMock(...args),
  onFirebasePhoneUserChange: () => () => {},
  signOutFirebasePhone: vi.fn(),
  getFirebaseConfigSummary: () => ({
    configured: true,
    projectId: "coolerup",
    authDomain: "coolerup.firebaseapp.com",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("PhoneAuthForm", () => {
  const fakeConfirmation = { verificationId: "verif-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    if (!document.elementFromPoint) {
      document.elementFromPoint = () => null;
    }
    sendFirebasePhoneCodeMock.mockResolvedValue({ confirmation: fakeConfirmation });
    confirmFirebasePhoneCodeMock.mockResolvedValue({
      user: { uid: "fb-user-1", phoneNumber: "+15551234567" },
    });
  });

  it("sends Firebase SMS code with normalized E.164 phone and verifies only once on 6 digits", async () => {
    const { PhoneAuthForm } = await import("@/components/PhoneAuthDialog");
    const onSuccess = vi.fn();

    render(<PhoneAuthForm onSuccess={onSuccess} />);

    const phoneInput = screen.getByLabelText(/Phone number/i);
    fireEvent.change(phoneInput, { target: { value: "+1+1 (555) 123-4567" } });
    expect((phoneInput as HTMLInputElement).value).toBe("+1 (555) 123-4567");

    fireEvent.click(screen.getByRole("button", { name: /Send Code/i }));

    await waitFor(() => {
      expect(sendFirebasePhoneCodeMock).toHaveBeenCalledWith(
        "+15551234567",
        expect.any(HTMLElement),
      );
    });

    const otpInput = await screen.findByLabelText(/Verification code/i);
    fireEvent.change(otpInput, { target: { value: "123456" } });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    expect(confirmFirebasePhoneCodeMock).toHaveBeenCalledTimes(1);
    expect(confirmFirebasePhoneCodeMock).toHaveBeenCalledWith(fakeConfirmation, "123456");
  });

  it("shows the exact daily SMS quota message without crashing when Firebase hits the free limit", async () => {
    sendFirebasePhoneCodeMock.mockResolvedValue({
      error: { code: "auth/quota-exceeded", message: "SMS quota exceeded" },
    });

    const { PhoneAuthForm } = await import("@/components/PhoneAuthDialog");
    const onSuccess = vi.fn();

    render(<PhoneAuthForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/Phone number/i), {
      target: { value: "+15551234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send Code/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Free daily text limit reached — please use Google or Email for now, phone texts reset tomorrow",
    );
    expect(alert.textContent?.toLowerCase()).not.toContain("twilio");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("shows an inline alert without looping when verification fails", async () => {
    confirmFirebasePhoneCodeMock.mockResolvedValue({
      error: { code: "auth/invalid-verification-code", message: "Invalid verification code" },
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
    expect(alert.textContent).toContain("Wrong code");
    expect(confirmFirebasePhoneCodeMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
