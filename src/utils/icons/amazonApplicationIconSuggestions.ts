import { AMAZON_SHOPPING_PROFILES } from "../connection/amazonProfiles";
import { AWS_CONSOLE_DESTINATIONS } from "../connection/awsConsoleProfiles";
import type { ConnectionIconKey } from "./connectionIconCatalog";

/** Suggestions only; never replace the user's saved icon choice. */
export const AMAZON_APPLICATION_ICON_SUGGESTIONS: Readonly<
  Record<string, ConnectionIconKey>
> = Object.freeze(
  Object.fromEntries([
    ...AMAZON_SHOPPING_PROFILES.map((profile) => [
      profile.id,
      "amazon-shopping" satisfies ConnectionIconKey,
    ]),
    ...AWS_CONSOLE_DESTINATIONS.map((destination) => [
      destination.id,
      "aws" satisfies ConnectionIconKey,
    ]),
  ]),
);
