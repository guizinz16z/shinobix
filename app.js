const $ = (s) => document.querySelector(s);

function getParam(name){
  return new URL(location.href).searchParams.get(name);
}

function lsGet(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function lsSet(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/** =========================
 *  CONFIG
 *  ========================= */

// Idiomas dos capítulos
const LANGS = ["pt-br", "en"];

// Qualidade das páginas
const QUALITY_DEFAULT = "data-saver";

// Limites (reduz rate-limit)
const LIST_LIMIT = 20;
const FEED_LIMIT = 100;

// ✅ Lista de proxies (se um falhar, tenta o outro)
const PROXIES = [
  // AllOrigins (precisa encode)
  (url) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),

  // Corsproxy (precisa encode, e usa ?<url>)
  (url) => "https://corsproxy.io/?" + encodeURIComponent(url),
];

/** =========================
 *  HELPERS
 *  ========================= */
function pill(text){ return `<span class="pill">${text}</span>`; }

function showError(where, msg){
  if(!where) return;
  where.innerHTML = `
    <div class="panel">
      <div style="font-weight:1000; margin-bottom:6px;">Ops…</div>
      <div style="color:var(--muted); line-height:1.5;">${msg}</div>
      <div style="color:var(--muted); margin-top:8px; font-size:12px;">
        Se aparecer erro 429, é limite de requisição. Espere um pouco e tente de novo.
      </div>
    </div>
  `;
}

function pickTitle(titles){
  if(!titles) return "Sem título";
  return titles["pt-br"] || titles["en"] || titles["ja-ro"] || Object.values(titles)[0] || "Sem título";
}

function cleanDesc(desc){
  if(!desc) return "Sem descrição.";
  return String(desc).replace(/\n{3,}/g, "\n\n").trim();
}

function getRel(relationships, type){
  return (relationships || []).find(r => r.type === type);
}

function mdCoverUrl(mangaId, coverRel){
  const fileName = coverRel?.attributes?.fileName;
  if(!fileName) return "";
  return `https://uploads.mangadex.org/covers/${mangaId}/${fileName}.256.jpg`;
}

/** =========================
 *  MangaDex API (com fallback de proxy)
 *  ========================= */
async function fetchJsonWithFallback(targetUrl, attempt = 0){
  let lastErr = null;

  for(const makeProxy of PROXIES){
    const url = makeProxy(targetUrl);

    try{
      const res = await fetch(url, { headers: { "Accept": "application/json" } });

      // retry em 429/5xx
      if(!res.ok){
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }

      // ⚠️ Parse seguro (evita "Unexpected end of JSON input")
      const txt = await res.text();

      // resposta vazia/cortada -> tenta outro proxy
      if(!txt || txt.trim().length < 2){
        lastErr = new Error("Resposta vazia do proxy");
        continue;
      }

      // se não parece JSON, provavelmente veio HTML/erro do proxy
      const t = txt.trim();
      const looksJson = t.startsWith("{") || t.startsWith("[");
      if(!looksJson){
        lastErr = new Error("Proxy retornou algo que não é JSON");
        continue;
      }

      return JSON.parse(t);

    } catch(err){
      lastErr = err;
      continue;
    }
  }

  // Retry global (2 tentativas)
  if(attempt < 2){
    await sleep(900 + attempt * 700);
    return fetchJsonWithFallback(targetUrl, attempt + 1);
  }

  throw lastErr || new Error("Falha ao buscar dados (proxy).");
}

async function mdGET(path, params = {}){
  const target = new URL("https://api.mangadex.org" + path);

  Object.entries(params).forEach(([k,v]) => {
    if(Array.isArray(v)){
      v.forEach(item => target.searchParams.append(k, item));
    } else if(v !== null && v !== undefined && v !== ""){
      target.searchParams.set(k, v);
    }
  });

  return fetchJsonWithFallback(target.toString());
}

async function searchManga(title){
  return mdGET("/manga", {
    title,
    limit: LIST_LIMIT,
    "includes[]": ["cover_art"],
    "order[followedCount]": "desc"
  });
}

async function getPopularManga(){
  return mdGET("/manga", {
    limit: LIST_LIMIT,
    "includes[]": ["cover_art"],
    "order[followedCount]": "desc"
  });
}

async function getMangaFeed(mangaId){
  return mdGET(`/manga/${mangaId}/feed`, {
    limit: FEED_LIMIT,
    "translatedLanguage[]": LANGS,
    "order[chapter]": "desc",
    "order[volume]": "desc"
  });
}

async function getAtHome(chapterId){
  return mdGET(`/at-home/server/${chapterId}`);
}

async function getChapter(chapterId){
  return mdGET(`/chapter/${chapterId}`);
}

/** =========================
 *  Favorites + History
 *  ========================= */
function isFav(id){
  const favs = lsGet("shinobix_manga_favs", []);
  return favs.includes(id);
}
function toggleFav(id){
  const favs = lsGet("shinobix_manga_favs", []);
  const next = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id];
  lsSet("shinobix_manga_favs", next);
  return next;
}

function setLastRead(obj){
  lsSet("shinobix_last_read", { ...obj, t: Date.now() });

  const hist = lsGet("shinobix_history", []);
  const cleaned = hist.filter(x => x.chapterId !== obj.chapterId);
  cleaned.unshift({ ...obj, t: Date.now() });
  lsSet("shinobix_history", cleaned.slice(0, 30));
}

function getLastRead(){
  return lsGet("shinobix_last_read", null);
}

/** =========================
 *  Render: Home
 *  ========================= */
async function renderHome(){
  const list = $("#list");
  if(!list) return;

  const yearEl = $("#year");
  if(yearEl) yearEl.textContent = new Date().getFullYear();

  const q = $("#q");
  const count = $("#count");
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const btnHistory = $("#btnHistory");
  const btnContinue = $("#btnContinue");

  let activeTab = "popular";
  let term = "";

  function mapManga(m){
    const id = m.id;
    const title = pickTitle(m.attributes?.title);
    const status = (m.attributes?.status || "—").toLowerCase();
    const year = m.attributes?.year || "—";
    const coverRel = getRel(m.relationships, "cover_art");
    const cover = mdCoverUrl(id, coverRel) || "";
    return { id, title, status, year, cover };
  }

  function cardHTML(a){
    return `
      <a class="card" href="manga.html?id=${encodeURIComponent(a.id)}">
        <img class="cover" src="${a.cover}" alt="${a.title}">
        <div class="cardBody">
          <div class="title">${a.title}</div>
          <div class="meta">
            ${pill(a.year)}
            ${pill(a.status)}
          </div>
        </div>
      </a>
    `;
  }

  async function load(){
    list.innerHTML = `<div class="panel" style="grid-column:1/-1">Carregando…</div>`;
    try{
      if(activeTab === "history"){
        const hist = lsGet("shinobix_history", []);
        if(!hist.length){
          list.innerHTML = `<div class="panel" style="grid-column:1/-1">Sem histórico ainda 📖</div>`;
          if(count) count.textContent = "0 item(s)";
          return;
        }

        list.innerHTML = hist.map(h => `
          <a class="card" href="reader.html?mangaId=${encodeURIComponent(h.mangaId)}&chapterId=${encodeURIComponent(h.chapterId)}">
            <div class="cardBody">
              <div class="title">${h.title}</div>
              <div class="meta">
                ${pill(h.chapterLabel || "Capítulo")}
                ${pill(new Date(h.t).toLocaleString())}
              </div>
            </div>
          </a>
        `).join("");
        if(count) count.textContent = `${hist.length} item(s)`;
        return;
      }

      let data;
      if(activeTab === "search"){
        if(!term){
          list.innerHTML = `<div class="panel" style="grid-column:1/-1">Digite algo na busca 🔎</div>`;
          if(count) count.textContent = "0 item(s)";
          return;
        }
        data = await searchManga(term);
      } else {
        data = await getPopularManga();
      }

      const items = (data.data || []).map(mapManga);
      list.innerHTML = items.map(cardHTML).join("");
      if(count) count.textContent = `${items.length} mangá(s)`;

    } catch(err){
      showError(list, (err?.message || "Erro ao carregar."));
    }
  }

  function setTab(tab){
    activeTab = tab;
    tabs.forEach(x => x.classList.toggle("active", x.dataset.tab === tab));
    load();
  }

  tabs.forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));

  q?.addEventListener("input", () => {
    term = q.value.trim();
    clearTimeout(window.__mdsx);
    window.__mdsx = setTimeout(() => setTab("search"), 450);
  });

  btnHistory?.addEventListener("click", () => setTab("history"));

  btnContinue?.addEventListener("click", () => {
    const last = getLastRead();
    if(!last){ alert("Você ainda não leu nada 🙂"); return; }
    location.href = `reader.html?mangaId=${encodeURIComponent(last.mangaId)}&chapterId=${encodeURIComponent(last.chapterId)}`;
  });

  load();
}

/** =========================
 *  Render: Manga details + chapters
 *  ========================= */
async function renderManga(){
  const titleEl = $("#title");
  const coverEl = $("#cover");
  const metaEl = $("#meta");
  const descEl = $("#desc");
  const chaptersEl = $("#chapters");
  const chCountEl = $("#chCount");
  const readLatestBtn = $("#readLatest");
  const favBtn = $("#favBtn");
  if(!titleEl || !coverEl || !metaEl || !descEl || !chaptersEl) return;

  const id = getParam("id");
  if(!id){
    titleEl.textContent = "Mangá não encontrado";
    return;
  }

  titleEl.textContent = "Carregando…";

  try{
    const md = await mdGET(`/manga/${id}`, { "includes[]": ["cover_art"] });
    const m = md.data;

    const title = pickTitle(m.attributes?.title);
    document.title = `ShinobiX — ${title}`;

    const coverRel = getRel(m.relationships, "cover_art");
    coverEl.src = mdCoverUrl(id, coverRel) || "";
    titleEl.textContent = title;

    const year = m.attributes?.year || "—";
    const status = (m.attributes?.status || "—").toLowerCase();
    const tags = (m.attributes?.tags || []).slice(0,4).map(t => t.attributes?.name?.en).filter(Boolean);

    metaEl.innerHTML = `${pill(year)}${pill(status)}${tags.map(pill).join("")}`;
    descEl.textContent = cleanDesc(m.attributes?.description?.["pt-br"] || m.attributes?.description?.["en"]);

    const refreshFav = () => { favBtn.textContent = isFav(id) ? "✅ Favorito" : "⭐ Favoritar"; };
    favBtn.addEventListener("click", () => { toggleFav(id); refreshFav(); });
    refreshFav();

    const feed = await getMangaFeed(id);
    const chapters = (feed.data || [])
      .filter(ch => ch.attributes?.pages > 0)
      .map(ch => ({
        id: ch.id,
        chapter: ch.attributes?.chapter || "—",
        volume: ch.attributes?.volume || "—",
        title: ch.attributes?.title || "",
        lang: ch.attributes?.translatedLanguage || "",
        pages: ch.attributes?.pages || 0
      }));

    if(chCountEl) chCountEl.textContent = `${chapters.length} capítulo(s)`;

    const latest = chapters[0];
    readLatestBtn.addEventListener("click", () => {
      if(!latest){ alert("Sem capítulos disponíveis."); return; }
      location.href = `reader.html?mangaId=${encodeURIComponent(id)}&chapterId=${encodeURIComponent(latest.id)}`;
    });

    chaptersEl.innerHTML = chapters.slice(0, 120).map(c => `
      <a class="card" href="reader.html?mangaId=${encodeURIComponent(id)}&chapterId=${encodeURIComponent(c.id)}">
        <div class="cardBody">
          <div class="title">Vol ${c.volume} • Cap ${c.chapter}</div>
          <div class="meta">
            ${pill(c.lang)}
            ${pill(`${c.pages} pág`)}
            ${c.title ? pill(c.title) : ""}
          </div>
        </div>
      </a>
    `).join("");

  } catch(err){
    showError($(".twoCol") || chaptersEl, (err?.message || "Erro ao carregar mangá."));
  }
}

/** =========================
 *  Render: Reader
 *  ========================= */
async function renderReader(){
  const rt = $("#rt");
  const pagesEl = $("#pages");
  const backToManga = $("#backToManga");
  const prevBtn = $("#prev");
  const nextBtn = $("#next");
  const toggleMode = $("#toggleMode");
  if(!rt || !pagesEl || !backToManga || !prevBtn || !nextBtn || !toggleMode) return;

  const mangaId = getParam("mangaId");
  let chapterId = getParam("chapterId");
  if(!mangaId || !chapterId){
    rt.textContent = "Leitor: parâmetros faltando.";
    return;
  }

  backToManga.href = `manga.html?id=${encodeURIComponent(mangaId)}`;

  let quality = lsGet("shinobix_quality", QUALITY_DEFAULT);
  toggleMode.textContent = quality === "data-saver" ? "🪶 Data-saver" : "✨ Qualidade";

  toggleMode.addEventListener("click", () => {
    quality = (quality === "data-saver") ? "data" : "data-saver";
    lsSet("shinobix_quality", quality);
    toggleMode.textContent = quality === "data-saver" ? "🪶 Data-saver" : "✨ Qualidade";
    loadChapter(chapterId);
  });

  let chapterList = [];
  let currentIndex = -1;

  async function loadChapterList(){
    const feed = await getMangaFeed(mangaId);
    chapterList = (feed.data || [])
      .filter(ch => ch.attributes?.pages > 0)
      .map(ch => ({
        id: ch.id,
        chapter: ch.attributes?.chapter || "—",
        volume: ch.attributes?.volume || "—",
        title: ch.attributes?.title || ""
      }));
  }

  function updateNav(){
    currentIndex = chapterList.findIndex(c => c.id === chapterId);
    const prev = chapterList[currentIndex + 1]; // mais antigo
    const next = chapterList[currentIndex - 1]; // mais novo

    prevBtn.disabled = !prev;
    nextBtn.disabled = !next;
    prevBtn.style.opacity = prevBtn.disabled ? .55 : 1;
    nextBtn.style.opacity = nextBtn.disabled ? .55 : 1;

    prevBtn.onclick = () => { if(prev) go(prev.id); };
    nextBtn.onclick = () => { if(next) go(next.id); };
  }

  function go(newChapterId){
    chapterId = newChapterId;
    history.replaceState(null, "", `reader.html?mangaId=${encodeURIComponent(mangaId)}&chapterId=${encodeURIComponent(chapterId)}`);
    loadChapter(chapterId);
  }

  async function loadChapter(chId){
    rt.textContent = "Carregando capítulo…";
    pagesEl.innerHTML = "";

    try{
      const chapterRes = await getChapter(chId);
      const ch = chapterRes.data;

      const chLabel = `Vol ${ch.attributes?.volume || "—"} • Cap ${ch.attributes?.chapter || "—"}`;
      const chTitle = ch.attributes?.title ? ` — ${ch.attributes.title}` : "";
      rt.textContent = `${chLabel}${chTitle}`;

      const atHome = await getAtHome(chId);
      const baseUrl = atHome.baseUrl;
      const hash = atHome.chapter?.hash;
      const files = (quality === "data-saver") ? (atHome.chapter?.dataSaver || []) : (atHome.chapter?.data || []);
      const mode = quality;

      const urls = files.map(fn => `${baseUrl}/${mode}/${hash}/${fn}`);

      setLastRead({
        mangaId,
        chapterId: chId,
        title: lsGet("shinobix_tmp_manga_title", "Mangá"),
        chapterLabel: chLabel
      });

      pagesEl.innerHTML = urls.map(u => `<img class="pageImg" loading="lazy" src="${u}" alt="page">`).join("");

      window.scrollTo({ top: 0, behavior: "instant" });
      updateNav();

    } catch(err){
      showError(pagesEl, (err?.message || "Erro ao carregar capítulo."));
    }
  }

  try{
    const md = await mdGET(`/manga/${mangaId}`);
    const title = pickTitle(md.data?.attributes?.title);
    lsSet("shinobix_tmp_manga_title", title);

    await loadChapterList();
    updateNav();
    await loadChapter(chapterId);

  } catch(err){
    rt.textContent = (err?.message || "Erro no leitor.");
  }
}

/** =========================
 *  Boot
 *  ========================= */
renderHome();
renderManga();
renderReader();
