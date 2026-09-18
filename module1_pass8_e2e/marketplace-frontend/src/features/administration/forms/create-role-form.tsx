import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { createRoleFormSchema } from "../schemas/administration.schemas";
import { useCreateRoleMutation } from "../hooks/use-administration";

/** Creates a custom role with an explicit immutable resource-scope type. */
export function CreateRoleForm() {
  const mutation = useCreateRoleMutation();
  const form = useForm({
    defaultValues: {
      code: "",
      name: "",
      description: "",
      scopeType: "platform" as "platform" | "seller" | "customer",
      status: "active" as "active" | "inactive",
    },
    validators: { onChange: createRoleFormSchema },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        ...value,
        description: value.description || null,
      });
      form.reset();
    },
  });

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Create role</h2>
      <p className="mt-1 text-sm text-slate-600">
        Role scope is fixed at creation so later permissions cannot silently cross resource boundaries.
      </p>
      <form
        className="mt-4 grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="code">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Role code
                <input
                  aria-label="Role code"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error && <span className="block text-xs text-red-600">{error}</span>}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="name">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Role name
                <input
                  aria-label="Role name"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error && <span className="block text-xs text-red-600">{error}</span>}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="scopeType">
          {(field) => (
            <label className="text-sm font-medium">
              Role scope
              <select
                aria-label="Role scope"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) =>
                  field.handleChange(event.target.value as "platform" | "seller" | "customer")
                }
              >
                <option value="platform">Platform</option>
                <option value="seller">Seller</option>
                <option value="customer">Customer</option>
              </select>
            </label>
          )}
        </form.Field>

        <form.Field name="status">
          {(field) => (
            <label className="text-sm font-medium">
              Status
              <select
                aria-label="Role status"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as "active" | "inactive")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          )}
        </form.Field>

        <form.Field name="description">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium md:col-span-2">
                Description
                <textarea
                  aria-label="Role description"
                  className="mt-1 min-h-24 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error && <span className="block text-xs text-red-600">{error}</span>}
              </label>
            );
          }}
        </form.Field>

        <div className="md:col-span-2">
          <FormError error={mutation.error} />
          <Button className="mt-3" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating..." : "Create role"}
          </Button>
        </div>
      </form>
    </section>
  );
}
