-- AlterTable
ALTER TABLE "User" ADD COLUMN     "consentDocsVersion" TEXT,
ADD COLUMN     "consentLlmAt" TIMESTAMP(3),
ADD COLUMN     "consentPdAt" TIMESTAMP(3);
