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
      <p className="mt-4 text-center text-sm">
        Already have an account?{" "}
        <Link className="underline" to="/login">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
