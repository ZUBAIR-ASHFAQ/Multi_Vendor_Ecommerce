import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { sellerStoreEditorFormSchema } from "../schemas/sellers.schemas";
import type {
  CreateStoreInput,
  SellerStore,
  UpdateStoreInput,
} from "../types/sellers.types";

type SharedStoreFormProps = {
  submitLabel: string;
  isPending: boolean;
  error: unknown;
};

type CreateStoreFormProps = SharedStoreFormProps & {
  store?: undefined;
  onSubmit: (input: CreateStoreInput) => Promise<void>;
};

type EditStoreFormProps = SharedStoreFormProps & {
  store: SellerStore;
  onSubmit: (input: UpdateStoreInput) => Promise<void>;
};

type StoreFormProps = CreateStoreFormProps | EditStoreFormProps;

/** Collects store fields and exposes active/inactive status only while editing an existing store. */
export function StoreForm(props: StoreFormProps) {
  const form = useForm({
    defaultValues: {
      slug: props.store?.slug ?? "",
      name: props.store?.name ?? "",
      description: props.store?.description ?? "",
      logoFileId: props.store?.logoFileId ?? "",
      defaultCurrency: props.store?.defaultCurrency ?? "",
      supportEmail: props.store?.supportEmail ?? "",
      status: props.store?.status === "inactive" ? "inactive" : "active",
    },
    validators: { onChange: sellerStoreEditorFormSchema },
    onSubmit: async ({ value }) => {
      const commonInput: CreateStoreInput = {
        slug: value.slug.trim().toLowerCase(),
        name: value.name.trim(),
        description: value.description.trim() || null,
        logoFileId: value.logoFileId || null,
        defaultCurrency: value.defaultCurrency.trim().toUpperCase(),
        supportEmail: value.supportEmail.trim().toLowerCase() || null,
      };

      try {
        if (props.store) {
          await props.onSubmit({ ...commonInput, status: value.status });
        } else {
          await props.onSubmit(commonInput);
        }
      } catch {
        // The caller's TanStack Query mutation owns the safe error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Store name
                <input
                  aria-label={props.store ? `Store name ${props.store.id}` : "Store name"}
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

        <form.Field name="slug">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Store slug
                <input
                  aria-label={props.store ? `Store slug ${props.store.id}` : "Store slug"}
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

      <form.Field name="description">
        {(field) => (
          <label className="block text-sm font-medium">
            Description <span className="font-normal text-slate-500">(optional)</span>
            <textarea
              aria-label={props.store ? `Store description ${props.store.id}` : "Store description"}
              className="mt-1 min-h-24 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="defaultCurrency">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Default currency
                <input
                  aria-label={props.store ? `Store currency ${props.store.id}` : "Store currency"}
                  className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="supportEmail">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Support email <span className="font-normal text-slate-500">(optional)</span>
                <input
                  aria-label={props.store ? `Store support email ${props.store.id}` : "Store support email"}
                  type="email"
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

      {props.store ? (
        <form.Field name="status">
          {(field) => (
            <label className="block text-sm font-medium">
              Store status
              <select
                aria-label={`Store status ${props.store.id}`}
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as "active" | "inactive")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                Inactive stores are hidden from new public purchases. Admin suspension cannot be changed here.
              </span>
            </label>
          )}
        </form.Field>
      ) : null}

      <FormError error={props.error} />
      <Button disabled={props.isPending}>{props.isPending ? "Saving..." : props.submitLabel}</Button>
    </form>
  );
}
