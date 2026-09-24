"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordField from "@/components/password-field";
import { useToast } from "@/components/toast";
import { signInSchema, fieldErrors } from "@/lib/validation/auth";
import { useAuthStore } from "@/lib/auth-store";
import {
  labelClass,
  fieldErrorClass,
  buttonClass,
  inputBaseClass,
} from "@/components/form";

export default function SignInForm({ onForgot }: { onForgot: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { state, actions } = useAuthStore();
  const email = state.signinEmail;
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailChange = (value: string) => actions.setSigninEmail(value);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");
    setLoading(true);

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error) ?? {});
      setLoading(false);
      return;
    }
    setErrors({});

    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        setFormError(data.error ?? "Too many attempts. Please try again later.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        if (data.pendingVerification) {
          actions.setPendingEmail(email);
          showToast(data.error ?? "Please verify your email.", "error");
          router.push("/verify-email");
          return;
        }
        setErrors(data.errors ?? {});
        setFormError(data.error ?? "Unable to sign in.");
        setLoading(false);
        return;
      }

      showToast("Logging in to your projects...", "success");
      actions.setSigninEmail("");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setFormError("Network error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex w-full flex-col text-left">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          placeholder="you@studio.com"
          autoComplete="email"
          required
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "signin-email-error" : undefined}
          className={inputBaseClass}
        />
        {errors.email && (
          <p id="signin-email-error" role="alert" className={fieldErrorClass}>
            {errors.email}
          </p>
        )}
      </div>

      <div className="flex w-full flex-col text-left">
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <PasswordField
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "signin-password-error" : undefined}
        />
        {errors.password && (
          <p id="signin-password-error" role="alert" className={fieldErrorClass}>
            {errors.password}
          </p>
        )}
        <div className="mt-2 text-right">
          <a
            href="/forgot-password"
            onClick={(e) => {
              e.preventDefault();
              onForgot();
            }}
            className="text-xs font-semibold text-neutral-500 no-underline transition-colors duration-150 hover:text-red-500"
          >
            Forgot password?
          </a>
        </div>
      </div>

      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-left text-sm font-medium text-red-600"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {formError}
        </div>
      )}

      <button type="submit" disabled={loading} className={buttonClass}>
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}