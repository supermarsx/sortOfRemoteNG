import React from "react";
import { CollapsibleSection } from "../../ui/CollapsibleSection";

/**
 * Connection-editor Section — wraps CollapsibleSection with defaultOpen=true
 * so all sections in the connection editor are expanded by default.
 */
const Section: React.FC<React.ComponentProps<typeof CollapsibleSection>> = (props) => (
  <CollapsibleSection defaultOpen {...props} />
);

export default Section;
