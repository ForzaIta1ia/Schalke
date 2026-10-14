const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min.`;
  if (m < 1440) return `vor ${Math.round(m / 60)} Std.`;
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
};

let lastSeen = Number(localStorage.getItem("lastSeen") || 0);

async function load() {
  try {
    const r = await fetch("news.json?t=" + Date.now(), { cache: "no-store" });
    const data = await r.json();
    render(data);
    localStorage.setItem("cache", JSON.stringify(data));
  } catch {
    const c = localStorage.getItem("cache");
    if (c) render(JSON.parse(c), true);
    else $("list").innerHTML = '<div class="empty">Keine Verbindung.</div>';
  }
}

function render(data, offline) {
  $("upd").textContent = (offline ? "offline · " : "") + "Stand: " + ago(data.updated);
  if (!data.stories.length) { $("list").innerHTML = '<div class="empty">Noch keine News.</div>'; return; }
  $("list").innerHTML = data.stories.map((s) => {
    const isNew = Date.parse(s.date) > lastSeen;
    const first = s.articles[s.articles.length - 1];
    const multi = s.articles.length > 1;
    return `<article class="card ${isNew ? "new" : ""}">
      <h2><a href="${esc(first.link)}" target="_blank" rel="noopener">${esc(s.title)}</a></h2>
      <div class="meta">${isNew ? '<span class="badge">NEU</span>' : ""}${esc(s.sources.slice(0, 3).join(", "))}${s.sources.length > 3 ? " +" + (s.sources.length - 3) : ""} · ${ago(s.date)}</div>
      ${s.summary && s.summary.length > 40 ? `<p class="sum">${esc(s.summary)}</p>` : ""}
      ${multi ? `<details><summary>${s.articles.length} Quellen zu dieser Meldung</summary>
        ${s.articles.slice().reverse().map((a) => `<a href="${esc(a.link)}" target="_blank" rel="noopener"><b>${esc(a.source)}</b> – ${esc(a.title)}</a>`).join("")}
      </details>` : ""}
    </article>`;
  }).join("");
  lastSeen = Date.now();
  localStorage.setItem("lastSeen", lastSeen);
}

$("reload").onclick = load;
load();
setInterval(load, 15 * 60 * 1000); // App prüft alle 15 Min. auf neue Daten
document.addEventListener("visibilitychange", () => !document.hidden && load());
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
