-- DropIndex
DROP INDEX "review_rawtext_trgm_idx";

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "authorName" TEXT;
