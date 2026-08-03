import { useEffect, useState } from "react";
import {
  getRuntimeCapabilitiesSnapshot,
  loadRuntimeCapabilities,
  type RuntimeCapabilities,
} from "../../utils/runtime/runtimeCapabilities";

export const useRuntimeCapabilities = (): RuntimeCapabilities => {
  const [capabilities, setCapabilities] = useState(
    getRuntimeCapabilitiesSnapshot,
  );

  useEffect(() => {
    let active = true;
    void loadRuntimeCapabilities().then((loaded) => {
      if (active) setCapabilities(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  return capabilities;
};
