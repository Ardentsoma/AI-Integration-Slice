/*
  Warnings:

  - Added the required column `code` to the `EmailVerificationToken` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN     "code" TEXT NOT NULL;
