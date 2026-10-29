/**
 * Compactação de conteúdo vindo de ferramentas antes de virar prompt upstream.
 *
 * O 1min.ai é um *orquestrador*: quando o prompt carrega uma URL, o upstream
 * decide fazer crawling da página. Payloads típicos de ferramentas (JSON Schema
 * com `$id`, `$schema`, links de documentação) viram, então, um monte de
 * "Crawling site https://..." no meio da resposta — a chamada não falha, mas o
 * modelo recebe lixo em vez do resultado da ferramenta.
 *
 * Aqui neutralizamos URLs para que o upstream não as reconheça como alvo de
 * crawl, e compactamos JSON Schemas (JSON Schema é a fonte mais comum desse
 * tipo de payload).
 */

/** Esquemas JSON não precisam de mais que isso para o modelo acertar os campos. */
const SCHEMA_DEPTH_LIMIT = 4;
const SCHEMA_KEY_LIMIT = 24;

/** Placeholders por esquema, preservando host + caminho final legível. */
const URL_PLACEHOLDERS: Array<[RegExp, string]> = [
  // JSON Schema meta-schema: o modelo não usa isso para nada
  [/^https?:\/\/json-schema\.org\/[^\s"')]*$/i, "[esquema JSON Schema]"],
  [/^https?:\/\/www\.w3\.org\/[^\s"')]*$/i, "[namespace XML]"],
  [/^https?:\/\/localhost[^\s"')]*$/i, "[URL local]"],
];

const URL_PATTERN = /https?:\/\/[^\s"'<>()]+/gi;

function compactUrl(rawUrl: string): string {
  const withoutHash = rawUrl.replace(/[.,;:!?]+$/, "");

  for (const [pattern, placeholder] of URL_PLACEHOLDERS) {
    if (pattern.test(withoutHash)) return placeholder;
  }

  try {
    const parsed = new URL(withoutHash);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
    const tail = lastSegment ? `…/${lastSegment}` : "";
    // Sem "://" o upstream não reconhece como URL e não tenta crawlear.
    return `[link: ${parsed.host}${tail}]`;
  } catch {
    return "[link]";
  }
}

export function neutralizeUrls(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text.replace(URL_PATTERN, (match) => compactUrl(match));
}

/**
 * Reduz um JSON Schema (ou qualquer objeto) mantendo o que o modelo precisa:
 * names/properties/types/descrições. `$id`/`$schema` são descartados.
 */
export function compactSchema(
  schema: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (schema === null || typeof schema !== "object") return schema;
  if (depth >= SCHEMA_DEPTH_LIMIT) return "…";
  if (seen.has(schema as object)) return "[circular]";
  seen.add(schema as object);

  if (Array.isArray(schema)) {
    return schema
      .slice(0, SCHEMA_KEY_LIMIT)
      .map((item) => compactSchema(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(schema as Record<string, unknown>).slice(
    0,
    SCHEMA_KEY_LIMIT,
  );
  for (const [key, value] of entries) {
    if (key === "$schema" || key === "$id" || key === "$comment") continue;
    if (typeof value === "string") {
      result[key] =
        key === "description" || key === "title"
          ? value.slice(0, 200)
          : neutralizeUrls(value);
      continue;
    }
    result[key] = compactSchema(value, depth + 1, seen);
  }
  return result;
}

export interface CompactionResult {
  text: string;
  changed: boolean;
  urlsNeutralized: number;
}

/** Pipeline completo: compacta JSON embutido e neutraliza URLs soltas. */
export function compactToolPayload(raw: string): CompactionResult {
  if (!raw || typeof raw !== "string") {
    return { text: "", changed: false, urlsNeutralized: 0 };
  }

  let text = raw;
  const trimmed = text.trim();

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      text = JSON.stringify(compactSchema(parsed));
    } catch {
      // Payload não é JSON válido: segue para a neutralização por regex
    }
  }

  const before = (text.match(URL_PATTERN) ?? []).length;
  const neutralized = neutralizeUrls(text);
  const after = (neutralized.match(URL_PATTERN) ?? []).length;

  return {
    text: neutralized,
    changed: neutralized !== raw,
    urlsNeutralized: Math.max(before - after, 0),
  };
}
