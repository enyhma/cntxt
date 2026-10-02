// Dot/avatar colors are derived from a hash of a stable id rather than
// stored, so tabs (and workspaces without an explicit color) get a
// consistent color without a schema migration. Paired with a matching
// *-txt role (not always white — a light accent theme like Brass on
// Obsidian needs dark ink on its own hue) so a color that happens to land
// on the active theme's accent color stays legible.
export const COLOR_KEYS = [
  "accent",
  "success",
  "warning",
  "info",
  "danger",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_CLASS: Record<ColorKey, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  danger: "bg-danger",
};

export const COLOR_TXT_CLASS: Record<ColorKey, string> = {
  accent: "text-accent-txt",
  success: "text-success-txt",
  warning: "text-warning-txt",
  info: "text-info-txt",
  danger: "text-danger-txt",
};

export function hashColorKey(seed: string): ColorKey {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return COLOR_KEYS[hash % COLOR_KEYS.length]!;
}

export function colorFor(seed: string): string {
  return COLOR_CLASS[hashColorKey(seed)];
}

export function textColorFor(seed: string): string {
  return COLOR_TXT_CLASS[hashColorKey(seed)];
}

export function workspaceColorKey(
  w: { id: string; color?: string } | undefined,
): ColorKey {
  return (w?.color as ColorKey | undefined) ?? hashColorKey(w?.id ?? "cntxt");
}

export function workspaceDotClass(
  w: { id: string; color?: string } | undefined,
): string {
  return COLOR_CLASS[workspaceColorKey(w)];
}

export function workspaceTxtClass(
  w: { id: string; color?: string } | undefined,
): string {
  return COLOR_TXT_CLASS[workspaceColorKey(w)];
}

export function domainOf(url: string): string {
  return url.replace(/^https?:\/\//, "").split("/")[0] || url;
}
