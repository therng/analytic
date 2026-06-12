"use client";
import { useSession, signIn, signOut } from "next-auth/react";

export type SocialSession =
  | { status: "unauthenticated"; signIn: () => void }
  | { status: "needsUsername"; socialId: string; signOut: () => void }
  | { status: "authenticated"; socialId: string; username: string; signOut: () => void };

export function useSocialSession(): SocialSession {
  const { data: session, status } = useSession();

  if (status !== "authenticated" || !session?.user?.socialId) {
    return { status: "unauthenticated", signIn: () => signIn() };
  }

  if (session.user.needsUsername) {
    return { status: "needsUsername", socialId: session.user.socialId, signOut: () => signOut() };
  }

  return {
    status: "authenticated",
    socialId: session.user.socialId,
    username: session.user.username!,
    signOut: () => signOut(),
  };
}
