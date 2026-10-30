// Bootstrap: asset loading, the frame loop and browser input.
'use strict';
(function () {
  var LIB = window.LIB;
  var canvas = document.getElementById('stage');
  var overlay = document.getElementById('overlay'), bar = document.getElementById('bar'), status = document.getElementById('status'), startBtn = document.getElementById('start');
  $.pageUrl = 'http://localhost/sinjid_shadow_of_the_warrior.swf';
  $.setupView(canvas);

  function fit() {
    var W = window.innerWidth, H = window.innerHeight;
    var w = Math.min(W, H * LIB.w / LIB.h);
    canvas.style.width = Math.floor(w) + 'px';
    canvas.style.height = Math.floor(w * LIB.h / LIB.w) + 'px';
    $.resizeView(w);
    if ($.root) $.render();
  }
  window.addEventListener('resize', fit);
  fit();

  // ------------------------------------------------------------ input
  function toStage(e) {
    var r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * LIB.w / r.width, (e.clientY - r.top) * LIB.h / r.height];
  }
  $.cursor = function (c) { canvas.style.cursor = $.mouseHiddenFlag ? 'none' : c; };
  $.onMouseVisibility = function (v) { $.mouseHiddenFlag = !v; canvas.style.cursor = v ? '' : 'none'; };
  canvas.addEventListener('pointermove', function (e) { var p = toStage(e); $.mouseMove(p[0], p[1]); });
  canvas.addEventListener('pointerdown', function (e) {
    $.audio.unlock();
    if (e.button !== 0) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    var p = toStage(e); $.mouseMove(p[0], p[1]); $.mouseDown();
    e.preventDefault();
  });
  canvas.addEventListener('pointerup', function (e) { if (e.button !== 0) return; var p = toStage(e); $.mouseMove(p[0], p[1]); $.mouseUp(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // DOM key -> Flash key code (Key.getCode) and button keyPress code
  var CODES = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, NumpadEnter: 13, Space: 32, Backspace: 8, Tab: 9, Escape: 27,
    ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18, Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34, CapsLock: 20 };
  var BUTTON_KEYS = { ArrowLeft: 1, ArrowRight: 2, Home: 3, End: 4, Insert: 5, Delete: 6, Backspace: 8, Enter: 13, ArrowUp: 14, ArrowDown: 15, PageUp: 16, PageDown: 17, Tab: 18, Escape: 19 };
  function flashCode(e) {
    if (CODES[e.code]) return CODES[e.code];
    if (/^Key[A-Z]$/.test(e.code)) return e.code.charCodeAt(3);
    if (/^Digit[0-9]$/.test(e.code)) return e.code.charCodeAt(5);
    if (/^Numpad[0-9]$/.test(e.code)) return 96 + (+e.code.slice(6));
    if (/^F[0-9]+$/.test(e.code)) return 111 + (+e.code.slice(1));
    return e.keyCode || 0;
  }
  var GAME_KEYS = { 32: 1, 37: 1, 38: 1, 39: 1, 40: 1, 9: 1, 8: 1 };
  window.addEventListener('keydown', function (e) {
    $.audio.unlock();
    var code = flashCode(e);
    var ascii = e.key && e.key.length === 1 ? e.key.charCodeAt(0) : (code === 13 ? 13 : code === 8 ? 8 : 0);
    if (GAME_KEYS[code] || ($.focus && e.key && e.key.length === 1)) e.preventDefault();
    if ($.focus && $.focus.keyInput) $.focus.keyInput(e);
    $.setKey(code, ascii, true);
    var bk = BUTTON_KEYS[e.key] || (e.key && e.key.length === 1 ? e.key.charCodeAt(0) : 0);
    $.keyEvent(true, code, bk >= 32 && bk <= 126 || BUTTON_KEYS[e.key] ? bk : 0);
  });
  window.addEventListener('keyup', function (e) { var code = flashCode(e); $.setKey(code, 0, false); $.keyEvent(false, code, 0); });
  window.addEventListener('blur', function () { $.clearKeys(); });

  // ------------------------------------------------------------ loading
  function loadImages(done) {
    var ids = Object.keys(LIB.bitmaps).filter(function (id) { return LIB.bitmaps[id]; });
    var n = 0;
    if (!ids.length) return done();
    ids.forEach(function (id) {
      var im = new Image();
      im.onload = im.onerror = function () { if (++n === ids.length) done(); };
      im.src = LIB.bitmaps[id].file;
      $.images[id] = im;
    });
  }

  // ------------------------------------------------------------ frame loop
  var FRAME = 1000 / LIB.fps, last = 0, acc = 0, paused = false;
  $.stepFrames = function (n) { for (var i = 0; i < n; i++) $.tick(); $.render(); };
  function loop(ts) {
    requestAnimationFrame(loop);
    if (paused) { last = ts; return; }
    if (!last) last = ts;
    acc += Math.min(ts - last, 250); last = ts;
    var steps = 0;
    while (acc >= FRAME && steps < 3) { acc -= FRAME; steps++; $.tick(); }
    if (acc > FRAME * 3) acc = 0;
    if (steps || ($.focus && $.focus.input)) $.render();
  }
  document.addEventListener('visibilitychange', function () { paused = document.hidden; });

  function start() {
    overlay.style.display = 'none';
    canvas.style.visibility = 'visible';
    $.audio.unlock();
    $.createRoot();
    $.tick();
    $.render();
    if (!/[?&]manual\b/.test(location.search)) requestAnimationFrame(loop);
  }
  var pending = 2;
  function ready() {
    if (--pending) return;
    bar.style.width = '100%';
    if (/[?&](autostart|manual)\b/.test(location.search)) { start(); return; }
    status.textContent = '';
    startBtn.style.display = 'inline-block';
    startBtn.focus();
  }
  startBtn.addEventListener('click', start);
  loadImages(ready);
  $.audio.load(function (n, total) { bar.style.width = Math.round(100 * n / total) + '%'; status.textContent = 'Loading sounds ' + n + ' / ' + total; }).then(ready);
})();
