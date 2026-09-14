import { useEffect } from "react";
import { installAppFormPrivacy } from "../../utils/window/appFormPrivacy";

export function useAppFormPrivacy(): void {
  useEffect(() => installAppFormPrivacy(document), []);
}
