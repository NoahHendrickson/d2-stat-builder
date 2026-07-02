import { BuilderPanel } from "@/components/builder/builder-panel";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <header className="relative mb-8">
        <div className="absolute top-0 right-0">
          <ThemeToggle />
        </div>
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Stat Builder</h1>
        </div>
      </header>
      <BuilderPanel />
    </main>
  );
}
