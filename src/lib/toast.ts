import { toast as manager } from "@/components/ui/toast";

type ToastType = "success" | "error" | "warning" | "info";

function add(type: ToastType, title: string, description?: string) {
  return manager.add({ type, title, description });
}

/** Posts a finished toast (success, error, …). */
export interface Notifier {
  success(title: string, description?: string): void;
  error(title: string, description?: string): void;
  warning(title: string, description?: string): void;
  info(title: string, description?: string): void;
}

/** A spinner toast for work in flight; settle it with the outcome to turn it in place. */
export interface PendingToast extends Notifier {
  /** Change what it says while it's still loading. */
  progress(title: string, description?: string): void;
  dismiss(): void;
}

function loading(title: string, description?: string): PendingToast {
  // Dismissed while loading: the outcome gets a toast of its own instead of vanishing.
  let open = true;
  const id = manager.add({
    type: "loading",
    title,
    description,
    onClose: () => {
      open = false;
    },
  });
  const settle = (type: ToastType) => (title: string, description?: string) => {
    if (open) manager.update(id, { type, title, description });
    else add(type, title, description);
  };
  return {
    success: settle("success"),
    error: settle("error"),
    warning: settle("warning"),
    info: settle("info"),
    progress: (title, description) => {
      if (open) manager.update(id, { title, description });
    },
    dismiss: () => manager.close(id),
  };
}

/** Thin sonner-shaped facade over the Base UI toast manager. */
export const toast = {
  success: (title: string, description?: string) => add("success", title, description),
  error: (title: string, description?: string) => add("error", title, description),
  warning: (title: string, description?: string) => add("warning", title, description),
  info: (title: string, description?: string) => add("info", title, description),
  loading,
};
