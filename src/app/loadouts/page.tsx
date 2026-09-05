import { Suspense } from "react";
import { LoadoutsPageShell } from "@/components/loadouts/loadouts-page-shell";

export default function LoadoutsPage() {
  // useSearchParams (share-link import) needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <LoadoutsPageShell />
    </Suspense>
  );
}
