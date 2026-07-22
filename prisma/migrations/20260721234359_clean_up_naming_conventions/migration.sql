-- Rename social_users -> "SocialUser" for @@map naming consistency with every
-- other table (PascalCase, quoted identifier). Indexes/constraints keep their
-- existing names automatically on RENAME; no data loss, no downtime.
ALTER TABLE "social_users" RENAME TO "SocialUser";
