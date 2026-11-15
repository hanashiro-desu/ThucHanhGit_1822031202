/* Dex Mini - web đọc truyện mini (vanilla JS, không thư viện)
   Dữ liệu: API công khai https://api.mangadex.org  */
(function () {
  'use strict';

  var API = 'https://api.mangadex.org';
  var COVERS = 'https://uploads.mangadex.org/covers';
  var PAGE = 24;
  var RATINGS = ['safe', 'suggestive'];

  var $ = function (id) { return document.getElementById(id); };
  var state = { tab: 'popular', query: '', offset: 0, total: 0, lang: 'vi', manga: null, chapters: [], chapterIdx: -1 };

  /* ---------- lưu trữ cục bộ (kệ truyện, chương đã đọc) ---------- */
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* bỏ qua */ } }
  var shelf = load('dexmini.shelf', {});      // { id: {id,title,cover} }
  var lastRead = load('dexmini.last', {});    // { mangaId: chapterId }

  /* ---------- tiện ích ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pick(obj) {            // chọn chuỗi theo ưu tiên vi > en > bất kỳ
    if (!obj) return '';
    return obj.vi || obj.en || obj['ja-ro'] || obj[Object.keys(obj)[0]] || '';
  }
  function cleanMd(s) {
    return String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#>]/g, '').replace(/---+/g, '').trim();
  }
  function query(params) {
    var u = new URLSearchParams();
    Object.keys(params).forEach(function (k) {
      [].concat(params[k]).forEach(function (v) { u.append(k, v); });
    });
    return u.toString();
  }
  function getJSON(path, params) {
    return fetch(API + path + '?' + query(params || {})).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function coverOf(m, size) {
    var rel = (m.relationships || []).filter(function (r) { return r.type === 'cover_art'; })[0];
    return rel && rel.attributes ? COVERS + '/' + m.id + '/' + rel.attributes.fileName + '.' + (size || 256) + '.jpg' : '';
  }
  function setStatus(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'dx-status' + (isError ? ' error' : '');
  }

  /* ---------- danh sách truyện ---------- */
  function cardHTML(m) {
    var title = pick(m.attributes.title);
    var cover = m.cover || coverOf(m);
    var st = { ongoing: 'Đang ra', completed: 'Hoàn thành', hiatus: 'Tạm ngưng', cancelled: 'Đã hủy' }[m.attributes && m.attributes.status] || '';
    return '<button class="dx-card" data-id="' + esc(m.id) + '">' +
      '<span class="dx-cover">' + (cover ? '<img loading="lazy" alt="" src="' + esc(cover) + '">' : '<i>' + esc(title.charAt(0)) + '</i>') + '</span>' +
      '<span class="dx-ct">' + esc(title) + '</span>' +
      (st ? '<span class="dx-cs">' + st + '</span>' : '') + '</button>';
  }

  function fetchList(append) {
    var p = {
      limit: PAGE, offset: state.offset, 'includes[]': 'cover_art',
      'contentRating[]': RATINGS, 'availableTranslatedLanguage[]': state.lang, hasAvailableChapters: 'true'
    };
    if (state.query) p.title = state.query;
    else if (state.tab === 'latest') p['order[latestUploadedChapter]'] = 'desc';
    else p['order[followedCount]'] = 'desc';

    setStatus('Đang tải...');
    $('moreBtn').hidden = true;
    return getJSON('/manga', p).then(function (res) {
      var html = res.data.map(cardHTML).join('');
      $('grid').innerHTML = append ? $('grid').innerHTML + html : html;
      state.total = res.total;
      state.offset += res.data.length;
      setStatus(res.data.length || append ? '' : 'Không tìm thấy truyện nào.');
      $('moreBtn').hidden = state.offset >= state.total;
    }).catch(function () {
      setStatus('Không tải được dữ liệu. Kiểm tra kết nối mạng rồi thử lại.', true);
    });
  }

  function renderShelf() {
    var items = Object.keys(shelf).map(function (k) { return shelf[k]; });
    $('grid').innerHTML = items.map(function (s) {
      return cardHTML({ id: s.id, cover: s.cover, attributes: { title: { vi: s.title } } });
    }).join('');
    setStatus(items.length ? '' : 'Kệ truyện đang trống. Mở một truyện và bấm "Lưu vào kệ".');
    $('moreBtn').hidden = true;
  }
  function updateShelfCount() { $('shelfCount').textContent = Object.keys(shelf).length; }

  function show(tab, q) {
    state.tab = tab; state.query = q || ''; state.offset = 0;
    [].forEach.call(document.querySelectorAll('.dx-tab'), function (b) { b.classList.toggle('active', b.dataset.tab === tab && !q); });
    $('heading').textContent = q ? 'Kết quả cho "' + q + '"' : { popular: 'Truyện phổ biến', latest: 'Mới cập nhật', shelf: 'Kệ truyện của bạn' }[tab];
    if (tab === 'shelf' && !q) renderShelf(); else { $('grid').innerHTML = ''; fetchList(false); }
  }

  /* ---------- chi tiết truyện ---------- */
  function openDetail(id) {
    $('detail').hidden = false;
    document.body.classList.add('lock');
    $('detailBody').innerHTML = '<p class="dx-status">Đang tải...</p>';
    getJSON('/manga/' + id, { 'includes[]': ['cover_art', 'author'] }).then(function (res) {
      var m = res.data; state.manga = m;
      var title = pick(m.attributes.title);
      var desc = cleanMd(pick(m.attributes.description));
      var tags = (m.attributes.tags || []).slice(0, 8).map(function (t) { return '<span class="dx-tag">' + esc(pick(t.attributes.name)) + '</span>'; }).join('');
      var authors = (m.relationships || []).filter(function (r) { return r.type === 'author' && r.attributes; }).map(function (r) { return r.attributes.name; }).join(', ');
      var cover = coverOf(m, 512);
      $('detailBody').innerHTML =
        '<div class="dx-dhead">' +
          '<div class="dx-dcover">' + (cover ? '<img alt="Bìa ' + esc(title) + '" src="' + esc(cover) + '">' : '') + '</div>' +
          '<div class="dx-dinfo"><h2>' + esc(title) + '</h2>' +
            (authors ? '<p class="dx-muted">' + esc(authors) + '</p>' : '') +
            '<div class="dx-tags">' + tags + '</div>' +
            '<div class="dx-dactions"><button class="dbtn" id="readFirst" disabled>Đọc từ đầu</button>' +
            '<button class="dbtn ghost" id="shelfBtn"></button></div></div></div>' +
        '<p class="dx-desc">' + esc(desc || 'Chưa có mô tả.') + '</p>' +
        '<h3>Danh sách chương</h3><div id="chapList" class="dx-chaps"><p class="dx-status">Đang tải chương...</p></div>';
      refreshShelfBtn();
      $('shelfBtn').onclick = function () { toggleShelf(m, title, coverOf(m)); };
      loadChapters(m.id);
    }).catch(function () {
      $('detailBody').innerHTML = '<p class="dx-status error">Không tải được truyện này.</p>';
    });
  }
  function refreshShelfBtn() {
    var b = $('shelfBtn'); if (!b || !state.manga) return;
    b.textContent = shelf[state.manga.id] ? 'Bỏ khỏi kệ' : 'Lưu vào kệ';
  }
  function toggleShelf(m, title, cover) {
    if (shelf[m.id]) delete shelf[m.id]; else shelf[m.id] = { id: m.id, title: title, cover: cover };
    save('dexmini.shelf', shelf); updateShelfCount(); refreshShelfBtn();
    if (state.tab === 'shelf' && !state.query) renderShelf();
  }

  function loadChapters(mangaId) {
    getJSON('/manga/' + mangaId + '/feed', {
      limit: 500, 'translatedLanguage[]': state.lang, 'order[volume]': 'asc', 'order[chapter]': 'asc',
      'contentRating[]': RATINGS, includeExternalUrl: '0'
    }).then(function (res) {
      var seen = {};
      state.chapters = res.data.filter(function (c) {          // mỗi số chương chỉ lấy 1 bản
        var k = c.attributes.chapter || c.id;
        if (seen[k] || c.attributes.pages === 0) return false;
        seen[k] = true; return true;
      });
      var box = $('chapList'); if (!box) return;
      if (!state.chapters.length) { box.innerHTML = '<p class="dx-status">Chưa có chương ở ngôn ngữ này. Thử đổi sang English ở góc trên.</p>'; return; }
      var last = lastRead[mangaId];
      box.innerHTML = state.chapters.map(function (c, i) {
        var name = 'Chương ' + (c.attributes.chapter || '?') + (c.attributes.title ? ' - ' + c.attributes.title : '');
        return '<button class="dx-chap' + (c.id === last ? ' read' : '') + '" data-i="' + i + '">' + esc(name) + '</button>';
      }).join('');
      var rf = $('readFirst'); rf.disabled = false;
      rf.onclick = function () { openReader(0); };
    }).catch(function () {
      var box = $('chapList'); if (box) box.innerHTML = '<p class="dx-status error">Không tải được danh sách chương.</p>';
    });
  }

  /* ---------- trình đọc ---------- */
  function openReader(i) {
    var c = state.chapters[i]; if (!c) return;
    state.chapterIdx = i;
    var title = pick(state.manga.attributes.title) + ' · Chương ' + (c.attributes.chapter || '?');
    $('rTitle').textContent = title;
    $('reader').hidden = false;
    document.body.classList.add('lock');
    $('pages').innerHTML = '<p class="dx-status">Đang tải trang...</p>';
    $('reader').scrollTop = 0;
    $('rPrev').disabled = i === 0;
    $('rNext').disabled = $('rNext2').disabled = i >= state.chapters.length - 1;
    lastRead[state.manga.id] = c.id; save('dexmini.last', lastRead);

    getJSON('/at-home/server/' + c.id).then(function (res) {
      var base = res.baseUrl + '/data-saver/' + res.chapter.hash + '/';
      $('pages').innerHTML = res.chapter.dataSaver.map(function (f, n) {
        return '<img loading="lazy" alt="Trang ' + (n + 1) + '" src="' + esc(base + f) + '">';
      }).join('');
    }).catch(function () {
      $('pages').innerHTML = '<p class="dx-status error">Không tải được trang truyện.</p>';
    });
  }
  function closeReader() {
    $('reader').hidden = true; $('pages').innerHTML = '';
    document.body.classList.toggle('lock', !$('detail').hidden);
    var b = document.querySelector('.dx-chap[data-i="' + state.chapterIdx + '"]');
    [].forEach.call(document.querySelectorAll('.dx-chap.read'), function (x) { x.classList.remove('read'); });
    if (b) b.classList.add('read');
  }
  function closeDetail() { $('detail').hidden = true; document.body.classList.remove('lock'); }

  /* ---------- sự kiện ---------- */
  $('grid').addEventListener('click', function (e) {
    var card = e.target.closest('.dx-card'); if (card) openDetail(card.dataset.id);
  });
  $('detailBody').addEventListener('click', function (e) {
    var ch = e.target.closest('.dx-chap'); if (ch) openReader(+ch.dataset.i);
  });
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-close]'); if (c) closeDetail();
  });
  $('tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.dx-tab'); if (t) { $('q').value = ''; show(t.dataset.tab); }
  });
  $('searchForm').addEventListener('submit', function (e) {
    e.preventDefault(); var q = $('q').value.trim(); show(q ? 'popular' : state.tab, q);
  });
  $('moreBtn').addEventListener('click', function () { fetchList(true); });
  $('lang').addEventListener('change', function () { state.lang = this.value; show(state.tab, state.query); });
  $('rClose').addEventListener('click', closeReader);
  $('rPrev').addEventListener('click', function () { openReader(state.chapterIdx - 1); });
  $('rNext').addEventListener('click', function () { openReader(state.chapterIdx + 1); });
  $('rNext2').addEventListener('click', function () { openReader(state.chapterIdx + 1); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (!$('reader').hidden) closeReader(); else if (!$('detail').hidden) closeDetail(); }
    if (!$('reader').hidden) {
      if (e.key === 'ArrowRight' && state.chapterIdx < state.chapters.length - 1) openReader(state.chapterIdx + 1);
      if (e.key === 'ArrowLeft' && state.chapterIdx > 0) openReader(state.chapterIdx - 1);
    }
  });

  updateShelfCount();
  show('popular');
})();
