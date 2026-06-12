/*
  Warnings:

  - You are about to alter the column `target_type` on the `social_reactions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `emoji` on the `social_reactions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(8)`.
  - You are about to alter the column `message` on the `social_shouts` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(120)`.
  - You are about to alter the column `email` on the `social_users` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.
  - You are about to alter the column `username` on the `social_users` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `displayName` on the `social_users` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(100)`.

*/
-- DropForeignKey
ALTER TABLE "social_reactions" DROP CONSTRAINT "social_reactions_author_id_fkey";

-- DropForeignKey
ALTER TABLE "social_shouts" DROP CONSTRAINT "social_shouts_author_id_fkey";

-- AlterTable
ALTER TABLE "social_reactions" ALTER COLUMN "target_type" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "emoji" SET DATA TYPE VARCHAR(8);

-- AlterTable
ALTER TABLE "social_shouts" ALTER COLUMN "message" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "social_users" ALTER COLUMN "email" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "username" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "displayName" SET DATA TYPE VARCHAR(100);

-- CreateIndex
CREATE INDEX "social_reactions_author_id_idx" ON "social_reactions"("author_id");

-- CreateIndex
CREATE INDEX "social_shouts_author_id_idx" ON "social_shouts"("author_id");

-- CreateIndex
CREATE INDEX "social_shouts_expires_at_idx" ON "social_shouts"("expires_at");

-- AddForeignKey
ALTER TABLE "social_shouts" ADD CONSTRAINT "social_shouts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "social_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_reactions" ADD CONSTRAINT "social_reactions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "social_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
