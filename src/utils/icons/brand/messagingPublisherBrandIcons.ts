import { createLucideIcon } from "lucide-react";

/** Publisher SVG adaptations; full provenance: docs/connection-icon-brands.md. */

// https://www.microsoft.com/content/dam/microsoft/bade/images/icons/en-us/m365-app-icons-fy26/Teams-Icon-FY26.svg
// Source SVG SHA-256: 6a33d49f19d1be2bcdf86921935a2171e5c18c3b11abe297ca03d5f4f302ba3a
// Current FY26 publisher paths. Redundant gradient overlays are omitted. Body layers use theme opacity; the original rounded tile is outlined so its exact T stays visible without a fixed background.
export const microsoftteams = createLucideIcon("microsoftteamsPublisherMark", [
  [
    "path",
    {
      d: "M21.9999 20H33.9999C37.3136 20 39.9999 22.6863 39.9999 26V36C39.9999 39.3137 37.3136 42 33.9999 42C30.6862 42 27.9999 39.3137 27.9999 36V26C27.9999 22.6863 25.3136 20 21.9999 20Z",
      fill: "currentColor",
      stroke: "none",
      transform: "scale(0.5)",
      opacity: "0.4",
      key: "rear-body",
    },
  ],
  [
    "path",
    {
      d: "M7.99988 24C7.99988 20.6863 10.6862 18 13.9999 18H21.9999C25.3136 18 27.9999 20.6863 27.9999 24V36C27.9999 39.3137 30.6862 42 33.9999 42L17.9998 41.9999C12.477 41.9999 7.99988 37.5228 7.99988 31.9999V24Z",
      fill: "currentColor",
      stroke: "none",
      transform: "scale(0.5)",
      opacity: "0.4",
      key: "front-body",
    },
  ],
  [
    "path",
    {
      d: "M32.9999 18C35.7613 18 37.9999 15.7614 37.9999 13C37.9999 10.2386 35.7613 8 32.9999 8C30.2385 8 27.9999 10.2386 27.9999 13C27.9999 15.7614 30.2385 18 32.9999 18Z",
      fill: "currentColor",
      stroke: "none",
      transform: "scale(0.5)",
      opacity: "0.65",
      key: "rear-head",
    },
  ],
  [
    "path",
    {
      d: "M17.9999 16C21.3136 16 23.9999 13.3137 23.9999 10C23.9999 6.68629 21.3136 4 17.9999 4C14.6862 4 11.9999 6.68629 11.9999 10C11.9999 13.3137 14.6862 16 17.9999 16Z",
      fill: "currentColor",
      stroke: "none",
      transform: "scale(0.5)",
      key: "front-head",
    },
  ],
  [
    "rect",
    {
      x: "4",
      y: "23",
      width: "16",
      height: "16",
      rx: "3.25",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      transform: "scale(0.5)",
      key: "letter-tile",
    },
  ],
  [
    "path",
    {
      d: "M15.4792 28.1054H13.0321V35.5714H10.9673V28.1054H8.52014V26.4286H15.4792V28.1054Z",
      fill: "currentColor",
      stroke: "none",
      transform: "scale(0.5)",
      key: "publisher-t",
    },
  ],
]);

// https://delta.chat/assets/logos/delta-chat.svg
// Source SVG SHA-256: 58dfdd96cea4b5c62e6cac4bd5210e8dd4b039995a2d0ae4cb3a30c882e702fa
// Publisher bubble boundary and delta letter geometry; gradient backdrop omitted, outer contour rendered as theme linework. The source letter transform is retained.
export const deltachat = createLucideIcon("deltachatPublisherMark", [
  [
    "path",
    {
      d: "m24.015 1.287c-12.549 0-22.728 10.179-22.728 22.728s10.179 22.728 22.728 22.728c14.338-0.34288 9.6144-4.7027 23.698 0.96916-7.5455-13.002-1.083-13.33-0.96916-23.698 0-12.549-10.179-22.728-22.728-22.728z",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      transform: "translate(1.3 1.3) scale(0.44)",
      key: "bubble-outline",
    },
  ],
  [
    "path",
    {
      d: "m21.689 23.636q-1.028-1.1513-2.8578-2.755-2.0148-1.7681-2.7139-2.7755-0.69902-1.028-0.69902-2.241 0-1.8092 1.6859-2.8372 1.6859-1.0485 4.3997-1.0485t4.7287 0.92518q2.0354 0.92518 2.0354 2.5494 0 0.78126-0.49343 1.2952-0.49343 0.51399-1.1513 0.51399-0.94574 0-2.2204-1.4186-1.2952-1.4392-2.1999-2.0148-0.88406-0.59622-2.0765-0.59622-1.5214 0-2.5083 0.67846-0.9663 0.67846-0.9663 1.727 0 0.98686 0.80182 1.8504t4.1325 3.1456q3.5568 2.4466 5.0165 3.8241 1.4803 1.3775 2.4055 3.3512 0.92518 1.9737 0.92518 4.1736 0 3.8652-2.7344 6.8258-2.7139 2.94-6.3529 2.94-3.3101 0-5.5922-2.3643-2.2821-2.3643-2.2821-6.3118 0-3.8035 2.5083-6.3529 2.5288-2.5494 6.209-3.0839zm0.90462 0.94574q-5.9006 0.9663-5.9006 8.1004 0 3.6802 1.4597 5.7155 1.4803 2.0354 3.4334 2.0354 2.0354 0 3.3512-1.9532 1.3158-1.9737 1.3158-5.3249 0-4.852-3.6596-8.5733z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1.3 1.3) scale(0.44) scale(1.1122 0.89909)",
      key: "publisher-delta",
    },
  ],
]);

// https://briarproject.org/styleguide/images/briar_icon_black.svg
// Source SVG SHA-256: 7d130e3472ec4eb9a342152468daea2993cc91930151847a99d2b45bd4cc76a7
// Both exact publisher strand paths, uniformly scaled. Source color and editor metadata omitted.
export const briar = createLucideIcon("briarPublisherMark", [
  [
    "path",
    {
      d: "M25.014 0C21.3265 0 18.2864 3.06 18.2864 6.77175V15.3799H34.8592V6.77175C34.8592 3.06 31.856 0 28.1685 0H25.014ZM61.886 0C58.1984 0 55.1584 3.06 55.1584 6.77175V52.4936H71.7312V6.77175C71.7312 3.06 68.728 0 65.0404 0H61.886ZM18.2864 37.4182V83.14C18.2864 86.8518 21.2896 89.9118 25.014 89.9118H28.1685C31.856 89.9118 34.8961 86.8518 34.8961 83.14V37.4182H18.2864ZM55.1565 74.5319V83.14C55.1565 86.8518 58.1984 89.9118 61.8841 89.9118H65.0386C68.7262 89.9118 71.7662 86.8518 71.7662 83.14V74.5319C71.7681 74.5319 55.1565 74.5319 55.1565 74.5319Z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1.2 1.2) scale(0.24)",
      key: "publisher-strand-0",
    },
  ],
  [
    "path",
    {
      d: "M7.07237 18.0576C3.3848 18.0576 0.344727 21.0805 0.344727 24.8294V28.0045C0.344727 31.7162 3.34791 34.7762 7.07237 34.7762H52.4964V18.0576H7.07237ZM74.3912 18.0576V34.7781H82.9433C86.6308 34.7781 89.6709 31.7552 89.6709 28.0063V24.8312C89.6709 21.0823 86.6308 18.0595 82.9433 18.0595H74.3912V18.0576ZM7.07237 55.1713C3.3848 55.1713 0.344727 58.1942 0.344727 61.9431V65.1182C0.344727 68.8299 3.34791 71.8899 7.07237 71.8899H15.6244V55.1713H7.07237ZM37.5192 55.1713V71.8918H82.9433C86.6308 71.8918 89.6709 68.8299 89.6709 65.12V61.9449C89.6709 58.196 86.6308 55.1732 82.9433 55.1732L37.5192 55.1713Z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1.2 1.2) scale(0.24)",
      key: "publisher-strand-1",
    },
  ],
]);

// https://jami.net/content/images/2018/12/logo-jami.svg
// Source SVG SHA-256: 47dacb6b58fb39bf0e9fc0d5d4e48381c63e5a550811f35c5ab759a5be54c40f
// Compact ribbon emblem only; wordmark, tagline, gradient definitions and duplicate shading overlays omitted. Selected original ribbon paths retain their order, with theme opacity distinguishing the interwoven layers.
export const jami = createLucideIcon("jamiPublisherMark", [
  [
    "path",
    {
      d: "M55 52.3l7-.3-3.472 7z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.4",
      key: "publisher-ribbon-0",
    },
  ],
  [
    "path",
    {
      d: "M86 54c26.22 4.262 29.957 10.827 29.957 10.827.057.403.057.807 0 1.21-.058.23-.115.46-.23.633-.173.346-2.76 5.76-19.665 9.33L86 54z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.4",
      key: "publisher-ribbon-1",
    },
  ],
  [
    "path",
    {
      d: "M18.681 75c-6.013 16.016-2.89 21.179-2.717 21.472.115.235.231.41.462.528.405-.059.81-.117 1.214-.235 0 0 10.755-.528 23.36-18.714L18.681 75z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.4",
      key: "publisher-ribbon-2",
    },
  ],
  [
    "path",
    {
      d: "M59 14.728C44.519-.93 37.482-.07 37.074.045c-.232 0-.465.057-.697.172-.466.23-1.047 1.835-1.047 1.835S32.305 10.713 44.577 34L59 14.728z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.4",
      key: "publisher-ribbon-3",
    },
  ],
  [
    "path",
    {
      d: "M71 75.47c19.428 22.52 26.248 21.297 26.248 21.297.458.117.86.175 1.318.233.172-.175.344-.35.458-.524.287-.407 5.788-9.542-12.837-42.476L71 75.47z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.4",
      key: "publisher-ribbon-4",
    },
  ],
  [
    "path",
    {
      d: "M46 79C5.305 77.322.408 67.252.233 66.731.117 66.558 0 66.326 0 66.095c.058-.695 1.574-1.968 1.574-1.968S12.418 57.53 30.375 54L46 79z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.4",
      key: "publisher-ribbon-5",
    },
  ],
  [
    "path",
    {
      d: "M73.672 32c10.731-25.07 6.51-30.815 6.51-30.815-.06-.349-.177-.639-.294-.987a1.575 1.575 0 0 0-.704-.174C78.657-.034 67.514-1.485 44 31.13l29.672.87z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.4",
      key: "publisher-ribbon-7",
    },
  ],
  [
    "path",
    {
      d: "M59 95.127c-14.489 15.842-21.528 14.903-21.939 14.844a5.236 5.236 0 0 1-1.7-.88L17 97.181C24.45 95.597 34.246 87.324 43.925 76L59 95.127z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.65",
      key: "publisher-ribbon-9",
    },
  ],
  [
    "path",
    {
      d: "M19.929 35c-6.32-16.453-3.16-21.686-2.988-21.977.402-.465.92-.872 1.436-1.22L36.36 0C34.865 7.21 38.083 18.895 44 31.744L19.929 35z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.65",
      key: "publisher-ribbon-12",
    },
  ],
  [
    "path",
    {
      d: "M86 55.176c13.59 1.989 24.875 5.617 30 10.824V44.234c0-.644-.058-1.287-.23-1.872-.173-.351-2.707-5.734-19.117-9.362L86 55.176z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.8",
      key: "publisher-ribbon-14",
    },
  ],
  [
    "path",
    {
      d: "M73.523 30.405c-3.088-.173-9.73-.405-15.38-.405C6.232 30 .465 41.98.232 42.502A7.145 7.145 0 0 0 0 44.412V66c5.069-5.035 16.196-8.566 29.712-10.592 8.739-1.273 17.536-1.91 26.391-1.967h4.836c2.388 0 15.73-22.862 12.584-23.036z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      opacity: "0.8",
      key: "publisher-ribbon-17",
    },
  ],
  [
    "path",
    {
      d: "M78.112 67.915c28.168-43.198 21.213-54.517 20.923-54.979-.405-.462-.927-.866-1.449-1.213L79.445 0C81.995 11.954 71.968 34.94 58 55.96c4.695 7.162 9.563 14.092 14.664 20.04.985-1.097 3.535-5.198 5.448-8.085z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      key: "publisher-ribbon-20",
    },
  ],
  [
    "path",
    {
      d: "M72.814 77.297a190.663 190.663 0 0 1-14.89-19.82c-.521-.806-1.1-1.613-1.622-2.477-8.806.058-17.612.691-26.302 1.901.29.519 4.345 7.26 7.3 11.754 28.156 43.096 41.307 41.425 41.886 41.31a5.182 5.182 0 0 0 1.68-.864L99 97.405c-7.416-1.498-16.859-9.334-26.186-20.108z",
      fill: "currentColor",
      stroke: "none",
      transform: "translate(1 1.67) scale(0.19)",
      key: "publisher-ribbon-23",
    },
  ],
]);

// https://nextcloud.com/c/uploads/2022/10/nc-talk-icon-blue.svg
// Source SVG SHA-256: a1a7cd4a5bdf69f97ca7b8f76dd62f8a8582a3cee22d1796f5c49460042a21cd
// Exact product bubble/ring path, not the generic Nextcloud brand. Theme fill and even-odd counter replace source CSS.
export const nextcloudtalk = createLucideIcon("nextcloudtalkPublisherMark", [
  [
    "path",
    {
      d: "M8,1C4.1,1,1,4.1,1,8c0,0,0,0,0,0c0,3.9,3.1,7,7,7c1.3,0,2.5-0.4,3.6-1c0.9,0.3,2.8,1.4,3.2,0.9 c0.5-0.5-0.6-2.6-0.8-3.4C14.7,10.4,15,9.2,15,8C15,4.1,11.9,1,8,1L8,1z M8,3.7c2.4,0,4.3,1.9,4.3,4.3c0,0,0,0,0,0 c0,2.4-1.9,4.3-4.3,4.3S3.7,10.4,3.7,8C3.7,5.6,5.6,3.7,8,3.7C8,3.7,8,3.7,8,3.7z",
      fill: "currentColor",
      stroke: "none",
      transform: "scale(1.5)",
      fillRule: "evenodd",
      key: "publisher-talk",
    },
  ],
]);

export const MESSAGING_PUBLISHER_BRAND_ICONS = {
  microsoftteams,
  deltachat,
  briar,
  jami,
  nextcloudtalk,
} as const;
export type MessagingPublisherBrandIconName =
  keyof typeof MESSAGING_PUBLISHER_BRAND_ICONS;
