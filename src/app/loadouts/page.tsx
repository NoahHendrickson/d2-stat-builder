import { redirect } from "next/navigation";

/**
 * Loadouts live in the sidebar now, so this route only forwards old links — share
 * links (`/loadouts?import=…`) keep working because the query string is preserved.
 */
export default async function LoadoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}
