/** @param {string | undefined | null} s */
export function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function mdToHtml(text) {
  const blocks = [];
  let html = String(text || "");
  html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const token = `@@CODE${blocks.length}@@`;
    blocks.push(`<pre class="code-block"><div class="code-head">${escapeHtml(lang || "code")}</div><code>${escapeHtml(code)}</code></pre>`);
    return token;
  });
  html = escapeHtml(html)
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  html = html
    .split(/\n\n+/)
    .map((block) => {
      if (/^(\- |\* )/m.test(block)) {
        const items = block
          .split("\n")
          .filter(Boolean)
          .map((line) => line.replace(/^(\- |\* )/, ""));
        return `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
      }
      return `<p>${block.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");
  blocks.forEach((block, i) => {
    html = html.replace(`@@CODE${i}@@`, block);
  });
  return html;
}

export function relTime(ts) {
  if (!ts) return "n/a";
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function htmlSig(text) {
  let sum = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) sum = (sum + s.charCodeAt(i)) % 1000000007;
  return `${s.length}:${sum}`;
}

export function newInteractionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `i-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
