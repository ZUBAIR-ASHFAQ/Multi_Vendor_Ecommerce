import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { AUDIT_SORT, AUDIT_SORT_OPTIONS } from "../documents-audit.constants";
import { auditFilterFormSchema } from "../schemas/documents-audit.schemas";
import type { AuditListParams, AuditSort } from "../types/documents-audit.types";

/** Converts a datetime-local value into the API's ISO date-time form. */
function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Returns an empty string as undefined so only meaningful filters reach the API. */
function optionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

/** Collects allow-listed audit filters while keeping seller selection platform-admin only in the UI. */
export function AuditFilterForm({
  user,
  onApply,
}: {
  user: AuthenticatedUser;
  onApply: (filters: AuditListParams) => void;
}) {
  const form = useForm({
    defaultValues: {
      action: "",
      resourceType: "",
      resourceId: "",
      actorUserId: "",
      sellerId: "",
      from: "",
      to: "",
      sort: AUDIT_SORT.CREATED_DESC as AuditSort,
    },
    validators: { onChange: auditFilterFormSchema },
    onSubmit: ({ value }) => {
      onApply({
        action: optionalText(value.action),
        resourceType: optionalText(value.resourceType),
        resourceId: optionalText(value.resourceId),
        actorUserId: optionalText(value.actorUserId),
        sellerId:
          user.accountType === "platform_admin"
            ? optionalText(value.sellerId)
            : undefined,
        from: toIsoDateTime(value.from),
        to: toIsoDateTime(value.to),
        sort: value.sort,
      });
    },
  });

  return (
    <form
      className="grid gap-4 rounded-xl border bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="action">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Action
              <input
                aria-label="Audit action"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="resourceType">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Resource type
              <input
                aria-label="Audit resource type"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="resourceId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Resource ID
              <input
                aria-label="Audit resource ID"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="actorUserId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Actor user ID
              <input
                aria-label="Audit actor user ID"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      {user.accountType === "platform_admin" && (
        <form.Field name="sellerId">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Seller ID
                <input
                  aria-label="Audit seller ID"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
              </label>
            );
          }}
        </form.Field>
      )}

      <form.Field name="from">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              From
              <input
                aria-label="Audit from"
                type="datetime-local"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="to">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              To
              <input
                aria-label="Audit to"
                type="datetime-local"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="sort">
        {(field) => (
          <label className="text-sm font-medium">
            Sort
            <select
              aria-label="Audit sort"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as AuditSort)}
            >
              {AUDIT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </form.Field>

      <div className="flex items-end gap-2">
        <Button>Apply filters</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.reset();
            onApply({ sort: AUDIT_SORT.CREATED_DESC });
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
