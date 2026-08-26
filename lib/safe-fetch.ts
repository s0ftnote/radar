import type { LookupFunction } from "node:net";
import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { RadarDomainError } from "./domain-error.js";

/**
 * 用户粘进来的地址会由 Radar 这台本机服务去请求，它坐在用户的内网里——
 * 不加防护就是一个 SSRF 跳板：`http://127.0.0.1:5432`、`http://192.168.1.1`、
 * 云上的 `169.254.169.254` 元数据端点，都在这台机器够得着的范围里。
 *
 * 所以：先把域名解析成 IP，逐个核对，然后**把连接钉在那个 IP 上**——网址、
 * Host 头、TLS 的 SNI 全都保持原样。核对完再让 fetch 自己解析一次，中间那次
 * 解析可以换答案，那正是 DNS 重绑定。重定向逐跳复核，同一套规则再走一遍。
 */
export class BlockedAddressError extends RadarDomainError {
  constructor(host: string, reason: string) {
    super(`不去请求 ${host}：${reason}`, 400);
  }
}

export type SafeFetchOptions = {
  accept?: string;
  /**
   * 只对**第一跳**放行私网地址。用户自己填的端点地址可以指着内网——自建的
   * RSSHub、局域网里的服务，那是他自己的决定。重定向之后的每一跳照样严查：
   * 一个公网 feed 把你弹到 127.0.0.1，那不是用户的决定。
   */
  allowPrivateOrigin?: boolean;
  timeoutMilliseconds?: number;
  maximumBytes?: number;
  maximumRedirects?: number;
};

const defaults = {
  timeoutMilliseconds: 10_000,
  maximumBytes: 5_000_000,
  maximumRedirects: 5,
};

export type SafeResponse = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

/** 只做地址核对，不发请求——粘网址那一刻先把不该请求的地址挡在门外。 */
export async function assertAllowedAddress(rawUrl: string): Promise<void> {
  await resolveAllowedAddress(parseHttpUrl(rawUrl), false);
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? defaults.timeoutMilliseconds;
  const maximumBytes = options.maximumBytes ?? defaults.maximumBytes;
  const maximumRedirects = options.maximumRedirects ?? defaults.maximumRedirects;
  // 超时算整趟，不是每一跳——不然 N 次重定向就是 N 倍时间。
  const deadline = AbortSignal.timeout(timeoutMilliseconds);

  let target = parseHttpUrl(rawUrl);
  try {
    return await followRedirects();
  } catch (error) {
    // 整趟超时的那一刻，底下抛出来的是一句 abort。换成人话，不然用户在
    // 「无法连接来源」后面看到的是 `This operation was aborted`。
    if (deadline.aborted) {
      throw new RadarDomainError(
        `请求 ${target.hostname} 超过 ${Math.round(timeoutMilliseconds / 1000)} 秒还没读完，不再等了。`,
        400,
      );
    }
    throw error;
  }

  async function followRedirects(): Promise<SafeResponse> {
    for (let hop = 0; hop <= maximumRedirects; hop += 1) {
      const address = await resolveAllowedAddress(
        target,
        hop === 0 && options.allowPrivateOrigin === true,
      );
      const response = await requestOnce(target, address, options.accept, deadline);

      const location = response.headers.get("location");
      if (isRedirect(response.status) && location) {
        // 每一跳都从头核对一遍：第一跳合规不代表它指过去的地方也合规。
        response.body?.cancel().catch(() => {});
        target = parseHttpUrl(new URL(location, target).toString());
        continue;
      }

      if (!response.ok) {
        throw new RadarDomainError(`${target.hostname} 返回 HTTP ${response.status}。`, 400);
      }
      return {
        url: target.toString(),
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: await readCapped(response, maximumBytes),
      };
    }
    throw new RadarDomainError(`${rawUrl} 的重定向超过 ${maximumRedirects} 跳，不再跟下去。`, 400);
  }
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RadarDomainError(`${raw} 不是一个网址。`, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedAddressError(url.protocol, "只请求 http 与 https。");
  }
  // 凭据写在网址里就会随重定向被带走。
  if (url.username || url.password) {
    throw new BlockedAddressError(url.hostname, "网址里不要带用户名密码。");
  }
  return url;
}

/**
 * 解析出来的**每一个**地址都得合规。只看第一个不够：一个域名可以同时给出
 * 一个公网地址和一个内网地址，连的时候挑哪个不归我们说了算。
 */
async function resolveAllowedAddress(url: URL, allowPrivate: boolean): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIPv4(host) || isIPv6(host)) {
    if (!allowPrivate) rejectIfBlocked(host, url.hostname);
    return host;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new RadarDomainError(`解析不出 ${host} 的地址。`, 400);
  }
  if (addresses.length === 0) throw new RadarDomainError(`解析不出 ${host} 的地址。`, 400);
  if (!allowPrivate) for (const { address } of addresses) rejectIfBlocked(address, host);
  return addresses[0]!.address;
}

function rejectIfBlocked(address: string, host: string): void {
  const reason = blockedReason(address);
  if (reason) throw new BlockedAddressError(host, reason);
}

/** 私网、回环、链路本地（含云元数据 169.254.169.254）、以及各种「这台机器」。 */
function blockedReason(address: string): string | null {
  if (isIPv4(address)) return blockedIPv4Reason(address);
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return "那是这台机器自己。";
  // IPv4-mapped / IPv4-compatible 的 IPv6 写法绕不过去：`::ffff:127.0.0.1` 就是
  // 127.0.0.1，而 URL 解析会把它写成 `::ffff:7f00:1`——两种写法都得认。
  if (lower.startsWith("::")) {
    const embedded = embeddedIPv4(lower);
    return embedded ? blockedIPv4Reason(embedded) : "那是 IPv4 映射地址，按它映射的地址算。";
  }
  if (/^f[cd]/.test(lower)) return "那是内网地址。";
  if (/^fe[89ab]/.test(lower)) return "那是链路本地地址。";
  // 还有两种把 IPv4 包在 IPv6 里的写法：NAT64 的 64:ff9b::/96 与 6to4 的
  // 2002::/16。它们最后落到的还是那个 IPv4 地址，按那个地址算。
  const translated = translatedIPv4(lower);
  if (translated) return blockedIPv4Reason(translated);
  return null;
}

/** `::ffff:127.0.0.1` 与 `::ffff:7f00:1` 是同一个地址，都还原成点分写法。 */
function embeddedIPv4(lower: string): string | null {
  const dotted = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1]!;

  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex) return null;
  return dottedFromHextets(hex[1]!, hex[2]!);
}

/** NAT64（`64:ff9b::a9fe:a9fe`）与 6to4（`2002:a9fe:a9fe::`）里包着的那个 IPv4。 */
function translatedIPv4(lower: string): string | null {
  const nat64 = /^64:ff9b:(?::0)*:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (nat64) return dottedFromHextets(nat64[1]!, nat64[2]!);
  const nat64Dotted = /^64:ff9b:(?::0)*:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (nat64Dotted) return nat64Dotted[1]!;
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/.exec(lower);
  if (sixToFour) return dottedFromHextets(sixToFour[1]!, sixToFour[2]!);
  return null;
}

function dottedFromHextets(highHextet: string, lowHextet: string): string {
  const high = Number.parseInt(highHextet, 16);
  const low = Number.parseInt(lowHextet, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function blockedIPv4Reason(address: string): string | null {
  const [a, b] = address.split(".").map(Number) as [number, number, number, number];
  if (a === 127 || a === 0) return "那是这台机器自己。";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return "那是内网地址。";
  }
  if (a === 169 && b === 254) return "那是链路本地地址，云上的元数据端点也在这一段。";
  if (a === 100 && b >= 64 && b <= 127) return "那是运营商级内网地址。";
  if (a === 192 && b === 0) return "那是 IETF 保留地址。";
  // 198.18.0.0/15 是给网络设备做基准测试的保留段，看着该挡，但挡不得：
  // 开着 fake-ip 的代理（Clash 那一类）就把所有域名解析到这一段，挡了等于
  // 让 Radar 在那些机器上完全不能采集。

  if (a >= 224) return "那不是一个能请求的单播地址。";
  return null;
}

/**
 * 核对过的是 IP，那就把这一次连接钉死在这个 IP 上：换掉解析函数，网址、Host
 * 头、TLS 的 SNI 全不动。改写网址里的主机名也能钉住地址，但那样 Host 头和
 * 证书校验就都对着 IP 了——虚拟主机会给错站点，https 直接连不上。
 */
function requestOnce(
  url: URL,
  address: string,
  accept: string | undefined,
  signal: AbortSignal,
): ReturnType<typeof undiciFetch> {
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(address) } });
  return undiciFetch(url, {
    headers: accept ? { accept } : {},
    redirect: "manual",
    signal,
    dispatcher,
  }).finally(() => void dispatcher.close().catch(() => {}));
}

/** 解析已经做过了，这里只把那一个答案交回去。 */
function pinnedLookup(address: string): LookupFunction {
  const family = isIPv6(address) ? 6 : 4;
  return ((_hostname, options, callback) => {
    if (options && typeof options === "object" && options.all) {
      (callback as (error: null, addresses: Array<{ address: string; family: number }>) => void)(
        null,
        [{ address, family }],
      );
      return;
    }
    (callback as (error: null, address: string, family: number) => void)(null, address, family);
  }) as LookupFunction;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * 按 chunk 累加，超上限立刻断开。信 `content-length` 没用——恶意的一方
 * 想报多少就报多少，甚至可以不报。
 */
async function readCapped(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  maximumBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        throw new RadarDomainError(
          `响应超过 ${Math.round(maximumBytes / 1_000_000)} MB，不再读下去。`,
          400,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
