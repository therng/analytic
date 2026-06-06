import { getAccountListItems } from "@/lib/trading/account-data";
import { CarPlayWidget } from "@/components/carplay/CarPlayWidget";

export const metadata = {
  title: "Analytic – CarPlay",
};

export default async function CarPlayPage() {
  let initialAccounts: Awaited<ReturnType<typeof getAccountListItems>> = [];
  try {
    initialAccounts = await getAccountListItems();
  } catch {
    // DB may be unavailable on first cold start; client will retry
  }

  return <CarPlayWidget initialAccounts={initialAccounts} />;
}
