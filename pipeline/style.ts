/**
 * The fixed visual style. Every image prompt is this preamble plus one
 * word-specific clause, so the site looks like one series rather than
 * thirty unrelated pictures. Change it rarely and deliberately: a change
 * here changes the look of every future day.
 */

export const IMAGE_WIDTH = 1024;
export const IMAGE_HEIGHT = 1024;

export const STYLE_PREAMBLE =
  'Square editorial illustration in the style of a vintage risograph print. ' +
  'Limited palette of deep teal, warm vermilion and ochre on cream paper, with visible paper grain, ' +
  'slight ink misregistration and subtle halftone shading. Flat, simple shapes and a calm composition ' +
  'with generous negative space. No text, no letters, no words, no signature, no border.';

/** Added only when style-anchor images are sent along with the prompt. */
export const REFERENCE_INSTRUCTION =
  'Match the visual style, palette, texture and medium of the reference images, ' +
  'but do not reuse their subjects, objects or composition.';

/**
 * Builds the full prompt sent to the image provider. The result is stored in
 * the entry's image.prompt field, so any image can be reproduced later.
 */
export function buildImagePrompt(clause: string, options: { withReferences: boolean }): string {
  const subject = clause.trim().replace(/[.\s]+$/, '');
  const parts = [STYLE_PREAMBLE];
  if (options.withReferences) parts.push(REFERENCE_INSTRUCTION);
  parts.push(`Subject: ${subject}.`);
  return parts.join(' ');
}
