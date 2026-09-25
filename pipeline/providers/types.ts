/**
 * The seams between the pipeline and the outside world.
 *
 * Each interface has a real implementation and a mock one. The pipeline only
 * ever talks to these interfaces, so switching provider is a config change
 * (see providers/index.ts) and tests can pass in scripted fakes.
 *
 * Providers stay deliberately dumb: a TextProvider returns the model's raw
 * reply, and an ImageProvider returns raw bytes. Parsing, validation, retries
 * and storage all live in the pipeline, so they behave the same whichever
 * provider is plugged in.
 */

// ---------------------------------------------------------------------------
// Source material (etymology input)
// ---------------------------------------------------------------------------

/** One dictionary entry we fetched, e.g. the English or the Latin section of a Wiktionary page. */
export interface SourceSection {
  url: string;
  language: string;
  title: string;
  etymology: string;
  pronunciations: string[];
  definitions: string[];
}

export interface SourceMaterial {
  word: string;
  /** Every URL the material came from. Copied verbatim into `etymologySources`. */
  urls: string[];
  sections: SourceSection[];
}

export interface SourceProvider {
  readonly name: string;
  /** Returns null when there is no usable etymology. The pipeline then skips the word. */
  fetch(word: string): Promise<SourceMaterial | null>;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TextRequest {
  system: string;
  messages: ChatMessage[];
  /** Deterministic per (date, word). Mock providers use it; most real APIs ignore it. */
  seed: number;
  /** The word being written about. Real providers get it via the prompt; the mock uses it directly. */
  word: string;
}

export interface TextProvider {
  readonly name: string;
  readonly model: string;
  /** Returns the model's reply as raw text. */
  complete(request: TextRequest): Promise<string>;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface ImageRequest {
  /** The full prompt: fixed style preamble plus the word-specific clause. */
  prompt: string;
  width: number;
  height: number;
  /** Style anchors. Only sent when the provider supports reference images. */
  referenceImageUrls: string[];
  seed: number;
  /** The word being illustrated. Real providers ignore it; the mock draws it. */
  word: string;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
  /** File extension without the dot, e.g. "jpg" or "svg". */
  extension: string;
}

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsReferenceImages: boolean;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}

/** Where generated images are kept: S3-compatible storage, or public/mock-images locally. */
export interface ImageStore {
  readonly name: string;
  /** Saves the image under `key` and returns the public URL it can be loaded from. */
  put(key: string, image: GeneratedImage): Promise<string>;
}
