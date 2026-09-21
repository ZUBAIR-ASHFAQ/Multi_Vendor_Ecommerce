import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationDialog } from "@/components/feedback/confirmation-dialog";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";

describe("feedback primitives", () => {
  it("renders an accessible loading state", () => {
    render(<LoadingState label="Loading products" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading products");
  });

  it("renders a safe error with request reference", () => {
    render(<ErrorState message="Could not load." requestId="req-123" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load.");
    expect(screen.getByRole("alert")).toHaveTextContent("Technical reference: req-123");
  });

  it("renders content-shaped skeleton loading states with one accessible status", () => {
    render(<LoadingState label="Loading queue" variant="table" count={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading queue");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("requires an explicit confirmation before a destructive action", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmationDialog
        open
        title="Delete record?"
        description="This cannot be undone."
        confirmLabel="Confirm delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const user = userEvent.setup();
    const dialog = screen.getByRole("alertdialog", { name: "Delete record?" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep unchanged" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it("shows the safe API message and request ID for form failures", () => {
    render(
      <FormError
        error={new ApiClientError({
          code: "VALIDATION_ERROR",
          message: "Please correct the form.",
          requestId: "req-form-123",
        })}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the form.");
    expect(screen.getByRole("alert")).toHaveTextContent("Request ID: req-form-123");
  });

});
