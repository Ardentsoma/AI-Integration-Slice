import { z } from "zod";

// --- Shared field schemas (single source of truth for server + client) ---

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address with "@".');

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.")
  .regex(/[a-z]/, "Include at least one lowercase letter.")
  .regex(/[A-Z]/, "Include at least one uppercase letter.")
  .regex(/[0-9]/, "Include at least one number.")
  .regex(/[^A-Za-z0-9]/, "Include at least one special character.");

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your full name.")
  .regex(/\S+\s+\S+/, "Enter your full name (first and last name).")
  .max(120, "Name must be at most 120 characters.");

export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code.");

const confirmMatches = {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
};

// --- Form schemas ---

export const signUpSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
});

export const resendCodeSchema = z.object({
  email: emailSchema,
});

export const requestResetSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, "This reset link is invalid."),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.password === data.confirmPassword, confirmMatches);

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendCodeInput = z.infer<typeof resendCodeSchema>;
export type RequestResetInput = z.infer<typeof requestResetSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Flattens a ZodError into `{ field: message }` for field-level UI feedback.
 * Used by the client forms to render errors under each input.
 */
export function fieldErrors(
  error: unknown
): Record<string, string> | null {
  if (!(error instanceof z.ZodError)) return null;
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "form";
    if (!errors[path]) errors[path] = issue.message;
  }
  return errors;
}