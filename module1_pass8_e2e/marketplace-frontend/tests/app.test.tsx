import { render, screen } from "@testing-library/react";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { createQueryClient } from "@/lib/query-client";

describe("frontend foundation", () => {
  it("renders the foundation route through TanStack Router", async () => {
    const router = createTestRouter(["/"]);
    await router.load();

    render(<App router={router} queryClient={createQueryClient()} />);

    expect(
      await screen.findByRole("heading", { name: /marketplace frontend foundation is ready/i }),
    ).toBeInTheDocument();
  });

  it("renders a controlled not-found route", async () => {
    const router = createTestRouter(["/does-not-exist"]);
    await router.load();

    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: /page not found/i })).toBeInTheDocument();
  });
});
