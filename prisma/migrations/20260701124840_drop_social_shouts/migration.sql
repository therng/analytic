/*
  Warnings:

  - You are about to drop the `social_shouts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "social_shouts" DROP CONSTRAINT "social_shouts_author_id_fkey";

-- DropTable
DROP TABLE "social_shouts";
