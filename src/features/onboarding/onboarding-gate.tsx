import { Navigate, Outlet, useLocation } from "react-router-dom";
import { mustShowOnboarding, useOnboarding } from "./store";

/**
 * Sends new installs (and `VITE_ONBOARDING=always`) to `/onboarding` before
 * chat, projects, or settings.
 */
export function OnboardingGate() {
  useOnboarding();
  const location = useLocation();
  if (mustShowOnboarding() && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

/** Leave the setup page once finished or dismissed. */
export function OnboardingPageGate({ children }: { children: React.ReactNode }) {
  useOnboarding();
  if (!mustShowOnboarding()) {
    return <Navigate to="/" replace />;
  }
  return children;
}
