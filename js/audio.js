// Sound playback with the Web Audio API (timeline sounds, Sound objects, stopAllSounds).
'use strict';
(function () {
  var LIB = window.LIB;
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, buffers = {}, playing = [];
  function init() {
    if (ctx || !AC) return;
    try { ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); } catch (e) { ctx = null; }
  }
  var audio = $.audio = {
    muted: false,
    load: function (onProgress) {
      init();
      var ids = Object.keys(LIB.sounds), n = 0;
      if (!ctx) return Promise.resolve();
      return Promise.all(ids.map(function (id) {
        var s = LIB.sounds[id];
        if (!s.file) { n++; return null; }
        return fetch(s.file).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then(function (b) { return new Promise(function (res, rej) { ctx.decodeAudioData(b, res, rej); }); })
          .then(function (buf) { buffers[id] = buf; })
          .catch(function (e) { console.warn('sound ' + id + ' not loaded:', e && e.message ? e.message : e); })
          .then(function () { n++; if (onProgress) onProgress(n, ids.length); });
      }));
    },
    unlock: function () { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    play: function (id, opts, onEnd) {
      var buf = buffers[id];
      if (!ctx || !buf) return null;
      opts = opts || {};
      var src = ctx.createBufferSource(), gain = ctx.createGain();
      src.buffer = buf;
      gain.gain.value = opts.volume === undefined ? 1 : opts.volume;
      src.connect(gain); gain.connect(master);
      var rate = 44100; // the converted files are 44.1 kHz; in/out points are given in samples at 44.1 kHz
      var start = opts.inPt ? opts.inPt / rate : (opts.offset || 0);
      var end = opts.outPt ? opts.outPt / rate : buf.duration;
      var loops = opts.loops || 1;
      var inst = { id: id, src: src, gain: gain, t0: ctx.currentTime, start: start, len: Math.max(0, end - start), clip: opts.clip || null };
      if (loops > 1) {
        src.loop = true; src.loopStart = start; src.loopEnd = end;
        src.start(0, start);
        if (loops < 10000) src.stop(ctx.currentTime + inst.len * loops);
      } else {
        src.start(0, start, inst.len);
      }
      src.onended = function () {
        var i = playing.indexOf(inst); if (i >= 0) playing.splice(i, 1);
        if (!inst.stopped && onEnd) onEnd();
      };
      playing.push(inst);
      return inst;
    },
    stop: function (inst) { if (!inst) return; inst.stopped = true; try { inst.src.stop(); } catch (e) { } var i = playing.indexOf(inst); if (i >= 0) playing.splice(i, 1); },
    stopAll: function () { playing.slice().forEach(audio.stop); },
    stopId: function (id) { playing.slice().forEach(function (p) { if (p.id == id) audio.stop(p); }); },
    isPlaying: function (id) { for (var i = 0; i < playing.length; i++) if (playing[i].id == id) return true; return false; },
    setVolume: function (inst, v) { if (inst) inst.gain.gain.value = v; },
    setGlobalVolume: function (v) { if (master) master.gain.value = audio.muted ? 0 : v; audio.volume = v; },
    setMuted: function (m) { audio.muted = m; if (master) master.gain.value = m ? 0 : (audio.volume === undefined ? 1 : audio.volume); },
    duration: function (id) { return buffers[id] ? buffers[id].duration * 1000 : 0; },
    position: function (inst) { return ctx && inst ? ((ctx.currentTime - inst.t0) % (inst.len || 1)) * 1000 : 0; },
    count: function () { return playing.length; },
  };
  // StartSound tag on a timeline
  $.startSound = function (id, info, clip) {
    if (info.stop) { audio.stopId(id); return; }
    if (info.noMulti && audio.isPlaying(id)) return;
    audio.play(id, { loops: info.loops || 1, inPt: info.inPt, outPt: info.outPt, clip: clip });
  };
  $.stopAllSounds = function () { audio.stopAll(); };
})();
