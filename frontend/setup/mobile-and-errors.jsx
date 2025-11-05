import React from "react";
import { Toaster, toast } from "sonner";

/**
 * ErrorBoundary pour erreurs de rendu React
 */
export class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    // log console + toast générique
    console.error("Render error:", error, info);
    toast.error("Une erreur est survenue. Réessaie plus tard.");
  }
  render() {
    return this.props.children;
  }
}

/**
 * Installe les handlers globaux une seule fois
 */
function useInstallGlobalHandlers() {
  React.useEffect(() => {
    if (window.__global_error_handlers_installed) return;
    window.__global_error_handlers_installed = true;

    window.addEventListener("error", (event) => {
      if (!event?.message) return;
      toast.error("Erreur: " + event.message);
    });

    window.addEventListener("unhandledrejection", (event) => {
      const msg =
        event?.reason?.message ||
        event?.reason?.statusText ||
        "Une erreur réseau s'est produite.";
      toast.error("Oops: " + msg);
    });

    // Patch global fetch -> toasts sur 4xx/5xx et sur erreurs réseau
    if (!window.__fetch_patched) {
      window.__fetch_patched = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        try {
          const res = await originalFetch(...args);
          if (!res.ok) {
            let detail = "";
            try {
              const ct = res.headers.get("content-type") || "";
              if (ct.includes("application/json")) {
                const data = await res.clone().json();
                detail = data?.message || data?.error || "";
              } else {
                const text = await res.clone().text();
                detail = (text || "").slice(0, 160);
              }
            } catch {}
            toast.error(
              `Erreur ${res.status} – ${res.statusText}${detail ? `: ${detail}` : ""}`
            );
          }
          return res;
        } catch (e) {
          toast.error(e?.message || "Échec de la requête réseau.");
          throw e;
        }
      };
    }

    // (Optionnel) axios global exposé sur window.axios
    try {
      const axios = window.axios || null;
      if (axios && !window.__axios_interceptor_installed) {
        window.__axios_interceptor_installed = true;
        axios.interceptors.response.use(
          (r) => r,
          (error) => {
            const status = error?.response?.status;
            const statusText = error?.response?.statusText;
            const msg =
              error?.response?.data?.message ||
              error?.message ||
              "Erreur inconnue";
            toast.error(`Erreur ${status || ""} ${statusText || ""} : ${msg}`);
            return Promise.reject(error);
          }
        );
      }
    } catch {}
  }, []);
}

/**
 * Wrapper à utiliser une seule fois autour de toute l'app
 */
export function AppGuards({ children }) {
  useInstallGlobalHandlers();
  return (
    <>
      <GlobalErrorBoundary>{children}</GlobalErrorBoundary>
      <Toaster richColors position="top-center" closeButton duration={6000} />
    </>
  );
}