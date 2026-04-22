import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("./auth-client", () => ({
  authClient: { $fetch: fetchMock },
}));

// Import after vi.mock so the hook sees the mocked module.
const { useForgotPassword } = await import("./use-forgot-password");

describe("useForgotPassword", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("starts with submitted=false and no error", () => {
    const { result } = renderHook(() => useForgotPassword());
    expect(result.current.submitted).toBe(false);
    expect(result.current.formError).toBeNull();
  });

  it("flips submitted=true when the reset request succeeds", async () => {
    fetchMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useForgotPassword());
    act(() => {
      result.current.form.setFieldValue("email", "a@b.co");
    });
    await act(async () => {
      await result.current.form.handleSubmit();
    });
    await waitFor(() => expect(result.current.submitted).toBe(true));
    expect(result.current.formError).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/request-password-reset",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces server error without flipping submitted", async () => {
    fetchMock.mockResolvedValueOnce({ error: { message: "Rate limited" } });
    const { result } = renderHook(() => useForgotPassword());
    act(() => {
      result.current.form.setFieldValue("email", "a@b.co");
    });
    await act(async () => {
      await result.current.form.handleSubmit();
    });
    await waitFor(() => expect(result.current.formError).toBe("Rate limited"));
    expect(result.current.submitted).toBe(false);
  });

  it("falls back to a generic message when the error has no .message", async () => {
    fetchMock.mockResolvedValueOnce({ error: {} });
    const { result } = renderHook(() => useForgotPassword());
    act(() => {
      result.current.form.setFieldValue("email", "a@b.co");
    });
    await act(async () => {
      await result.current.form.handleSubmit();
    });
    await waitFor(() =>
      expect(result.current.formError).toBe("Failed to send reset email"),
    );
  });
});
