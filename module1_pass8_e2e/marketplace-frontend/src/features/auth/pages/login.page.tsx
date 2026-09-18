import { Link } from "@tanstack/react-router";
import { AuthCard } from "../components/auth-card";
import { LoginForm } from "../forms/login-form";

/** Shows the shared marketplace sign-in page for customers, sellers, and platform users. */
export function LoginPage() {
  return (
    <AuthCard
      title="Sign in"
      description="Use your marketplace account. The server decides your roles, permissions, and seller/store scope."
    >
      <LoginForm />
      <div className="mt-4 text-sm">
        <Link className="text-slate-700 underline" to="/register">
          Create account
        </Link>
      </div>
    </AuthCard>
  );
}
