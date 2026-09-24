"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordField from "@/components/password-field";
import { useToast } from "@/components/toast";
import { signUpSchema, fieldErrors } from "@/lib/validation/auth";
import { useAuthStore } from "@/lib/auth-store";
import {
  labelClass,
  fieldErrorClass,
  buttonClass,
  inputBaseClass,
} from "@/components/form";

type FieldKey = "fullName" | "email" | "password";

interface SignUpValues {
  fullName: string;
  email: string;
  password: string;
}

/**
 * Real-time client-side validation for the sign-up form. Every keystroke
 * re-validates against the SAME schema the server uses (src/lib/validation),
 * so client and API cannot drift. A field only starts showing its error the
 * moment the user types into it (or blurs it); submit is blocked until the
 * whole form passes.
 */
export default function CreateAccountForm() {
  const router = useRouter();
  const { showToast } = useToast();
  const { state, actions } = useAuthStore();
  const fullName = state.signupFullName;
  const email = state.signupEmail;
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
    fullName: false,
    email: false,
    password: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const validate = (values: SignUpValues): Record<string, string> => {
    const parsed = signUpSchema.safeParse(values);
    return parsed.success ? {} : (fieldErrors(parsed.error) ?? {});
  };

  // Recompute the visible errors: a field's error is shown once it has been
  // touched, updated live as the value changes.
  const recompute = (values: SignUpValues) => {
    const all = validate(values);
    setErrors((prev) => {
      const next: Record<string, string> = {};
      (["fullName", "email", "password"] as const).forEach((key) => {
        if (touched[key]) {
          if (all[key]) next[key] = all[key];
        } else if (prev[key]) {
          next[key] = prev[key];
        }
      });
      return next;
    });
  };

  const handleChange = (field: FieldKey, value: string) => {
    if (field === "fullName") actions.setSignupFullName(value);
    else if (field === "email") actions.setSignupEmail(value);
    else setPassword(value);

    const next = { fullName, email, password, [field]: value };
    setTouched((t) => ({ ...t, [field]: true }));
    recompute(next);
  };

  const handleBlur = (field: FieldKey) => {
    setTouched((t) => ({ ...t, [field]: true }));
    recompute({ fullName, email, password });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const values: SignUpValues = { fullName, email, password };
    const parsed = signUpSchema.safeParse(values);
    if (!parsed.success) {
      // Reveal every field's error and block the request.
      setTouched({ fullName: true, email: true, password: true });
      setErrors(fieldErrors(parsed.error) ?? {});
      showToast("Please fix the highlighted fields.", "error");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/signup", {
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
        showToast(data.error ?? "Unable to create account.", "error");
        setLoading(false);
        return;
      }

      if (data.alreadyVerified) {
        showToast(
          "An account with this email already exists and is verified. Please sign in.",
          "info"
        );
        router.push("/signin");
        return;
      }

      actions.setPendingEmail(parsed.data.email);
      showToast("Account created! Check your email for the verification code.", "success");
      router.push("/verify-email");
    } catch {
      showToast("Network error. Please try again.", "error");
      setLoading(false);
    }
  };

  const ariaInvalid = (field: FieldKey) => Boolean(errors[field]);
  const describedBy = (field: FieldKey, id: string) =>
    errors[field] ? id : undefined;

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex w-full flex-col text-left">
        <label htmlFor="fullName" className={labelClass}>
          Full name
        </label>
        <input
          id="fullName"
          type="text"
          value={fullName}
          onChange={(e) => handleChange("fullName", e.target.value)}
          onBlur={() => handleBlur("fullName")}
          placeholder="Jane Designer"
          autoComplete="name"
          required
          aria-invalid={ariaInvalid("fullName")}
          aria-describedby={describedBy("fullName", "signup-name-error")}
          className={inputBaseClass}
        />
        {errors.fullName && (
          <p id="signup-name-error" role="alert" className={fieldErrorClass}>
            {errors.fullName}
          </p>
        )}
      </div>

      <div className="flex w-full flex-col text-left">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => handleChange("email", e.target.value)}
          onBlur={() => handleBlur("email")}
          placeholder="you@studio.com"
          autoComplete="email"
          required
          aria-invalid={ariaInvalid("email")}
          aria-describedby={describedBy("email", "signup-email-error")}
          className={inputBaseClass}
        />
        {errors.email && (
          <p id="signup-email-error" role="alert" className={fieldErrorClass}>
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
          onChange={(e) => handleChange("password", e.target.value)}
          onBlur={() => handleBlur("password")}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
          aria-invalid={ariaInvalid("password")}
          aria-describedby={describedBy("password", "signup-password-error")}
        />
        {errors.password && (
          <p id="signup-password-error" role="alert" className={fieldErrorClass}>
            {errors.password}
          </p>
        )}
      </div>

      <button type="submit" disabled={loading} className={buttonClass}>
        {loading ? "Creating account..." : "Create Account"}
      </button>
    </form>
  );
}