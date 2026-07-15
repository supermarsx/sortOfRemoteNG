import type { Connection } from "../../../types/connection/connection";
import {
  integrationRegistry,
  type IntegrationDescriptor,
} from "../../../types/integrations/registry";
import {
  CONNECTION_ICON_CATALOG,
  getConnectionIconDefinition,
  type ConnectionIconCategory,
  type ConnectionIconDefinition,
  type ConnectionIconKey,
} from "../../../utils/icons/connectionIconCatalog";
import {
  PROTOCOL_ICON_DEFAULTS,
  getConnectionIntegrationKey,
  resolveEffectiveConnectionIcon,
  type EffectiveConnectionIcon,
} from "../../../utils/icons/resolveConnectionIcon";

export const CONNECTION_ICON_CATEGORY_LABELS: Readonly<
  Record<ConnectionIconCategory, string>
> = Object.freeze({
  "remote-protocols": "Remote protocols",
  "servers-devices": "Servers & devices",
  network: "Network",
  cloud: "Cloud",
  databases: "Databases",
  "devops-monitoring": "DevOps & monitoring",
  security: "Security",
  files: "Files & storage",
  communication: "Communication",
  "generic-shapes": "Markers & shapes",
});

export type ConnectionIconPickerConnection = Pick<
  Connection,
  "icon" | "integration"
> & { protocol: string };

type CatalogDefinition = ConnectionIconDefinition<ConnectionIconKey>;

const normalizeSearchText = (value: string): string =>
  value.trim().toLocaleLowerCase();

const searchTokens = (value: string): readonly string[] =>
  normalizeSearchText(value).split(/\s+/).filter(Boolean);

function addAlias(
  aliases: Map<ConnectionIconKey, Set<string>>,
  key: string | undefined,
  ...values: Array<string | undefined>
) {
  const definition = getConnectionIconDefinition(key);
  if (!definition) return;
  const bucket = aliases.get(definition.key) ?? new Set<string>();
  values.forEach((value) => {
    const normalized = value?.trim();
    if (normalized) bucket.add(normalized);
  });
  aliases.set(definition.key, bucket);
}

function buildIconAliases(
  descriptors: readonly IntegrationDescriptor[] = integrationRegistry,
): ReadonlyMap<ConnectionIconKey, readonly string[]> {
  const aliases = new Map<ConnectionIconKey, Set<string>>();

  Object.entries(PROTOCOL_ICON_DEFAULTS).forEach(([protocol, key]) => {
    addAlias(aliases, key, protocol, `${protocol} protocol`);
  });

  descriptors.forEach((descriptor) => {
    addAlias(
      aliases,
      descriptor.defaultConnectionIconKey,
      descriptor.key,
      descriptor.label,
      descriptor.category,
      `${descriptor.label} integration`,
    );
  });

  return new Map(
    Array.from(aliases, ([key, values]) => [key, Array.from(values)]),
  );
}

const CONNECTION_ICON_ALIASES = buildIconAliases();

function getDefinitionSearchTerms(
  definition: CatalogDefinition,
): readonly string[] {
  return [
    definition.label,
    definition.key,
    definition.category,
    CONNECTION_ICON_CATEGORY_LABELS[definition.category],
    definition.description,
    ...definition.keywords,
    ...(CONNECTION_ICON_ALIASES.get(definition.key) ?? []),
  ];
}

export const CONNECTION_ICON_SEARCH_TERMS = Object.freeze(
  Array.from(
    new Set(CONNECTION_ICON_CATALOG.flatMap(getDefinitionSearchTerms)),
  ),
);

export function filterConnectionIcons(
  query: string,
): readonly CatalogDefinition[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return CONNECTION_ICON_CATALOG;

  return CONNECTION_ICON_CATALOG.filter((definition) => {
    const haystack = normalizeSearchText(
      getDefinitionSearchTerms(definition).join(" "),
    );
    return tokens.every((token) => haystack.includes(token));
  });
}

export function resolveEditorConnectionIcon(
  connection: ConnectionIconPickerConnection,
  descriptors: readonly IntegrationDescriptor[] = integrationRegistry,
): EffectiveConnectionIcon {
  const integrationKey = getConnectionIntegrationKey(connection);
  const descriptor = integrationKey
    ? descriptors.find((candidate) => candidate.key === integrationKey)
    : undefined;
  return resolveEffectiveConnectionIcon(connection, descriptor);
}

export function getRecommendedConnectionIconKeys(
  connection: ConnectionIconPickerConnection,
  descriptors: readonly IntegrationDescriptor[] = integrationRegistry,
): readonly ConnectionIconKey[] {
  const automatic = resolveEditorConnectionIcon(
    { ...connection, icon: undefined },
    descriptors,
  );
  const contextTerms = [
    connection.protocol,
    automatic.integrationKey,
    descriptors.find(
      (descriptor) => descriptor.key === automatic.integrationKey,
    )?.label,
  ]
    .filter((value): value is string => !!value)
    .flatMap(searchTokens);

  const related = CONNECTION_ICON_CATALOG.filter((definition) => {
    if (definition.key === automatic.key) return false;
    const haystack = normalizeSearchText(
      getDefinitionSearchTerms(definition).join(" "),
    );
    return contextTerms.some(
      (term) => term.length > 2 && haystack.includes(term),
    );
  }).map((definition) => definition.key);

  return [automatic.key, ...related].slice(0, 4);
}
