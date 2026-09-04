import type { ToolMeta, ToolImpl } from './types.ts';
import * as E from './tools/encode.ts';
import * as G from './tools/generate.ts';
import * as C from './tools/convert.ts';
import * as I from './tools/inspect.ts';

const ENTRIES: [ToolMeta, ToolImpl][] = [
  E.base64, E.urlcodec, E.htmlent, E.hexcodec, E.unicode, E.jwt,
  G.password, G.uuid, G.hash, G.hmac, G.keypair, G.totp, G.qr,
  C.json, C.configconv, C.timestamp, C.numbase, C.color, C.csvjson, C.cron,
  I.regex, I.diff, I.textstats, I.casing, I.cidr,
];

export const TOOLS: ToolMeta[] = ENTRIES.map(([m]) => m);
export const IMPLS: Record<string, ToolImpl> = Object.fromEntries(
  ENTRIES.map(([m, i]) => [m.slug, i]),
);
export const getTool = (slug: string) => TOOLS.find((t) => t.slug === slug);
