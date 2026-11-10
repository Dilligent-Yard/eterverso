/**
 * Narrow facade for the untouched CommonJS rich-text module.
 *
 * Only the exports consumed by `src/node/public-sandbox/import/` are declared.
 * `server/content.js` remains the implementation and runtime authority; these
 * signatures describe the validated inputs/outputs that the import island uses.
 */
export interface SanitizeHtmlOptions {
  maxBytes?: number;
}

export function sanitizeUrl(
  value: string,
  options?: { image?: boolean; allowedImagePaths?: readonly string[] },
): string | null;

export function sanitizeHtml(input: string, options?: SanitizeHtmlOptions): string;

export function sanitizeBlocks(blocks: unknown, options?: { maxBytes?: number }): unknown[];

export function plainTextFromHtml(html: string, options?: SanitizeHtmlOptions): string;
