// Holt Schalke-News aus mehreren Quellen, filtert, entfernt Duplikate und gruppiert ähnliche Meldungen.
// Benötigt Node 18+ (kein npm install nötig).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const OUT = new URL("../docs/news.json", import.meta.url);
const KEEP_DAYS = 7;
const g = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=de&gl=DE&ceid=DE:de`;

// Google News bündelt Kicker, Sky, WAZ, Bild, Reviersport, transfermarkt usw.
const FEEDS = [
  { name: "Google News", url: g("FC Schalke 04 when:2d") },
  { name: "Google News", url: g("Schalke 04 kicker when:2d") },
  { name: "Google News", url: g("Schalke 04 sky sport when:2d") },
  { name: "Google News", url: g("S04 Königsblau when:2d") },
  { name: "Google News", url: g("Schalke Transfer when:2d") },
  { name: "Google News", url: g("Schalke Trainer Spiel when:2d") },
  { name: "Bing News", url: "https://www.bing.com/news/search?q=FC+Schalke+04&format=rss&setlang=de" },
  { name: "Schalke04.de", url: "https://schalke04.de/feed/" },
  { name: "Reviersport", url: "https://www.reviersport.de/feed/schalke" },
  { name: "WAZ", url: "https://www.waz.de/sport/fussball/schalke/rss.xml" },
];

const RELEVANT = /schalke|\bs04\b|königsblau|knappen|veltins|gelsenkirchen/i;

const unesc = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ").trim();

const tag = (block, t) => {
  const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"));
  return m ? m[1] : "";
};

function parseFeed(xml, feedName) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let title = unesc(tag(b, "title"));
    let link = unesc(tag(b, "link")) || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "";
    const date = new Date(unesc(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date")));
    let source = unesc(tag(b, "source"));
    // Google News: "Titel - Quelle"
    const m = title.match(/^(.*\S)\s+[-–|]\s+([^-–|]{2,40})$/);
    if (m && (!source || feedName.includes("Google") || feedName.includes("Bing"))) {
      title = m[1];
      source = source || m[2];
    }
    const summary = unesc(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded")).slice(0, 280);
    if (!title || !link || isNaN(date)) continue;
    items.push({
      title, link, source: source || feedName, summary,
      date: date.toISOString(),
    });
  }
  return items;
}

const STOP = new Set("der die das und oder mit von für auf aus bei den dem des ein eine einen im in ist sind wird nach zum zur vor über um an am als auch noch nicht kein sich so wie wenn dann nur mehr beim hat haben wurde sein ihr ihre seine fc schalke s04 04 news live ticker".split(" "));
const norm = (s) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ");
const tokens = (t) =>
  new Set(norm(t).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const sim = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const jac = inter / (a.size + b.size - inter);
  const overlap = inter / Math.min(a.size, b.size);
  return Math.max(jac, Math.min(a.size, b.size) >= 4 ? overlap * 0.85 : 0);
};
const urlKey = (u) => {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, "") +
      (x.hostname.includes("google") ? x.search : "");
  } catch { return u; }
};

async function load(feed) {
  try {
    const r = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Schalke-News-App)", Accept: "application/rss+xml, text/xml, */*" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const items = parseFeed(await r.text(), feed.name);
    console.log(`✓ ${feed.url.slice(0, 70)}  → ${items.length}`);
    return items;
  } catch (e) {
    console.log(`✗ ${feed.url.slice(0, 70)}  (${e.message})`);
    return [];
  }
}

async function main() {
  let old = [];
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    // Vorherige Gruppen wieder in Einzelartikel zerlegen, damit neu gruppiert wird
    for (const s of prev.stories || []) for (const a of s.articles) old.push(a);
  } catch {}

  const fresh = (await Promise.all(FEEDS.map(load))).flat();
  const cutoff = Date.now() - KEEP_DAYS * 864e5;

  // 1) Exakte Duplikate (URL oder identischer Titel+Quelle) entfernen
  const seen = new Map();
  for (const a of [...fresh, ...old]) {
    if (!RELEVANT.test(a.title + " " + a.summary) && !/schalke/i.test(a.link)) continue;
    if (Date.parse(a.date) < cutoff) continue;
    const k1 = urlKey(a.link);
    const k2 = norm(a.title).trim() + "|" + a.source.toLowerCase();
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.set(k1, a); seen.set(k2, a);
  }
  const articles = [...new Set(seen.values())].sort((a, b) => b.date.localeCompare(a.date));

  // 2) Inhaltlich ähnliche Artikel zu "Stories" gruppieren
  const stories = [];
  for (const a of articles) {
    const tk = tokens(a.title);
    let best = null, bestSim = 0;
    for (const s of stories) {
      const v = Math.max(...s.articles.map((x) => sim(tk, x._tk)));
      if (v > bestSim) { bestSim = v; best = s; }
    }
    a._tk = tk;
    if (best && bestSim >= 0.5) best.articles.push(a);
    else stories.push({ articles: [a] });
  }
  for (const s of stories) {
    s.articles.sort((a, b) => a.date.localeCompare(b.date));
    const first = s.articles[0];
    s.id = urlKey(first.link).slice(0, 80);
    s.title = s.articles.reduce((t, x) => (x.title.length > t.length && x.title.length < 140 ? x.title : t), first.title);
    s.summary = s.articles.find((x) => x.summary)?.summary || "";
    s.date = s.articles[s.articles.length - 1].date; // neueste Meldung
    s.sources = [...new Set(s.articles.map((x) => x.source))];
    s.articles.forEach((x) => delete x._tk);
  }
  stories.sort((a, b) => b.date.localeCompare(a.date));

  await mkdir(dirname(OUT.pathname.replace(/^\/([A-Za-z]:)/, "$1")), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), stories }, null, 1));
  console.log(`\n${articles.length} Artikel → ${stories.length} Stories`);
}
main();
