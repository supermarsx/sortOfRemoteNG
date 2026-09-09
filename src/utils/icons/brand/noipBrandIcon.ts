import { createBrandIcon } from "./createBrandIcon";

/** Monochrome vector contour traced from the publisher's compact raster.
 * Green foreground retained; pale diagonal strike and letter counters become
 * transparent. No NIP monogram, font, bitmap, mask or runtime asset request.
 * https://d2qr50rz2oof04.cloudfront.net/assets/img/logo/logo-grey-bug.png
 * Raster SHA256: ee29386c2a98097386a95570efc71a1181afb26ed3b42042af5d39a919d679ca
 * Smooth Bezier contours follow the 54x54 source's roundel and letter bowls;
 * straight stems and the diagonal cut retain their original topology.
 */
export const noip = createBrandIcon(
  "NoIpPublisherTrace",
  "M28.5 4C32.5 4 36.4 5.1 39.8 7.2L27 19.1V15H21V25.7L19 27.7V15H13V33.7L8.5 38.2C6.9 34.8 6 30.8 6 26.5C6 20.3 8.6 14.5 12.9 10.4C13.4 12.2 16.7 12.8 18.6 11.7C20.5 10.6 20.3 7.7 18.9 6.2C21.9 4.8 25.2 4 28.5 4Z M47.2 14.6C49.7 18.1 51 22.2 51 26.5C51 38.9 40.9 49 28.5 49H27V36.7C29.5 38.4 32.1 39.1 35.6 39.1C42.8 39.1 47.5 34.1 47.5 26.5C47.5 23.1 46.6 20.5 44.8 18.5L45 16.8Z M38.4 23H39.2C41.2 23 42 24.4 42 26.9C42 30.5 39.5 33 35.8 33H32.3C31.5 33 31 32.4 31 31.5V30.4Z M19.2 42H21V47.8C19.2 47.2 17.5 46.3 15.9 45.2Z",
  "scale(0.4444444444)",
);
