import { Crosshair } from "@phosphor-icons/react/dist/ssr";

// Placeholder until weapon search is built; the sidebar marks it "Soon".
export default function WeaponsPage() {
  return (
    <main className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 py-6 text-center">
      <div className="d2-corner-well flex size-12 items-center justify-center">
        <Crosshair weight="duotone" className="text-muted-foreground size-6" aria-hidden />
      </div>
      <h2 className="text-base font-medium">Weapon search is on the way</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        Search and filter the weapons across your characters and vault. It isn&apos;t
        built yet.
      </p>
    </main>
  );
}
