import { toast as manager } from "@/components/ui/toast";

type ToastType = "success" | "error" | "warning" | "info";

function add(type: ToastType, title: string, description?: string) {
  return manager.add({ type, title, description });
}

/** Thin sonner-shaped facade over the Base UI toast manager. */
export const toast = {
  success: (title: string, description?: string) => add("success", title, description),
  error: (title: string, description?: string) => add("error", title, description),
  warning: (title: string, description?: string) => add("warning", title, description),
  info: (title: string, description?: string) => add("info", title, description),
};
