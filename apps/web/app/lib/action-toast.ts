import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Shows a route action's result as a toast, so it is seen however far the page is scrolled.
 * Each submission returns a new object, so the same message shows again on a repeat.
 */
export function useActionToast(data: { error?: string; message?: string } | undefined) {
  useEffect(() => {
    if (data?.error) toast.error(data.error);
    else if (data?.message) toast.success(data.message);
  }, [data]);
}
