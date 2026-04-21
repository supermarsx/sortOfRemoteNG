/** Merge CSS class names, filtering out falsy values. */
export const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');
