/**
 * Whitebox tool contract.
 *
 * A tool is data, not a page. The shell derives its layout from the shape of
 * `inputs`, so consistency is structural rather than a thing we remember to do.
 */

export type FieldType =
  | 'textarea'
  | 'text'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'range'
  | 'color';

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  /** Shown under the label, small and dim. */
  hint?: string;
  placeholder?: string;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  /** Render the control in monospace (payload-bearing fields). */
  mono?: boolean;
  /** Sample content used for the live-demo empty state. */
  sample?: string;
}

export type Values = Record<string, string | number | boolean>;

export interface OutputBlock {
  /** Shown above the block when a tool emits several outputs. */
  label?: string;
  text: string;
  /** Rendered as HTML instead of text; used for tables and match lists. */
  html?: string;
  /** e.g. "SHA-256 · hex · lowercase" — appears next to the copy button. */
  meta?: string;
  /** Suggested download filename; enables the download button. */
  filename?: string;
  /** Suppress the copy button (for rendered-only blocks like QR canvases). */
  nocopy?: boolean;
}

export interface RunResult {
  blocks?: OutputBlock[];
  /** Single-output shorthand. */
  text?: string;
  meta?: string;
  /** Non-fatal note shown under the input that caused it. */
  warning?: string;
  /** Attached to a field id so the message lands next to its cause. */
  errorField?: string;
}

export class ToolError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

export interface ToolImpl {
  /** Pure where possible; async only because WebCrypto and wasm are async. */
  run(v: Values): RunResult | Promise<RunResult>;
  /** Re-run on a timer (TOTP). Milliseconds. */
  tick?: number;
  /** Called after render for tools that paint into the DOM (QR). */
  paint?: (root: HTMLElement, v: Values) => void | Promise<void>;
}

export type Category = 'encode' | 'generate' | 'convert' | 'inspect';

export interface ToolMeta {
  slug: string;
  name: string;
  blurb: string;
  category: Category;
  /** What people actually type. This list is the product's best content. */
  aliases: string[];
  inputs: Field[];
  /**
   * Secret-bearing: no URL state, no localStorage, privacy pill shown.
   * Applies to anything a user might paste a credential into.
   */
  sensitive?: boolean;
  /** Force the stacked "workbench" layout regardless of input shape. */
  workbench?: boolean;
  /** Primary action button label for tools that generate on demand. */
  action?: string;
}

/** Layout is derived, never hand-assigned. */
export function layoutOf(meta: ToolMeta): 'split' | 'output' | 'workbench' {
  if (meta.workbench) return 'workbench';
  const areas = meta.inputs.filter((f) => f.type === 'textarea');
  if (areas.length === 0) return 'output';
  if (areas.length === 1) return 'split';
  return 'workbench';
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'encode', label: '编码与解码' },
  { id: 'generate', label: '生成' },
  { id: 'convert', label: '转换' },
  { id: 'inspect', label: '检视' },
];
