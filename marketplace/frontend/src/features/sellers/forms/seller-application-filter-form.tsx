import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import {
  SELLER_APPLICATION_SORT,
  SELLER_APPLICATION_SORT_OPTIONS,
  SELLER_APPLICATION_STATUS,
} from "../sellers.constants";
import type { SellerApplicationListParams } from "../types/sellers.types";

const filterSchema = z.object({
  status: z.union([
    z.literal(""),
    z.enum([
      SELLER_APPLICATION_STATUS.SUBMITTED,
      SELLER_APPLICATION_STATUS.APPROVED,
      SELLER_APPLICATION_STATUS.REJECTED,
    ]),
  ]),
  sort: z.enum([
    SELLER_APPLICATION_SORT.CREATED_DESC,
    SELLER_APPLICATION_SORT.CREATED_ASC,
  ]),
});

/** Collects the bounded status and sort filters supported by the seller-application queue. */
export function SellerApplicationFilterForm({
  onApply,
}: {
  onApply: (params: SellerApplicationListParams) => void;
}) {
  const form = useForm({
    defaultValues: {
      status: "" as "" | "submitted" | "approved" | "rejected",
      sort: SELLER_APPLICATION_SORT.CREATED_DESC as "created_desc" | "created_asc",
    },
    validators: { onChange: filterSchema },
    onSubmit: ({ value }) => {
      onApply({
        status: value.status || undefined,
        sort: value.sort,
      });
    },
  });

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="status">
        {(field) => (
          <label className="text-sm font-medium">
            Application status
            <select
              aria-label="Seller application status filter"
              className="mt-1 block rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) =>
                field.handleChange(
                  event.target.value as
                    | ""
                    | "submitted"
                    | "approved"
                    | "rejected",
                )
              }
            >
              <option value="">All statuses</option>
              <option value={SELLER_APPLICATION_STATUS.SUBMITTED}>Submitted</option>
              <option value={SELLER_APPLICATION_STATUS.APPROVED}>Approved</option>
              <option value={SELLER_APPLICATION_STATUS.REJECTED}>Rejected</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="sort">
        {(field) => (
          <label className="text-sm font-medium">
            Sort
            <select
              aria-label="Seller application sort"
              className="mt-1 block rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) =>
                field.handleChange(event.target.value as typeof field.state.value)
              }
            >
              {SELLER_APPLICATION_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </form.Field>

      <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">
        Apply filters
      </button>
    </form>
  );
}
