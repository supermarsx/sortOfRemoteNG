import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

/** App-authored single-line glyphs on a shared 24px grid; no font dependency. */
const DIGITS = [
  ["0", "zero", "M12 4c-4 0-5 3-5 8s1 8 5 8 5-3 5-8-1-8-5-8Zm-4 13 8-10"],
  ["1", "one", "m8 8 4-4v16M8 20h8"],
  ["2", "two", "M7 8a5 5 0 0 1 10 0c0 3-4 5-10 12h10"],
  ["3", "three", "M7 5c3-2 10-1 10 3 0 3-3 4-6 4 3 0 6 1 6 4 0 4-7 5-10 3"],
  ["4", "four", "m15 4-9 11h12M15 4v16"],
  ["5", "five", "M17 4H8l-1 8c4-2 10-1 10 3 0 5-7 6-10 3"],
  ["6", "six", "M16 4C9 3 7 8 7 14c0 8 10 8 10 1 0-5-7-6-10-1"],
  ["7", "seven", "M6 4h12L9 20"],
  ["8", "eight", "M12 4c-7 0-7 8 0 8s7-8 0-8Zm0 8c-8 0-8 8 0 8s8-8 0-8Z"],
  ["9", "nine", "M8 20c7 1 9-4 9-10 0-8-10-8-10-1 0 5 7 6 10 1"],
] as const;

const LETTERS = [
  ["a", "A", "m5 20 7-16 7 16M8 14h8"],
  ["b", "B", "M6 20V4h7c6 0 6 8 0 8H6m7 0c7 0 7 8 0 8H6"],
  ["c", "C", "M18 6c-7-6-13 0-13 6s6 12 13 6"],
  ["d", "D", "M6 4h5c10 0 10 16 0 16H6V4Z"],
  ["e", "E", "M18 4H6v16h12M6 12h10"],
  ["f", "F", "M18 4H6v16M6 12h10"],
  ["g", "G", "M18 6C11 0 5 6 5 12s6 12 13 6v-6h-6"],
  ["h", "H", "M6 4v16M18 4v16M6 12h12"],
  ["i", "I", "M7 4h10M12 4v16M7 20h10"],
  ["j", "J", "M9 4h9m-2 0v11c0 7-10 7-10 0"],
  ["k", "K", "M6 4v16M18 4 6 14m5-5 7 11"],
  ["l", "L", "M6 4v16h12"],
  ["m", "M", "M4 20V4l8 10 8-10v16"],
  ["n", "N", "M6 20V4l12 16V4"],
  ["o", "O", "M12 4C3 4 3 20 12 20s9-16 0-16Z"],
  ["p", "P", "M6 20V4h7c7 0 7 9 0 9H6"],
  ["q", "Q", "M12 4C3 4 3 20 12 20s9-16 0-16Zm2 12 6 6"],
  ["r", "R", "M6 20V4h7c7 0 7 8 0 8H6m6 0 6 8"],
  ["s", "S", "M18 6C13 1 5 4 6 8c1 4 11 4 12 8 1 4-7 7-12 2"],
  ["t", "T", "M4 4h16M12 4v16"],
  ["u", "U", "M6 4v10c0 8 12 8 12 0V4"],
  ["v", "V", "m5 4 7 16 7-16"],
  ["w", "W", "m3 4 4 16 5-10 5 10 4-16"],
  ["x", "X", "m6 4 12 16M18 4 6 20"],
  ["y", "Y", "m5 4 7 9 7-9m-7 9v7"],
  ["z", "Z", "M6 4h12L6 20h12"],
] as const;

export const ALPHANUMERIC_MARKER_ICONS = [
  ...DIGITS.map(([digit, name, d]) =>
    defineIcon(
      `number-${digit}`,
      `Number ${digit}`,
      "generic-shapes",
      createLucideIcon(`Number${digit}`, [
        ["path", { d, key: `digit-${digit}` }],
      ]),
      [
        digit,
        `number ${digit}`,
        `digit ${digit}`,
        name,
        `number ${name}`,
        "numeric",
        "marker",
      ],
      `App-authored number ${digit} vector marker; no font or external asset required.`,
    ),
  ),
  ...LETTERS.map(([key, letter, d]) =>
    defineIcon(
      `letter-${key}`,
      `Letter ${letter}`,
      "generic-shapes",
      createLucideIcon(`Letter${letter}`, [
        ["path", { d, key: `letter-${key}` }],
      ]),
      [
        letter,
        `letter ${letter}`,
        `alphabet ${letter}`,
        "alphabetic",
        "uppercase",
        "marker",
      ],
      `App-authored uppercase ${letter} vector marker; no font or external asset required.`,
    ),
  ),
] as const;
