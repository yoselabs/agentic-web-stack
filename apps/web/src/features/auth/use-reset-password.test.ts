import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resetPasswordMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("./auth-client", () => ({
  authClient: { resetPassword: resetPasswordMock },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

const { useResetPassword } = await import("./use-reset-password");

describe("useResetPassword", () => {
  beforeEach(() => {
    resetPasswordMock.mockReset();
    navigateMock.mockReset();
  });

  it("starts with no error", () => {
    const { result } = renderHook(() => useResetPassword("tok"));
    expect(result.current.formError).toBeNull();
  });

  it("navigates to /login on successful reset", async () => {
    resetPasswordMock.mockResolvedValueOnce({ error: null });
    navigateMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useResetPassword("tok"));
    act(() => {
      result.current.form.setFieldValue("newPassword", "hunter2password");
    });
    await act(async () => {
      await result.current.form.handleSubmit();
    });
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: "/login" }),
    );
    expect(resetPasswordMock).toHaveBeenCalledWith({
      newPassword: "hunter2password",
      token: "tok",
    });
    expect(result.current.formError).toBeNull();
  });

  it("surfaces server error and does not navigate", async () => {
    resetPasswordMock.mockResolvedValueOnce({
      error: { message: "Token expired" },
    });
    const { result } = renderHook(() => useResetPassword("tok"));
    act(() => {
      result.current.form.setFieldValue("newPassword", "hunter2password");
    });
    await act(async () => {
      await result.current.form.handleSubmit();
    });
    await waitFor(() => expect(result.current.formError).toBe("Token expired"));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
