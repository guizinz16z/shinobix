const $ = (s) => document.querySelector(s);

function getParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function lsGet(key, fallback){
  try{ return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch{ return fallback; }
}
function lsSet(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function isFav(id){
  const favs = lsGet("shinobix_favs", []);
  return favs.includes(id);
}
function toggleFav(id){
  const favs = lsGet("shinobix_favs", []);
  const next = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id];
  lsSet("shinobix_favs", next);
  return next;
}

function setLastWatch(animeId, ep){
  lsSet("shinobix_last", { animeId, ep, t: Date.now() });
}
function getLastWatch(){
  return lsGet("shinobix_last", null);
}

// ===== AniList GraphQL =====
const ANILIST_URL = "https://graphql.anilist.co";

async function anilist(query, variables){
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json", "Accept":"application/json" },
    body: JSON.stringify({ query, variables })
  });
  if(!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`AniList erro: ${res.status} ${txt.slice(0,120)}`);
  }
  return res.json();
}

async function fetchCatalog({ page=1, perPage=40, search="", sort="POPULARITY_DESC" } = {}){
  const query = `
  query ($page: Int, $perPage: Int, $search: String, $sort: [MediaSort]) {
    Page(page: $page, perPage: $perPage) {
      media(search: $search, type: ANIME, sort: $sort, isAdult: false) {
        id
        title { romaji english native }
        coverImage { large medium }
        bannerImage
        description(asHtml: false)
        episodes
        seasonYear
        averageScore
        status
        genres
      }
    }
  }`;
  const data = await anilist(query, {
    page, perPage,
    search: search || null,
    sort: [sort]
  });
  return data.data.Page.media;
}

async function fetchAnimeById(id){
  const query = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title { romaji english native }
      coverImage { extraLarge large medium }
      bannerImage
      description(asHtml: false)
      episodes
      seasonYear
      averageScore
      status
      genres
      studios(isMain: true) { nodes { name } }
    }
  }`;
  const data = await anilist(query, { id: Number(id) });
  return data.data.Media;
}

function pickTitle(t){
  return t.english || t.romaji || t.native || "Sem título";
}

function cleanDesc(desc){
  if(!desc) return "Sem descrição.";
  return desc
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?i>/g, "")
    .replace(/<\/?b>/g, "")
    .replace(/<\/?em>/g, "")
    .replace(/<\/?strong>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildEpisodes(media){
  const total = Math.max(1, Number(media.episodes || 12));
  const list = [];
  for(let n=1; n<=total; n++){
    list.push({
      n,
      title: `Episódio ${n}`,
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ"
    });
  }
  return list;
}

function pill(text){ return `<span class="pill">${text}</span>`; }

function cardHTML(a){
  const title = a.titleText;
  const year = a.seasonYear || "—";
  const score = a.averageScore ? `⭐ ${Math.round(a.averageScore)/10}` : "⭐ —";
  const status = a.statusText || "—";
  const cover = a.cover;

  return `
    <a class="card" href="anime.html?id=${encodeURIComponent(a.id)}">
      <img class="cover" src="${cover}" alt="${title}">
      <div class="cardBody">
        <div class="title">${title}</div>
        <div class="meta">
          ${pill(year)}
          ${pill(status)}
          ${pill(score)}
        </div>
      </div>
    </a>
  `;
}

function showError(where, msg){
  if(!where) return;
  where.innerHTML = `
    <div class="panel">
      <div style="font-weight:1000; margin-bottom:6px;">Ops…</div>
      <div style="color:var(--muted); line-height:1.5;">${msg}</div>
      <div style="color:var(--muted); margin-top:8px; font-size:12px;">
        Se aparecer erro 429, é limite de requisições. Espere um pouco e recarregue.
      </div>
    </div>
  `;
}

// ===== HOME =====
async function renderHome(){
  const list = $("#list");
  if(!list) return;

  const yearEl = $("#year");
  if(yearEl) yearEl.textContent = new Date().getFullYear();

  const q = $("#q");
  const count = $("#count");
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const btnFavs = $("#btnFavs");
  const btnContinue = $("#btnContinue");

  let activeTab = "all";
  let term = "";

  function mapMedia(m){
    return {
      id: m.id,
      titleText: pickTitle(m.title),
      cover: m.coverImage?.large || m.coverImage?.medium || "",
      seasonYear: m.seasonYear,
      averageScore: m.averageScore,
      statusText: (m.status || "").replaceAll("_"," ").toLowerCase()
    };
  }

  async function load(){
    list.innerHTML = `<div class="panel" style="grid-column:1/-1">Carregando catálogo…</div>`;
    try{
      if(activeTab === "fav"){
        const favs = lsGet("shinobix_favs", []);
        if(!favs.length){
          list.innerHTML = `<div class="panel" style="grid-column:1/-1">Você ainda não favoritou nada ⭐</div>`;
          if(count) count.textContent = "0 anime(s)";
          return;
        }
        const media = await fetchCatalog({ search: term, sort: "POPULARITY_DESC" });
        const items = media.map(mapMedia).filter(a => favs.includes(a.id));
        list.innerHTML = items.map(cardHTML).join("");
        if(count) count.textContent = `${items.length} anime(s)`;
        return;
      }

      let sort = "POPULARITY_DESC";
      if(activeTab === "top") sort = "SCORE_DESC";
      if(activeTab === "new") sort = "START_DATE_DESC";

      const media = await fetchCatalog({ search: term, sort });
      const items = media.map(mapMedia);

      list.innerHTML = items.map(cardHTML).join("");
      if(count) count.textContent = `${items.length} anime(s)`;
    } catch(err){
      showError(list, (err?.message || "Erro ao carregar API."));
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
    clearTimeout(window.__sx);
    window.__sx = setTimeout(load, 450);
  });

  btnFavs?.addEventListener("click", () => {
    setTab("fav");
    location.hash = "#catalogo";
  });

  btnContinue?.addEventListener("click", () => {
    const last = getLastWatch();
    if(!last){ alert("Você ainda não assistiu nada 🙂"); return; }
    location.href = `player.html?id=${encodeURIComponent(last.animeId)}&ep=${encodeURIComponent(last.ep)}`;
  });

  load();
}

// ===== ANIME PAGE =====
async function renderAnime(){
  const titleEl = $("#title");
  const coverEl = $("#cover");
  const metaEl = $("#meta");
  const descEl = $("#desc");
  const epsEl = $("#eps");
  const epCount = $("#epCount");
  const watch1 = $("#watch1");
  const favBtn = $("#favBtn");

  if(!titleEl || !coverEl || !metaEl || !descEl || !epsEl) return;

  const id = getParam("id");
  if(!id){
    titleEl.textContent = "Anime não encontrado";
    descEl.textContent = "Volte para o catálogo.";
    return;
  }

  titleEl.textContent = "Carregando…";

  try{
    const m = await fetchAnimeById(id);
    const title = pickTitle(m.title);
    document.title = `ShinobiX — ${title}`;

    coverEl.src = m.bannerImage || m.coverImage?.extraLarge || m.coverImage?.large || "";
    titleEl.textContent = title;

    const year = m.seasonYear || "—";
    const score = m.averageScore ? `⭐ ${Math.round(m.averageScore)/10}` : "⭐ —";
    const status = (m.status || "").replaceAll("_"," ").toLowerCase() || "—";
    const studios = m.studios?.nodes?.map(s => s.name).slice(0,2).join(", ");

    metaEl.innerHTML = `
      ${pill(year)}
      ${pill(status)}
      ${pill(score)}
      ${studios ? pill(studios) : ""}
      ${(m.genres || []).slice(0,4).map(g => pill(g)).join("")}
    `;

    descEl.textContent = cleanDesc(m.description);

    const episodes = buildEpisodes(m);
    if(epCount) epCount.textContent = `${episodes.length} episódio(s)`;

    if(watch1) watch1.href = `player.html?id=${encodeURIComponent(m.id)}&ep=1`;

    function refreshFav(){
      if(!favBtn) return;
      favBtn.textContent = isFav(m.id) ? "✅ Favorito" : "⭐ Favoritar";
    }
    favBtn?.addEventListener("click", () => { toggleFav(m.id); refreshFav(); });
    refreshFav();

    epsEl.innerHTML = episodes.map(ep => `
      <a class="card" href="player.html?id=${encodeURIComponent(m.id)}&ep=${ep.n}">
        <div class="cardBody">
          <div class="title">Episódio ${ep.n}</div>
          <div class="meta">${pill(ep.title)}</div>
        </div>
      </a>
    `).join("");

  } catch(err){
    showError($(".twoCol") || epsEl, (err?.message || "Erro ao carregar anime."));
  }
}

// ===== PLAYER =====
async function renderPlayer(){
  const frame = $("#frame");
  const ptitle = $("#ptitle");
  const back = $("#back");
  const prev = $("#prev");
  const next = $("#next");
  if(!frame || !ptitle || !back || !prev || !next) return;

  const id = getParam("id");
  let epN = Number(getParam("ep") || "1");

  if(!id){
    ptitle.textContent = "Anime não encontrado";
    return;
  }

  ptitle.textContent = "Carregando…";

  try{
    const m = await fetchAnimeById(id);
    const title = pickTitle(m.title);
    const episodes = buildEpisodes(m);

    back.href = `anime.html?id=${encodeURIComponent(id)}`;

    function load(n){
      const ep = episodes.find(e => e.n === n);
      if(!ep){
        ptitle.textContent = "Episódio não encontrado";
        frame.src = "";
        return;
      }
      epN = n;
      document.title = `ShinobiX — ${title} Ep ${ep.n}`;
      ptitle.textContent = `${title} — Ep ${ep.n}`;
      frame.src = ep.src;

      setLastWatch(m.id, ep.n);

      prev.disabled = epN <= 1;
      next.disabled = epN >= episodes.length;
      prev.style.opacity = prev.disabled ? .55 : 1;
      next.style.opacity = next.disabled ? .55 : 1;
    }

    prev.addEventListener("click", () => load(epN - 1));
    next.addEventListener("click", () => load(epN + 1));

    load(epN);

  } catch(err){
    ptitle.textContent = err?.message || "Erro ao carregar player.";
  }
}

// Executa conforme a página
renderHome();
renderAnime();
renderPlayer();
