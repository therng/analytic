import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Apple({
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || !profile) return false;
      const oauthId = profile.sub ?? account.providerAccountId;
      const provider = account.provider;
      const email = typeof profile.email === "string" ? profile.email : null;
      const displayName =
        (typeof profile.name === "string" ? profile.name : null) ??
        email ??
        "Trader";

      const existing = await prisma.socialUser.findUnique({
        where: { oauthId_provider: { oauthId, provider } },
      });

      if (!existing) {
        const tempUsername = `user_${oauthId.slice(0, 8)}`;
        await prisma.socialUser.create({
          data: { oauthId, provider, email, displayName, username: tempUsername },
        });
      }
      return true;
    },
    async session({ session, token }) {
      if (token.sub && token.provider) {
        const socialUser = await prisma.socialUser.findUnique({
          where: {
            oauthId_provider: {
              oauthId: token.sub,
              provider: token.provider as string,
            },
          },
        });
        if (socialUser) {
          session.user.socialId = socialUser.id;
          session.user.username = socialUser.username;
          session.user.needsUsername = socialUser.username.startsWith("user_");
        }
      }
      return session;
    },
    async jwt({ token, account }) {
      if (account) {
        token.provider = account.provider;
      }
      return token;
    },
  },
});
