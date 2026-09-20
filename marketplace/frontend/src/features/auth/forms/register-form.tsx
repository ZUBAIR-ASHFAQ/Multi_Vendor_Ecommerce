import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { registerFormSchema } from "../schemas/auth.schemas";
import { useRegisterMutation } from "../hooks/use-auth";
import { firstFieldError, FormError } from "../components/form-error";

const inputClass = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2";

/** Registers a customer without exposing account-type, role, or permission controls. */
export function RegisterForm() {
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const registration = useRegisterMutation();
  const form = useForm({
    defaultValues: {
      displayName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    validators: { onChange: registerFormSchema },
    onSubmit: async ({ value }) => {
      const customer = await registration.mutateAsync({
        displayName: value.displayName,
        email: value.email,
        password: value.password,
      });
      setCreatedEmail(customer.email);
    },
  });

  if (createdEmail) {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          Customer account created for {createdEmail}.
        </p>
        <Button asChild className="w-full">
          <Link to="/login">Continue to sign in</Link>
        </Button>
      </div>
    );
  }

  const labels = {
    displayName: "Display name",
    email: "Email",
    password: "Password",
    confirmPassword: "Confirm password",
  } as const;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {(["displayName", "email", "password", "confirmPassword"] as const).map(
        (name) => (
          <form.Field key={name} name={name}>
            {(field) => {
              const error = firstFieldError(field.state.meta.errors);
              const passwordField = name === "password" || name === "confirmPassword";
              return (
                <label className="block text-sm font-medium">
                  {labels[name]}
                  <input
                    aria-label={labels[name]}
                    className={inputClass}
                    type={passwordField ? "password" : name === "email" ? "email" : "text"}
                    autoComplete={
                      name === "email"
                        ? "email"
                        : name === "password"
                          ? "new-password"
                          : name === "confirmPassword"
                            ? "new-password"
                            : "name"
                    }
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
                </label>
              );
            }}
          </form.Field>
        ),
      )}

      <FormError error={registration.error} />
      <Button className="w-full" disabled={registration.isPending}>
        {registration.isPending ? "Creating account..." : "Create customer account"}
      </Button>
    </form>
  );
}
