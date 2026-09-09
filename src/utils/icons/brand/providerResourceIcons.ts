import { createLucideIcon } from "lucide-react";

/** AWS EC2 singular Instance resource, not an AWS logo or an app role frame.
 * Official architecture package; path and terms in docs/connection-icon-brands.md.
 * Resource-Icons_07312026/Res_Compute/Res_Amazon-EC2_Instance_48.svg
 * Source SVG SHA-256: d79a847f8d026f6852a6cc90f060488099362110d72f7876517d9094fae31c2c
 */
export const ec2Instance = createLucideIcon("AmazonEc2Instance", [
  [
    "path",
    {
      d: "M9,39 L39,39 L39,9 L9,9 L9,39 Z M46,13 L46,11 L41,11 L41,8 C41,7.448 40.552,7 40,7 L37,7 L37,2 L35,2 L35,7 L31,7 L31,2 L29,2 L29,7 L25,7 L25,2 L23,2 L23,7 L19,7 L19,2 L17,2 L17,7 L13,7 L13,2 L11,2 L11,7 L8,7 C7.447,7 7,7.448 7,8 L7,11 L2,11 L2,13 L7,13 L7,17 L2,17 L2,19 L7,19 L7,23 L2,23 L2,25 L7,25 L7,29 L2,29 L2,31 L7,31 L7,35 L2,35 L2,37 L7,37 L7,40 C7,40.553 7.447,41 8,41 L11,41 L11,46 L13,46 L13,41 L17,41 L17,46 L19,46 L19,41 L23,41 L23,46 L25,46 L25,41 L29,41 L29,46 L31,46 L31,41 L35,41 L35,46 L37,46 L37,41 L40,41 C40.552,41 41,40.553 41,40 L41,37 L46,37 L46,35 L41,35 L41,31 L46,31 L46,29 L41,29 L41,25 L46,25 L46,23 L41,23 L41,19 L46,19 L46,17 L41,17 L41,13 L46,13 Z",
      transform: "scale(0.5)",
      fill: "currentColor",
      fillRule: "evenodd",
      stroke: "none",
      key: "instance",
    },
  ],
]);
