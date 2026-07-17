/*
  Warnings:

  - You are about to drop the `WorkingOrder` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "WorkingOrder" DROP CONSTRAINT "WorkingOrder_account_id_fkey";

-- DropTable
DROP TABLE "WorkingOrder";
