"use client";

import { useState } from "react";
import PasswordField from "@/components/password-field";
import { useToast } from "@/components/toast";
import { resetPasswordSchema, fieldErrors } from "@/lib/validation/auth";
import {
  labelClass,
  fieldErrorClass,
  buttonClass,
} from "@/components/form";

export default function ResetPasswordModal({
  token,
  onDone,
}: {
  token: string | null;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="flex w-full flex-col gap-4 text-left">
        <p className="text-[0.9rem] leading-relaxed text-neutral-300">
          This reset link is missing or invalid. Request a new one to continue.
        </p>
        <a href="/forgot-password" className={buttonClass}>
          Request a new reset link
        </a>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const parsed = resetPasswordSchema.safeParse({ token, password, confirmPassword });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error) ?? {});
      setLoading(false);
      return;
    }
    setErrors({});

    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        showToast(data.error ?? "Too many attempts. Try again shortly.", "error");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setErrors(data.errors ?? {});
        showToast(data.error ?? "Unable to reset your password.", "error");
        setLoading(false);
        return;
      }

      showToast("Password reset! Please sign in with your new password.", "success");
      onDone();
    } catch {
      showToast("Network error. Please try again.", "error");
      setLoading(false);
    }
  };

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="m-0 flex w-full flex-col gap-4 border-0 p-0 text-left">
        <div className="flex w-full flex-col text-left">
          <label htmlFor="reset-modal-new-password" className={labelClass}>
            New password
          </label>
          <PasswordField
            id="reset-modal-new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "reset-modal-password-error" : undefined}
          />
          {errors.password && (
            <p id="reset-modal-password-error" role="alert" className={fieldErrorClass}>
              {errors.password}
            </p>
          )}
        </div>

        <div className="flex w-full flex-col text-left">
          <label htmlFor="reset-modal-confirm-password" className={labelClass}>
            Confirm new password
          </label>
          <PasswordField
            id="reset-modal-confirm-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={
              errors.confirmPassword ? "reset-modal-confirm-error" : undefined
            }
          />
          {errors.confirmPassword && (
            <p id="reset-modal-confirm-error" role="alert" className={fieldErrorClass}>
              {errors.confirmPassword}
            </p>
          )}
        </div>
      </div>

      <button type="submit" disabled={loading} className={buttonClass}>
        {loading ? "Updating..." : "Reset password"}
      </button>
    </form>
  );
}