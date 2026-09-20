import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { getPostLoginPath } from "../auth.navigation";
import { loginFormSchema } from "../schemas/auth.schemas";
import { useLoginMutation } from "../hooks/use-auth";
import { firstFieldError, FormError } from "../components/form-error";

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

/** Renders the login form and routes the actor to a page they are allowed to use. */
export function LoginForm() {
  const navigate = useNavigate();
  const login = useLoginMutation();
  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onChange: loginFormSchema },
    onSubmit: async ({ value }) => {
      const session = await login.mutateAsync(value);
      await navigate({ to: getPostLoginPath(session.user) });
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
      <form.Field name="email">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Email
              <input
                aria-label="Email"
                type="email"
                autoComplete="email"
                className={inputClass}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="password">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Password
              <input
                aria-label="Password"
                type="password"
                autoComplete="current-password"
                className={inputClass}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <FormError error={login.error} />
      <Button type="submit" className="w-full" disabled={login.isPending}>
        {login.isPending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
