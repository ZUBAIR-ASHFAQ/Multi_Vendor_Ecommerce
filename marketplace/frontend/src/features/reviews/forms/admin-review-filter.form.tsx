import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { REVIEW_STATUS, REVIEW_STATUS_LABEL } from "../reviews.constants";
import { adminReviewFilterFormSchema } from "../schemas/reviews.schemas";
import type { AdminReviewListParams } from "../types/reviews.types";

/** Converts validated filter-form values into the compact admin Review API query. */
function toApiFilters(value: {
  status: "" | "pending" | "published" | "hidden";
  productId: string;
  sellerId: string;
  storeId: string;
  sort: "created_desc" | "created_asc";
}): Omit<AdminReviewListParams, "page" | "pageSize"> {
  return {
    status: value.status || undefined,
    productId: value.productId || undefined,
    sellerId: value.sellerId || undefined,
    storeId: value.storeId || undefined,
    sort: value.sort,
  };
}

/** Renders the allow-listed moderation queue filters with client-side UUID validation. */
export function AdminReviewFilterForm({
  onApply,
}: {
  onApply: (filters: Omit<AdminReviewListParams, "page" | "pageSize">) => void;
}) {
  const form = useForm({
    defaultValues: {
      status: "pending" as "" | "pending" | "published" | "hidden",
      productId: "",
      sellerId: "",
      storeId: "",
      sort: "created_desc" as "created_desc" | "created_asc",
    },
    validators: { onChange: adminReviewFilterFormSchema },
    onSubmit: async ({ value }) => {
      onApply(toApiFilters(adminReviewFilterFormSchema.parse(value)));
    },
  });

  return (
    <form
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="status">
        {(field) => (
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Review status filter"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as typeof field.state.value)}
            >
              <option value="">All statuses</option>
              {REVIEW_STATUS.map((status) => (
                <option key={status} value={status}>{REVIEW_STATUS_LABEL[status]}</option>
              ))}
            </select>
          </label>
        )}
      </form.Field>

      {([
        ["productId", "Product ID"],
        ["sellerId", "Seller ID"],
        ["storeId", "Store ID"],
      ] as const).map(([name, label]) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <label className="text-sm font-medium">
              {label}
              <input
                aria-label={`${label} filter`}
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="Optional UUID"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value.trim())}
              />
              {firstFieldError(field.state.meta.errors) ? (
                <span className="mt-1 block text-xs text-red-600">
                  {firstFieldError(field.state.meta.errors)}
                </span>
              ) : null}
            </label>
          )}
        </form.Field>
      ))}

      <form.Field name="sort">
        {(field) => (
          <label className="text-sm font-medium">
            Sort
            <select
              aria-label="Review sort"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as typeof field.state.value)}
            >
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
            </select>
          </label>
        )}
      </form.Field>

      <div className="md:col-span-2 xl:col-span-5">
        <Button type="submit">Apply filters</Button>
      </div>
    </form>
  );
}
