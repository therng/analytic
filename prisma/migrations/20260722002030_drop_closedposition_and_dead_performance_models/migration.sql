/*
  Warnings:

  - You are about to drop the `AccountPerformanceByStrategy` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AccountPerformanceBySymbol` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ClosedPosition` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Strategy` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AccountPerformanceByStrategy" DROP CONSTRAINT "AccountPerformanceByStrategy_account_id_fkey";

-- DropForeignKey
ALTER TABLE "AccountPerformanceBySymbol" DROP CONSTRAINT "AccountPerformanceBySymbol_account_id_fkey";

-- DropForeignKey
ALTER TABLE "ClosedPosition" DROP CONSTRAINT "ClosedPosition_account_number_fkey";

-- AlterTable
ALTER TABLE "SocialUser" RENAME CONSTRAINT "social_users_pkey" TO "SocialUser_pkey";

-- DropTable
DROP TABLE "AccountPerformanceByStrategy";

-- DropTable
DROP TABLE "AccountPerformanceBySymbol";

-- DropTable
DROP TABLE "ClosedPosition";

-- DropTable
DROP TABLE "Strategy";

-- RenameIndex
ALTER INDEX "social_users_oauthId_provider_key" RENAME TO "SocialUser_oauthId_provider_key";

-- RenameIndex
ALTER INDEX "social_users_username_key" RENAME TO "SocialUser_username_key";
