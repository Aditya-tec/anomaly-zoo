export const DEFAULT_OG: string;
export function ogSlugs(manifest: { scenarios: { id: string }[] }): string[];
export function ogInputsHash(root: string, manifest: unknown, slug: string): string;
