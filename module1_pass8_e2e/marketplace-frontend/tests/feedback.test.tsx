import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("alert")).toHaveTextContent("req-123");
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
