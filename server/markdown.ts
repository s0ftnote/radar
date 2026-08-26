import MarkdownIt from "markdown-it";
import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * Brief 正文与判断的四问都是 Agent 写的，写的时候按 Markdown 写——列表、加粗、
 * 分段。当纯文本摆出来，一段判断标准就成了一坨挤在一起的星号。
 *
 * 这些文本来自 Agent 与第三方，渲染成 HTML 就得当敌意输入处理。markdown-it
 * 的两条默认行为正好是要的：`html: false` 把原始标签转义掉，内置的链接校验
 * 把 `javascript:` 一类协议原样留成文本。**默认就安全**，所以这里不改配置，
 * 也就不需要再挂一层 sanitizer。
 */
const markdown = new MarkdownIt({ linkify: true });

/** 一段多行文本，渲染成块级 HTML。 */
export function renderMarkdown(text: string): HtmlEscapedString {
  return raw(markdown.render(text));
}
