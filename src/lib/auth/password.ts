import bcrypt from "bcryptjs";

// Deliberate cost factor — 12 rounds (~250ms) is the lower bound for
// password hashing. Never downgrade; never use a general-purpose hash.
export const BCRYPT_COST = 12;

// Pre-computed hash used only to equalize response timing on sign-in when an
// email does not exist (avoids cheap user enumeration via timing).
export const DUMMY_PASSWORD_HASH =
  "$2b$12$ePguQfq0QmG91H410u69A.3hcfWSyvk0ukycWwW0A6KoDRR5rah1q";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}