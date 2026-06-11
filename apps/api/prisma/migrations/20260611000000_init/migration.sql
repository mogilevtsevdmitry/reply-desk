-- Расширение для триграммного поиска похожих отзывов (ADR-001)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "Niche" AS ENUM ('SALON', 'DENTAL', 'RESTO', 'AUTO', 'FITNESS', 'MEDICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'START', 'BUSINESS');

-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('YANDEX_MAPS', 'TWOGIS', 'OZON', 'WILDBERRIES', 'OTHER');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('SERVICE', 'QUALITY', 'STAFF', 'PRICE', 'WAITING', 'OTHER');

-- CreateEnum
CREATE TYPE "GenStatus" AS ENUM ('PENDING', 'ANALYZING', 'GENERATING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" "Niche" NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "toneOfVoice" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" "ReviewSource" NOT NULL,
    "rating" INTEGER,
    "rawText" TEXT NOT NULL,
    "category" "Category",
    "severity" INTEGER,
    "isFakeSusp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "status" "GenStatus" NOT NULL DEFAULT 'PENDING',
    "publicReplies" JSONB,
    "internalTask" JSONB,
    "classification" JSONB,
    "winback" JSONB,
    "error" TEXT,
    "tokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_key" ON "User"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_companyId_period_key" ON "UsageCounter"("companyId", "period");

-- CreateIndex
CREATE INDEX "Review_companyId_createdAt_idx" ON "Review"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Generation_reviewId_key" ON "Generation"("reviewId");

-- GIN-индекс для similarity() по текстам отзывов (ADR-001)
CREATE INDEX review_rawtext_trgm_idx ON "Review" USING gin ("rawText" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
