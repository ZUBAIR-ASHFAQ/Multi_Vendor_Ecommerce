import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";

describe("design-system primitives", () => {
  it("keeps the existing button contract and supports polymorphic links", () => {
    render(
      <>
        <Button variant="outline" size="sm">Save</Button>
        <Button asChild><a href="/products">Browse</a></Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/products");
  });

  it("preserves native form semantics", () => {
    render(
      <>
        <label htmlFor="name">Name</label>
        <Input id="name" name="name" required />
        <label htmlFor="state">State</label>
        <Select id="state" defaultValue="active"><option value="active">Active</option></Select>
        <label htmlFor="notes">Notes</label>
        <Textarea id="notes" rows={3} />
      </>,
    );

    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("State")).toHaveValue("active");
    expect(screen.getByLabelText("Notes")).toHaveAttribute("rows", "3");
  });

  it("renders reusable structural and status primitives without changing business semantics", () => {
    const { container } = render(
      <>
        <PageHeader title="Orders" description="Manage marketplace orders" />
        <Surface><StatCard label="Orders" value="12" /></Surface>
        <StatusPill tone="positive">Paid</StatusPill>
        <EmptyState title="No orders" />
        <Skeleton className="h-4" />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Orders", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("No orders")).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"].animate-pulse')).toBeInTheDocument();
  });
});
