/**
 * Wrapper de fetch para APIs upstream (1min.ai).
 *
 * Cloudflare intercepta requisicoes a montante quando a zona de destino tem
 * WAF / "Bot Fight Mode" / regras de bloqueio de bot ativas: em vez do JSON da
 * API, volta um HTML de erro (tipicamente "Error 1010 - Access denied", com
 * status 403). Sem isto o cliente recebe apenas "[403] Forbidden <!doctype html>",
 * que parece uma falha do gateway quando na verdade veio do upstream.
 */

export const CLOUDFLARE_BLOCK_MARKERS = [
  "cf-error-details",
  "Error 1010",
  "Access denied |",
  "Attention Required! | Cloudflare",
];

/**
 * Nao e erro HTTP: o upstream responde 200, mas o modelo dele em vez da
 * resposta final devolve o rastro de execucao da busca/1min.ai, p.ex.
 * "🌐 Crawling site https://json-schema.org/...". Sintoma classico de payload
 * com URL no prompt (JSON Schema, doc links) — o upstream tenta crawlear.
 */
export const UPSTREAM_CRAWL_MARKERS = ["Crawling site", "crawling site"];

export function looksLikeCrawlLeak(text: string): boolean {
  if (!text) return false;
  return UPSTREAM_CRAWL_MARKERS.some((marker) => text.includes(marker));
}

export function formatCrawlLeakMessage(rawText: string): string {
  const sites = [...rawText.matchAll(/Crawling site\s+(\S+)/gi)]
    .map((m) => m[1])
    .slice(0, 3);
  const list = sites.length > 0 ? ` (${sites.join(", ")})` : "";
  return (
    `Upstream 1min.ai tried to crawl the URL(s) found in the prompt${list} instead of ` +
    "answering, and returned the crawl trace as the model output. " +
    "The gateway answered correctly (HTTP 200); this is upstream tool-search behavior. " +
    "Fix it on the client side: when a tool returns JSON Schema / docs / any payload with URLs, " +
    "summarize it in plain text before sending it back (or strip $schema/$id and link fields), " +
    "disable web search (avoid the :online suffix), or attach the site as a 1min.ai asset."
  );
}

export interface UpstreamErrorDetails {
  status: number;
  statusText: string;
  blocked: boolean;
  rayId?: string;
  host?: string;
  contentType: string;
}

function extract(text: string, re: RegExp): string | undefined {
  return re.exec(text)?.[1]?.trim() || undefined;
}

export function describeUpstreamError(
  response: Response,
  rawBody: string,
): UpstreamErrorDetails {
  const contentType = response.headers.get("Content-Type") ?? "";
  const looksLikeHtml =
    contentType.includes("text/html") ||
    /^\s*<!doctype html/i.test(rawBody) ||
    /^\s*<html/i.test(rawBody);

  const looksLikeCloudflare = CLOUDFLARE_BLOCK_MARKERS.some((marker) =>
    rawBody.includes(marker),
  );

  return {
    status: response.status,
    statusText: response.statusText,
    blocked: looksLikeHtml && looksLikeCloudflare,
    rayId:
      extract(rawBody, /Ray ID:\s*(?:<strong[^>]*>)?([a-f0-9]{16,})/i) ??
      extract(rawBody, /cf-ray[^>]*>\s*([a-f0-9]{16,})/i),
    host: extract(rawBody, /<title>Access denied \|\s*([^<\s]+)/i),
    contentType,
  };
}

export function formatUpstreamBlockMessage(
  details: UpstreamErrorDetails,
  url: string,
): string {
  const host = details.host ?? new URL(url).host;
  const ray = details.rayId ? `, Ray ID ${details.rayId}` : "";
  return (
    `Upstream ${host} blocked this request at the edge (HTTP ${details.status}, ` +
    `Cloudflare${ray}). The response was an HTML challenge/interstitial, not the API JSON. ` +
    "Fix it on the upstream zone: disable Bot Fight Mode / the WAF rule blocking " +
    "server-side clients, allow server-to-server traffic, or allowlist the Worker egress. " +
    "The gateway itself answered correctly."
  );
}
