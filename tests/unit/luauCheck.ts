/**
 * Lightweight Luau syntax checker for tests (no Luau runtime is available in CI).
 * Tokenizes Luau (strings, interpolated strings, long brackets, comments) and
 * verifies block structure (function/if/do/while/for/repeat ... end/until)
 * and bracket balance. It does not type-check.
 */
export interface Token {
  t: "name" | "kw" | "num" | "str" | "op";
  v: string;
  line: number;
}

const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in",
  "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while", "continue", "export", "type",
]);

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  const longBracket = (start: number): number | null => {
    // returns end index after closing bracket, if src[start] starts [=*[
    const m = /^\[(=*)\[/.exec(src.slice(start));
    if (!m) return null;
    const close = "]" + m[1] + "]";
    const end = src.indexOf(close, start + m[0].length);
    if (end < 0) throw new Error(`unterminated long bracket at line ${line}`);
    return end + close.length;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith("--", i)) {
      const lb = longBracket(i + 2);
      if (lb !== null) {
        line += (src.slice(i, lb).match(/\n/g) ?? []).length;
        i = lb;
      } else {
        while (i < src.length && src[i] !== "\n") i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        if (src[j] === "\n") throw new Error(`unterminated string at line ${line}`);
        j++;
      }
      if (j >= src.length) throw new Error(`unterminated string at line ${line}`);
      out.push({ t: "str", v: src.slice(i, j + 1), line });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      const lb = longBracket(i);
      if (lb !== null) {
        out.push({ t: "str", v: src.slice(i, lb), line });
        line += (src.slice(i, lb).match(/\n/g) ?? []).length;
        i = lb;
        continue;
      }
    }
    const num = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d*)?([eE][+-]?\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: num[0], line });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_]\w*/.exec(src.slice(i));
    if (name) {
      out.push({ t: KEYWORDS.has(name[0]) ? "kw" : "name", v: name[0], line });
      i += name[0].length;
      continue;
    }
    const op = /^(\.\.\.|\.\.=|\.\.|==|~=|<=|>=|\+=|-=|\*=|\/=|%=|\^=|::|->|\/\/|[-+*/%^#<>=(){}[\];:,.?&|])/.exec(src.slice(i));
    if (op) {
      out.push({ t: "op", v: op[0], line });
      i += op[0].length;
      continue;
    }
    throw new Error(`unexpected character ${JSON.stringify(c)} at line ${line}`);
  }
  return out;
}

const EXPR_PREV = new Set(["=", "(", ",", "{", "[", "return", "and", "or", "not", "..", "+", "-", "*", "/", "==", "~=", "<", ">", "<=", ">=", "then", "else", "in"]);

/** Throws with a descriptive message if the block structure is invalid. */
export function checkLuau(src: string): void {
  const toks = tokenize(src);
  const stack: { kind: string; line: number }[] = [];
  let pendingLoopDo = 0;
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    const prev = toks[k - 1];
    const v = tok.v;
    if (tok.t === "op") {
      if (v === "(" || v === "{" || v === "[") stack.push({ kind: v, line: tok.line });
      if (v === ")" || v === "}" || v === "]") {
        const want = v === ")" ? "(" : v === "}" ? "{" : "[";
        const top = stack.pop();
        if (!top || top.kind !== want) throw new Error(`unbalanced "${v}" at line ${tok.line} (open: ${top?.kind} from line ${top?.line})`);
      }
      continue;
    }
    if (tok.t !== "kw") continue;
    switch (v) {
      case "function":
        stack.push({ kind: "block", line: tok.line });
        break;
      case "if": {
        const isExpr = prev && ((prev.t === "op" && EXPR_PREV.has(prev.v)) || (prev.t === "kw" && EXPR_PREV.has(prev.v)));
        stack.push({ kind: isExpr ? "ifexpr" : "block", line: tok.line });
        break;
      }
      case "while":
      case "for":
        pendingLoopDo++;
        stack.push({ kind: "block", line: tok.line });
        break;
      case "do":
        if (pendingLoopDo > 0) pendingLoopDo--;
        else stack.push({ kind: "block", line: tok.line });
        break;
      case "repeat":
        stack.push({ kind: "repeat", line: tok.line });
        break;
      case "until": {
        const top = stack.pop();
        if (!top || top.kind !== "repeat") throw new Error(`"until" without "repeat" at line ${tok.line}`);
        break;
      }
      case "else": {
        // closes an if-expression's else-branch: the expression ends implicitly
        const top = stack[stack.length - 1];
        if (top?.kind === "ifexpr") stack.pop();
        break;
      }
      case "end": {
        const top = stack.pop();
        if (!top || top.kind !== "block") throw new Error(`unexpected "end" at line ${tok.line} (top: ${top?.kind} from line ${top?.line})`);
        break;
      }
    }
  }
  if (stack.length) throw new Error(`unclosed ${stack[stack.length - 1].kind} from line ${stack[stack.length - 1].line}`);
}

/** Tiny XML parser for tests: returns a tree of {tag, attrs, children, text}. */
export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export function parseXml(src: string): XmlNode {
  let i = 0;
  const root: XmlNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  while (i < src.length) {
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i);
      stack[stack.length - 1].text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith("</", i)) {
      const end = src.indexOf(">", i);
      const tag = src.slice(i + 2, end).trim();
      const top = stack.pop()!;
      if (top.tag !== tag) throw new Error(`mismatched </${tag}>, expected </${top.tag}>`);
      i = end + 1;
    } else if (src[i] === "<") {
      const end = src.indexOf(">", i);
      let body = src.slice(i + 1, end);
      const selfClose = body.endsWith("/");
      if (selfClose) body = body.slice(0, -1);
      const m = /^([\w:]+)(.*)$/s.exec(body.trim());
      if (!m) throw new Error(`bad tag at ${i}`);
      const attrs: Record<string, string> = {};
      for (const a of m[2].matchAll(/([\w:]+)="([^"]*)"/g)) attrs[a[1]] = unescape(a[2]);
      const node: XmlNode = { tag: m[1], attrs, children: [], text: "" };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
      i = end + 1;
    } else {
      const next = src.indexOf("<", i);
      const text = src.slice(i, next < 0 ? undefined : next);
      if (/<|>/.test(text)) throw new Error("raw angle bracket in text");
      stack[stack.length - 1].text += unescape(text);
      i = next < 0 ? src.length : next;
    }
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].tag}>`);
  return root;
}
