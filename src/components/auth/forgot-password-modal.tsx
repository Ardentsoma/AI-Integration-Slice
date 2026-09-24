"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { requestResetSchema, fieldErrors } from "@/lib/validation/auth";
import { useAuthStore } from "@/lib/auth-store";
import {
  labelClass,
  fieldErrorClass,
  buttonClass,
  inputBaseClass,
} from "@/components/form";

export default function ForgotPasswordModal({ onDone }: { onDone: () => void }) {
  const { showToast } = useToast();
  // Restore what you typed before; falls back to the email last used on the
  // sign-in form because it shares the same store session.
  const { state, actions } = useAuthStore();
  const email = state.forgotEmail;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // If this flow has no email yet, carry over the one typed on the sign-in
  // form so the shared store connects the two ("forgot" right after a typo).
  useEffect(() => {
    if (!state.forgotEmail && state.signinEmail) {
      actions.setForgotEmail(state.signinEmail);
    }
  }, [state.forgotEmail, state.signinEmail, actions]);

  const handleEmailChange = (value: string) => actions.setForgotEmail(value);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const parsed = requestResetSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error) ?? {});
      setLoading(false);
      return;
    }
    setErrors({});

    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        showToast(data.error ?? "Too many requests. Try again shortly.", "error");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setErrors(data.errors ?? {});
        showToast(data.error ?? "Unable to send a reset link.", "error");
        setLoading(false);
        return;
      }

      // Same copy for everyone to avoid user enumeration.
      setSent(true);
      setLoading(false);
    } catch {
      showToast("Network error. Please try again.", "error");
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="flex w-full flex-col gap-4 text-left">
        <p className="text-[0.9rem] leading-relaxed text-neutral-300">
          If an account exists for that email, we&apos;ve sent a link to reset
          your password. Check your inbox (and spam folder).
        </p>
        <button type="button" onClick={onDone} className={buttonClass}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex w-full flex-col text-left">
        <label htmlFor="forgot-password-modal-email" className={labelClass}>
          Email
        </label>
        <input
          id="forgot-password-modal-email"
          type="email"
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          placeholder="you@studio.com"
          autoComplete="email"
          required
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "forgot-modal-email-error" : undefined}
          className={inputBaseClass}
        />
        {errors.email && (
          <p id="forgot-modal-email-error" role="alert" className={fieldErrorClass}>
            {errors.email}
          </p>
        )}
      </div>

      <button type="submit" disabled={loading} className={buttonClass}>
        {loading ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}