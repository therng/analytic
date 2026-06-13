-- CreateTable
CREATE TABLE "social_users" (
    "id" TEXT NOT NULL,
    "oauthId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_shouts" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_shouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_reactions" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_users_username_key" ON "social_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "social_users_oauthId_provider_key" ON "social_users"("oauthId", "provider");

-- CreateIndex
CREATE INDEX "social_reactions_target_type_target_id_idx" ON "social_reactions"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_reactions_author_id_target_type_target_id_emoji_key" ON "social_reactions"("author_id", "target_type", "target_id", "emoji");

-- AddForeignKey
ALTER TABLE "social_shouts" ADD CONSTRAINT "social_shouts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "social_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_reactions" ADD CONSTRAINT "social_reactions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "social_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
