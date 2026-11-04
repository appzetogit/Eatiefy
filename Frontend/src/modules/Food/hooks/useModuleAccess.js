import { useSyncExternalStore } from "react";
import {
  getModuleAccess,
  subscribeModuleAccess,
  isDiningEnabled,
  isTakeawayEnabled,
  isSweetsEnabled,
} from "@food/config/featureFlags";

/**
 * Reactive access to the Takeaway / Dining / Sweets admin toggles.
 * Re-renders the caller when an admin flips a toggle.
 */
export function useModuleAccess() {
  const flags = useSyncExternalStore(subscribeModuleAccess, getModuleAccess, getModuleAccess);
  return {
    takeawayEnabled: flags.takeaway_enabled === true,
    diningEnabled: flags.dining_enabled === true,
    sweetsEnabled: flags.sweets_enabled === true,
  };
}

export const useTakeawayEnabled = () => useModuleAccess().takeawayEnabled;
export const useDiningEnabled = () => useModuleAccess().diningEnabled;
export const useSweetsEnabled = () => useModuleAccess().sweetsEnabled;

export { isDiningEnabled, isTakeawayEnabled, isSweetsEnabled };

export default useModuleAccess;
