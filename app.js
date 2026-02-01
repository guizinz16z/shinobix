const $ = (s) => document.querySelector(s);

function getParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function lsGet(key, fallback){
  try{ return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch(e){ return fallback; }
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

function cardHTML(a){
  return `
    <a class="card" href="anime.html?id=${encodeURIComponent(a.id)}">
      <img class="cover" src="${a.cover}" alt="${a.title}">
      <div class="cardBody">
        <div class="title">${a.title}</div>
        <div class="meta">
          <span class="pill">${a.year}</span>
          <span class="pill">${a.status}</span>
          <span class="pill">⭐ ${a.rating}</span>
        </div>
      </div>
    </a>
  `;
}

function renderHome(){
  const list = $("#list");
  if(!list) return;

  $("#year").textContent = new Date().getFullYear();

  const q = $("#q");
  const count = $("#count");
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const btnFavs = $("#btnFavs");
  const btnContinue = $("#btnContinue");

  let activeTab = "all";
  let term = "";

  function getItems(){
    const all = window.ANIMES.slice();

    // filtro por busca
    let items = all.filter(a => {
      if(!term) return true;
      const hay = (a.title + " " + a.genres.join(" ") + " " + a.status).toLowerCase();
      return hay.includes(term);
    });

    // tabs
    if(activeTab === "top"){
      items = items.sort((a,b) => (b.rating||0) - (a.rating||0)).slice(0, 10);
    }
    if(activeTab === "new"){
      items = items.sort((a,b) => (b.year||0) - (a.year||0));
    }
    if(activeTab === "fav"){
      const favs = lsGet("shinobix_favs", []);
      items = items.filter(a => favs.includes(a.id));
    }

    return items;
  }

  function draw(){
    const items = getItems();
    list.innerHTML = items.map(cardHTML).join("");
    count.textContent = `${items.length} anime(s)`;
  }

  tabs.forEach(t => t.addEventListener("click", () => {
    tabs.forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    activeTab = t.dataset.tab;
    draw();
  }));

  q.addEventListener("input", () => {
    term = q.value.trim().toLowerCase();
    draw();
  });

  btnFavs.addEventListener("click", () => {
    activeTab = "fav";
    tabs.forEach(x => x.classList.toggle("active", x.dataset.tab === "fav"));
    draw();
    location.hash = "#catalogo";
  });

  btnContinue.addEventListener("click", () => {
    const last = getLastWatch();
    if(!last){ alert("Você ainda não assistiu nada 🙂"); return; }
    location.href = `player.html?id=${encodeURIComponent(last.animeId)}&ep=${encodeURIComponent(last.ep)}`;
  });

  draw();
}

function renderAnime(){
  const title = $("#title");
  const cover = $("#cover");
  const meta = $("#meta");
  const desc = $("#desc");
  const eps = $("#eps");
  if(!title || !cover || !meta || !desc || !eps) return;

  const id = getParam("id");
  const a = window.ANIMES.find(x => x.id === id);

  if(!a){
    title.textContent = "Anime não encontrado";
    desc.textContent = "Volte para o catálogo e selecione um anime.";
    return;
  }

  document.title = `ShinobiX — ${a.title}`;
  cover.src = a.cover;
  title.textContent = a.title;
  desc.textContent = a.desc;

  meta.innerHTML = `
    <span class="pill">${a.year}</span>
    <span class="pill">${a.status}</span>
    <span class="pill">⭐ ${a.rating}</span>
    ${a.genres.map(g => `<span class="pill">${g}</span>`).join("")}
  `;

  $("#watch1").href = `player.html?id=${encodeURIComponent(a.id)}&ep=1`;

  const favBtn = $("#favBtn");
  function refreshFav(){
    favBtn.textContent = isFav(a.id) ? "✅ Favorito" : "⭐ Favoritar";
  }
  favBtn.addEventListener("click", () => {
    toggleFav(a.id);
    refreshFav();
  });
  refreshFav();

  $("#epCount").textContent = `${a.episodes.length} episódio(s)`;

  eps.innerHTML = a.episodes.map(ep => `
    <a class="card" href="player.html?id=${encodeURIComponent(a.id)}&ep=${ep.n}">
      <div class="cardBody">
        <div class="title">Episódio ${ep.n}</div>
        <div class="meta"><span class="pill">${ep.title}</span></div>
      </div>
    </a>
  `).join("");
}

function renderPlayer(){
  const frame = $("#frame");
  const ptitle = $("#ptitle");
  const back = $("#back");
  const prev = $("#prev");
  const next = $("#next");
  if(!frame || !ptitle || !back || !prev || !next) return;

  const id = getParam("id");
  let epN = Number(getParam("ep") || "1");

  const a = window.ANIMES.find(x => x.id === id);
  if(!a){ ptitle.textContent = "Anime não encontrado"; return; }

  back.href = `anime.html?id=${encodeURIComponent(id)}`;

  function load(epNumber){
    const ep = a.episodes.find(e => e.n === epNumber);
    if(!ep){
      ptitle.textContent = "Episódio não encontrado";
      frame.src = "";
      return;
    }
    epN = epNumber;
    document.title = `ShinobiX — ${a.title} Ep ${ep.n}`;
    ptitle.textContent = `${a.title} — Ep ${ep.n}: ${ep.title}`;
    frame.src = ep.src;

    setLastWatch(a.id, ep.n);

    prev.disabled = epN <= 1;
    next.disabled = epN >= a.episodes.length;
    prev.style.opacity = prev.disabled ? .55 : 1;
    next.style.opacity = next.disabled ? .55 : 1;
  }

  prev.addEventListener("click", () => load(epN - 1));
  next.addEventListener("click", () => load(epN + 1));

  load(epN);
}

renderHome();
renderAnime();
renderPlayer();
