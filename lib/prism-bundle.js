// ─────────────────────────────────────────────────────────────────────────────
//  lib/prism-bundle.js  –  Custom Prism-compatible syntax highlighter
//
//  Exposes window.Prism with:
//    .highlight(code, grammar, language) → highlighted HTML string
//    .highlightElement(el)               → highlights a <code> element in-place
//
//  Token class names match Prism's standard naming so prism-vscode-dark.css
//  (and any other Prism theme) works without modification.
// ─────────────────────────────────────────────────────────────────────────────
(function (global) {
  'use strict';

  // ── HTML escape ───────────────────────────────────────────────────────────
  function escHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Tokeniser ─────────────────────────────────────────────────────────────
  // Each grammar is an ordered list of [tokenType, regex] pairs.
  // Regexes must be anchored with ^ so they only match at the head of `rem`.
  function tokenize(code, grammar) {
    const tokens = [];
    let rem = code;
    let plain = '';

    while (rem.length) {
      let matched = false;
      for (const [type, rx] of grammar) {
        const m = rx.exec(rem);
        if (m && m.index === 0) {
          if (plain) { tokens.push({ type: 'plain', text: plain }); plain = ''; }
          tokens.push({ type, text: m[0] });
          rem = rem.slice(m[0].length);
          matched = true;
          break;
        }
      }
      if (!matched) {
        plain += rem[0];
        rem = rem.slice(1);
      }
    }
    if (plain) tokens.push({ type: 'plain', text: plain });
    return tokens;
  }

  function render(tokens) {
    return tokens.map(t =>
      t.type === 'plain'
        ? escHtml(t.text)
        : `<span class="token ${t.type}">${escHtml(t.text)}</span>`
    ).join('');
  }

  // ── Language grammars ─────────────────────────────────────────────────────
  const G = {};

  // ── Python ────────────────────────────────────────────────────────────────
  G.python = [
    ['comment',    /^#[^\n]*/],
    ['string',     /^(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/],
    ['keyword',    /^\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/],
    ['builtin',    /^\b(?:abs|all|any|bin|bool|bytes|callable|chr|dict|dir|divmod|enumerate|eval|exec|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|isinstance|issubclass|iter|len|list|locals|map|max|min|next|object|oct|open|ord|pow|print|property|range|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|vars|zip)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?j?)\b/],
    ['decorator',  /^@[\w.]+/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['operator',   /^(?:->|:=|[+\-*/%&|^~<>=!]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];
  G.py = G.python;

  // ── JavaScript ───────────────────────────────────────────────────────────
  G.javascript = [
    ['comment',    /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:`[\s\S]*?`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/],
    ['regex',      /^\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/],
    ['keyword',    /^\b(?:abstract|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/],
    ['builtin',    /^\b(?:Array|Boolean|Date|Error|Function|JSON|Map|Math|Number|Object|Promise|Proxy|RegExp|Set|String|Symbol|WeakMap|WeakSet|console|document|globalThis|null|undefined|window)\b/],
    ['boolean',    /^\b(?:true|false)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?n?)\b/],
    ['function',   /^\b[a-zA-Z_$][\w$]*(?=\s*\()/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['operator',   /^(?:\.{3}|=>|[+\-*/%&|^~<>=!?:]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];
  G.js = G.javascript;

  // ── TypeScript ────────────────────────────────────────────────────────────
  G.typescript = [
    ['comment',    /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:`[\s\S]*?`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/],
    ['keyword',    /^\b(?:abstract|as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|keyof|let|namespace|new|of|override|package|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/],
    ['builtin',    /^\b(?:Array|Boolean|Date|Error|Function|JSON|Map|Math|Number|Object|Promise|Proxy|Record|RegExp|Set|String|Symbol|WeakMap|WeakSet|console|document|globalThis|null|undefined|window)\b/],
    ['boolean',    /^\b(?:true|false)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?n?)\b/],
    ['function',   /^\b[a-zA-Z_$][\w$]*(?=\s*[(<])/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['operator',   /^(?:\.{3}|=>|\?\.|\?\?|[+\-*/%&|^~<>=!?:]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];
  G.ts = G.typescript;

  // ── C ────────────────────────────────────────────────────────────────────
  G.c = [
    ['comment',    /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/],
    ['directive',  /^#\s*\w+[^\n]*/],
    ['keyword',    /^\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFlL]*)\b/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['operator',   /^(?:->|::|\+\+|--|[+\-*/%&|^~<>=!?:]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];

  // ── C++ ───────────────────────────────────────────────────────────────────
  G.cpp = [
    ['comment',    /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:R"[^(]*\([\s\S]*?\)[^)]*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/],
    ['directive',  /^#\s*\w+[^\n]*/],
    ['keyword',    /^\b(?:alignas|alignof|and|and_eq|asm|auto|bitand|bitor|bool|break|case|catch|char|char8_t|char16_t|char32_t|class|compl|concept|const|consteval|constexpr|constinit|const_cast|continue|co_await|co_return|co_yield|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|false|float|for|friend|goto|if|inline|int|long|mutable|namespace|new|noexcept|not|not_eq|nullptr|operator|or|or_eq|private|protected|public|register|reinterpret_cast|requires|return|short|signed|sizeof|static|static_assert|static_cast|struct|switch|template|this|thread_local|throw|true|try|typedef|typeid|typename|union|unsigned|using|virtual|void|volatile|wchar_t|while|xor|xor_eq)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFlL]*)\b/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['operator',   /^(?:->|::|<<|>>|\+\+|--|[+\-*/%&|^~<>=!?:]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];

  // ── Java ──────────────────────────────────────────────────────────────────
  G.java = [
    ['comment',    /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/],
    ['annotation', /^@[A-Za-z]\w*/],
    ['keyword',    /^\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|null|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while)\b/],
    ['boolean',    /^\b(?:true|false)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+[lL]?|\d+\.?\d*(?:[eE][+-]?\d+)?[fFdDlL]?)\b/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['operator',   /^(?:[+\-*/%&|^~<>=!?:]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];

  // ── Bash / Shell ──────────────────────────────────────────────────────────
  G.bash = [
    ['comment',    /^#[^\n]*/],
    ['string',     /^(?:"(?:\\.|[^"\\])*"|'[^']*')/],
    ['variable',   /^\$(?:\{[^}]*\}|[a-zA-Z_]\w*|\d+|[@#?$!*-])/],
    ['keyword',    /^\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|local|export|readonly|declare|unset|shift|break|continue|exit|trap|eval|exec|source)\b/],
    ['builtin',    /^\b(?:echo|printf|read|cd|ls|pwd|mkdir|rm|cp|mv|cat|grep|sed|awk|find|sort|uniq|wc|cut|head|tail|chmod|chown|curl|wget|git|npm|pip|python|node|python3)\b/],
    ['number',     /^\b\d+\b/],
    ['operator',   /^(?:&&|\|\||>>|<<|[|&;><])/],
    ['punctuation',/^[{}()[\]]/],
  ];
  G.sh    = G.bash;
  G.shell = G.bash;

  // ── JSON ──────────────────────────────────────────────────────────────────
  G.json = [
    ['string',     /^"(?:\\.|[^"\\])*"/],
    ['number',     /^-?\d+\.?\d*(?:[eE][+-]?\d+)?/],
    ['keyword',    /^\b(?:true|false|null)\b/],
    ['operator',   /^:/],
    ['punctuation',/^[{}()[\],]/],
  ];

  // ── SQL ───────────────────────────────────────────────────────────────────
  G.sql = [
    ['comment',    /^(?:--[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:'(?:''|[^'])*'|"(?:""|[^"])*")/],
    ['keyword',    /^\b(?:ADD|ALL|ALTER|AND|AS|ASC|BETWEEN|BY|CASE|COLUMN|CONSTRAINT|CREATE|CROSS|DATABASE|DEFAULT|DELETE|DESC|DISTINCT|DROP|ELSE|END|EXISTS|FOREIGN|FROM|FULL|GROUP|HAVING|IN|INDEX|INNER|INSERT|INTO|IS|JOIN|KEY|LEFT|LIKE|LIMIT|NOT|NULL|ON|OR|ORDER|OUTER|PRIMARY|REFERENCES|RIGHT|ROLLBACK|SELECT|SET|TABLE|THEN|TOP|TRANSACTION|UNION|UNIQUE|UPDATE|VALUES|VIEW|WHEN|WHERE|WITH)\b/i],
    ['number',     /^\b\d+\.?\d*\b/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['operator',   /^(?:[<>=!]+|[+\-*/%])/],
    ['punctuation',/^[(),;.]/],
  ];

  // ── Go ────────────────────────────────────────────────────────────────────
  G.go = [
    ['comment',    /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/],
    ['keyword',    /^\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\b/],
    ['builtin',    /^\b(?:append|cap|close|complex|copy|delete|imag|len|make|new|panic|print|println|real|recover)\b/],
    ['boolean',    /^\b(?:true|false|nil)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?i?)\b/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['operator',   /^(?::=|<-|>>|<<|[+\-*/%&|^~<>=!?:]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];
  G.golang = G.go;

  // ── Rust ──────────────────────────────────────────────────────────────────
  G.rust = [
    ['comment',    /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:r#*"[\s\S]*?"#*|b?"(?:\\.|[^"\\])*"|b?'(?:\\[^]|[^'])')/],
    ['attribute',  /^#!?\[[^\]]*\]/],
    ['keyword',    /^\b(?:abstract|as|async|await|become|box|break|const|continue|crate|do|dyn|else|enum|extern|false|final|fn|for|if|impl|in|let|loop|macro|match|mod|move|mut|override|priv|pub|ref|return|self|Self|static|struct|super|trait|true|try|type|typeof|union|unsafe|unsized|use|virtual|where|while|yield)\b/],
    ['builtin',    /^\b(?:bool|char|f32|f64|i8|i16|i32|i64|i128|isize|str|u8|u16|u32|u64|u128|usize|Box|Option|Result|String|Vec)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?[\d_]+)?(?:f32|f64|i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize)?)\b/],
    ['macro',      /^\b[a-z_]\w*!/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['lifetime',   /^'[a-zA-Z_]\w*/],
    ['operator',   /^(?:->|=>|::|\.\.=?|[+\-*/%&|^~<>=!?:]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];
  G.rs = G.rust;

  // ── Markdown ──────────────────────────────────────────────────────────────
  G.markdown = [
    ['title',      /^#{1,6} [^\n]*/],
    ['code-block', /^```[\s\S]*?```/],
    ['code',       /^`[^`\n]+`/],
    ['bold',       /^\*\*[\s\S]*?\*\*/],
    ['italic',     /^\*[^\s*][^\n]*?\*/],
    ['blockquote', /^>[^\n]*/],
    ['list',       /^[-*+] [^\n]*/],
    ['link',       /^\[([^\]]*)\]\([^)]*\)/],
    ['url',        /^https?:\/\/\S+/],
    ['hr',         /^[-*_]{3,}/],
  ];
  G.md = G.markdown;

  // ── YAML ──────────────────────────────────────────────────────────────────
  G.yaml = [
    ['comment',    /^#[^\n]*/],
    ['string',     /^(?:"(?:\\.|[^"\\])*"|'(?:[^']|'')*')/],
    ['boolean',    /^\b(?:true|false|yes|no|on|off|null|~)\b/i],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+|-?\d+\.?\d*(?:[eE][+-]?\d+)?)\b/],
    ['key',        /^[a-zA-Z_][\w-]*(?=\s*:)/],
    ['anchor',     /^[&*][a-zA-Z_]\w*/],
    ['tag',        /^!(?:![a-zA-Z]+)?/],
    ['operator',   /^[:|>]/],
    ['punctuation',/^[-,[\]{}]/],
  ];
  G.yml = G.yaml;

  // ── Ruby ──────────────────────────────────────────────────────────────────
  G.ruby = [
    ['comment',    /^(?:#[^\n]*|=begin[\s\S]*?=end)/],
    ['string',     /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|%[qQ]?\{[^}]*\})/],
    ['symbol',     /^:[a-zA-Z_]\w*/],
    ['keyword',    /^\b(?:BEGIN|END|alias|and|begin|break|case|class|def|defined\?|do|else|elsif|end|ensure|false|for|if|in|module|next|nil|not|or|raise|redo|rescue|retry|return|self|super|then|true|undef|unless|until|when|while|yield)\b/],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['operator',   /^(?:=>|::|[+\-*/%&|^~<>=!?:]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];
  G.rb = G.ruby;

  // ── PHP ───────────────────────────────────────────────────────────────────
  G.php = [
    ['comment',    /^(?:\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/],
    ['string',     /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/],
    ['variable',   /^\$[a-zA-Z_]\w*/],
    ['keyword',    /^\b(?:abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|die|do|echo|else|elseif|empty|enddeclare|endfor|endforeach|endif|endswitch|endwhile|eval|exit|extends|final|finally|fn|for|foreach|function|global|goto|if|implements|include|include_once|instanceof|insteadof|interface|isset|list|match|namespace|new|null|or|print|private|protected|public|readonly|require|require_once|return|static|switch|throw|trait|try|unset|use|var|while|xor|yield)\b/i],
    ['boolean',    /^\b(?:true|false|null)\b/i],
    ['number',     /^\b(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/],
    ['function',   /^\b[a-zA-Z_]\w*(?=\s*\()/],
    ['class-name', /^\b[A-Z][A-Za-z0-9_]*\b/],
    ['operator',   /^(?:=>|->|::|\?\?|[+\-*/%&|^~<>=!?:@]+)/],
    ['punctuation',/^[{}()[\],:;.]/],
  ];

  // ── Public API ────────────────────────────────────────────────────────────
  global.Prism = {
    /**
     * Highlight a string of code and return an HTML string.
     * @param {string} code     – source code to highlight
     * @param {*}      _grammar – ignored (kept for API compat)
     * @param {string} language – language key, e.g. 'python'
     * @returns {string} HTML with <span class="token TYPE"> wrappers
     */
    highlight(code, _grammar, language) {
      const g = G[language] || G[language && language.toLowerCase()];
      if (!g) return escHtml(code);
      return render(tokenize(code, g));
    },

    /**
     * Highlight a <code class="language-*"> element in place.
     * @param {HTMLElement} el
     */
    highlightElement(el) {
      const m = (el.className || '').match(/language-(\S+)/);
      const lang = m ? m[1] : null;
      if (!lang) return;
      el.innerHTML = this.highlight(el.textContent, null, lang);
    },
  };

})(typeof window !== 'undefined' ? window : global);
