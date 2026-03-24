import { useEffect } from "react";
import { useAuth } from "./useAuth";
import { initSuspiciousDetectors } from "@/lib/suspiciousDetector";

/**
 * Hook that provides auth state + auto-initializes suspicious activity detectors.
 * Use in any auth-gated page to get BannedScreen support.
 */
export const useProtectedAuth = () => {
  const auth = useAuth();

  useEffect(() => {
    if (auth.user && !auth.isBanned) {
      initSuspiciousDetectors(auth.user.id);
    }
  }, [auth.user, auth.isBanned]);

  return auth;
};
