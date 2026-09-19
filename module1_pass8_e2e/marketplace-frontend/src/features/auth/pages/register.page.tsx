import { Link } from "@tanstack/react-router";
import { AuthCard } from "../components/auth-card";
import { RegisterForm } from "../forms/register-form";

/** Shows the public customer-registration workflow. */
export function RegisterPage() {
  return (
    <AuthCard
      title="Create customer account"
      description="Registration creates a customer identity only. Roles and seller access are assigned by server-controlled workflows."
    >
      <RegisterForm />
      <div className="mt-4 space-y-2 text-center text-sm">
        <p>
          Already have an account?{" "}
          <Link className="underline" to="/login">
            Sign in
          </Link>
        </p>
        <p className="text-slate-600">
          Want to sell on the marketplace? Create/sign in to your customer account, then{" "}
          <Link className="font-semibold underline" to="/seller/apply">
            apply to become a seller
          </Link>.
        </p>
      </div>
    </AuthCard>
  );
}
