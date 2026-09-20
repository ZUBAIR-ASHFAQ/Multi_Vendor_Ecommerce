import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { FormError, firstFieldError } from "@/features/auth/components/form-error";
import { COUPON_STATUS, PROMOTION_RULE_TYPE } from "../promotions.constants";
import { CouponManager } from "../components/coupon-manager";
import { PromotionScopeSelector } from "../components/promotion-scope-selector";
import {
  createPromotionInputSchema,
  promotionFormSchema,
  updatePromotionInputSchema,
  type CreatePromotionInput,
  type Promotion,
  type PromotionCouponForm,
  type PromotionFormValues,
  type UpdatePromotionInput,
} from "../schemas/promotions.schemas";

export type PromotionFormMode = "admin-create" | "seller-create" | "admin-edit";

/** Converts an API ISO timestamp into the local value expected by datetime-local inputs. */
function toLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** Converts one local datetime input to the offset-aware ISO form required by the API. */
function toIsoDateTime(value: string): string {
  return new Date(value).toISOString();
}

/** Converts optional positive integer text into the API's number/undefined representation. */
function optionalLimit(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

/** Builds stable promotion form defaults for create or edit modes. */
function defaultValues(promotion?: Promotion): PromotionFormValues {
  if (!promotion) {
    return {
      name: "",
      type: PROMOTION_RULE_TYPE.PERCENTAGE,
      value: "",
      startAt: "",
      endAt: "",
      scopes: [],
      coupon: null,
    };
  }

  return {
    name: promotion.name,
    type: PROMOTION_RULE_TYPE.PERCENTAGE,
    value: promotion.value,
    startAt: toLocalDateTimeInput(promotion.startAt),
    endAt: toLocalDateTimeInput(promotion.endAt),
    scopes: promotion.scopes,
    coupon: promotion.coupon
      ? {
          code: promotion.coupon.code,
          maxUses: promotion.coupon.maxUses?.toString() ?? "",
          maxUsesPerCustomer: promotion.coupon.maxUsesPerCustomer?.toString() ?? "",
          status: promotion.coupon.status,
        }
      : null,
  };
}

/** Maps validated form state to the documented create request without client-owned seller/funding authority. */
function toCreateInput(value: PromotionFormValues): CreatePromotionInput {
  const input = {
    name: value.name.trim(),
    type: value.type,
    value: value.value.trim(),
    startAt: toIsoDateTime(value.startAt),
    endAt: toIsoDateTime(value.endAt),
    scopes: value.scopes,
    ...(value.coupon
      ? {
          coupon: {
            code: value.coupon.code.trim().toUpperCase(),
            ...(optionalLimit(value.coupon.maxUses) !== undefined
              ? { maxUses: optionalLimit(value.coupon.maxUses) }
              : {}),
            ...(optionalLimit(value.coupon.maxUsesPerCustomer) !== undefined
              ? { maxUsesPerCustomer: optionalLimit(value.coupon.maxUsesPerCustomer) }
              : {}),
          },
        }
      : {}),
  };
  return createPromotionInputSchema.parse(input);
}

/** Maps validated edit state to the documented PATCH body while lifecycle status remains command-owned. */
function toUpdateInput(value: PromotionFormValues): UpdatePromotionInput {
  const input = {
    name: value.name.trim(),
    type: value.type,
    value: value.value.trim(),
    startAt: toIsoDateTime(value.startAt),
    endAt: toIsoDateTime(value.endAt),
    scopes: value.scopes,
    ...(value.coupon
      ? {
          coupon: {
            code: value.coupon.code.trim().toUpperCase(),
            maxUses: optionalLimit(value.coupon.maxUses) ?? null,
            maxUsesPerCustomer: optionalLimit(value.coupon.maxUsesPerCustomer) ?? null,
            status: value.coupon.status,
          },
        }
      : {}),
  };
  return updatePromotionInputSchema.parse(input);
}

/** Renders the shared platform/seller promotion editor using TanStack Form with Zod validation. */
export function PromotionForm({
  mode,
  promotion,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  mode: PromotionFormMode;
  promotion?: Promotion;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreatePromotionInput | UpdatePromotionInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const editing = mode === "admin-edit";
  const form = useForm({
    defaultValues: defaultValues(promotion),
    validators: { onSubmit: promotionFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = promotionFormSchema.parse(value);
      await onSubmit(editing ? toUpdateInput(parsed) : toCreateInput(parsed));
    },
  });

  return (
    <form
      className="space-y-5 rounded-xl border bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {mode === "seller-create" ? "Seller-funded promotion" : editing ? "Edit platform promotion" : "Platform promotion"}
        </p>
        <h2 className="mt-1 text-xl font-bold">{editing ? `Edit ${promotion?.name ?? "promotion"}` : "Create promotion"}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Ownership, funding owner, and lifecycle status are derived by the server. The current executable rule is percentage discount.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Promotion name
                <input
                  aria-label="Promotion name"
                  aria-invalid={Boolean(fieldError)}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="type">
          {(field) => (
            <label className="text-sm font-medium">
              Discount rule
              <select
                aria-label="Promotion discount rule"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as typeof PROMOTION_RULE_TYPE.PERCENTAGE)}
              >
                <option value={PROMOTION_RULE_TYPE.PERCENTAGE}>Percentage</option>
              </select>
            </label>
          )}
        </form.Field>

        <form.Field name="value">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Discount percentage
                <input
                  aria-label="Promotion value"
                  inputMode="decimal"
                  aria-invalid={Boolean(fieldError)}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="10"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <div className="hidden sm:block" />

        <form.Field name="startAt">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Starts at
                <input
                  type="datetime-local"
                  aria-label="Promotion start time"
                  aria-invalid={Boolean(fieldError)}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="endAt">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Ends at
                <input
                  type="datetime-local"
                  aria-label="Promotion end time"
                  aria-invalid={Boolean(fieldError)}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>
      </div>

      <form.Field name="scopes">
        {(field) => (
          <PromotionScopeSelector
            value={field.state.value}
            onChange={field.handleChange}
            error={field.state.meta.errors}
          />
        )}
      </form.Field>

      <form.Field name="coupon">
        {(field) => (
          <div className="space-y-2">
            <CouponManager
              value={field.state.value as PromotionCouponForm | null}
              onChange={field.handleChange}
              allowRemove={!promotion?.coupon}
              showStatus={editing}
            />
            {firstFieldError(field.state.meta.errors) ? (
              <p role="alert" className="text-sm text-red-700">{firstFieldError(field.state.meta.errors)}</p>
            ) : null}
          </div>
        )}
      </form.Field>

      <FormError error={error} />

      <div className="flex flex-wrap gap-2">
        <Button disabled={isPending}>{isPending ? "Saving..." : editing ? "Save changes" : "Create promotion"}</Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        ) : null}
      </div>
    </form>
  );
}
