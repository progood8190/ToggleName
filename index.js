(function () {
  'use strict';
  if (window.DeflyNameToggle && window.DeflyNameToggle.destroy) { try { window.DeflyNameToggle.destroy(); } catch (e) {} }

  var state = 'vanilla';
  var players = null;
  var ownId = null;
  var mine = null;
  var expectOwn = false;
  var pinned = [], rafId = 0;

  var hunting = false, hooks = [], roots = [], cleared = [], clearQueued = false, searchTick = 0;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isCopter(c) { return !!c && c.playerId != null && c.playerId !== '' && Number(c.playerId) >= 0; }
  function sameId(a, b) { return a != null && b != null && Number(a) === Number(b); }

  function pin(obj, prop, value) {
    var slot = '__dnt_' + prop, want = '__dnt_orig_' + prop;
    if (has(obj, slot)) { obj[slot] = value; return; }
    var current = obj[prop];
    Object.defineProperty(obj, slot, { value: value, writable: true, configurable: true });
    Object.defineProperty(obj, want, { value: current, writable: true, configurable: true });
    Object.defineProperty(obj, prop, { configurable: true, enumerable: true,
      get: function () { return this[slot]; },
      set: function (v) { this[want] = v; } });
    if (pinned.indexOf(obj) === -1) pinned.push(obj);
  }
  function unpin(obj, prop) {
    var slot = '__dnt_' + prop, want = '__dnt_orig_' + prop;
    if (!has(obj, slot)) return;
    var restore = obj[want];
    delete obj[prop]; delete obj[slot]; delete obj[want];
    try { obj[prop] = restore; } catch (e) {}
  }
  function releaseAll() {
    for (var i = 0; i < pinned.length; i++) { unpin(pinned[i], 'alpha'); unpin(pinned[i], 'visible'); }
    pinned.length = 0;
  }

  function hook(obj, key, make) {
    var own = has(obj, key), orig = obj[key], wrapper = make(orig);
    obj[key] = wrapper;
    hooks.push({ obj: obj, key: key, own: own, orig: orig, wrapper: wrapper });
  }
  function unhookAll() {
    for (var i = hooks.length - 1; i >= 0; i--) {
      var h = hooks[i];
      if (h.obj[h.key] !== h.wrapper) continue;
      if (h.own) h.obj[h.key] = h.orig; else delete h.obj[h.key];
    }
    hooks.length = 0;
  }
  function markCleared(c) {
    cleared.push(c);
    if (!clearQueued) { clearQueued = true; Promise.resolve().then(function () { cleared.length = 0; clearQueued = false; }); }
  }
  function startHunt() {
    if (hunting || players || !window.PIXI || !window.PIXI.Container) return;
    hunting = true;
    var C = window.PIXI.Container.prototype;
    hook(C, 'addChild', function (orig) {
      return function (child) {
        var res = orig.apply(this, arguments);
        if (!players && arguments.length === 1 && child && typeof child.playerId === 'number' && child.playerId >= 0) {
          try { adopt(this, cleared.indexOf(this) !== -1 ? child : null); } catch (e) {}
        }
        return res;
      };
    });
    hook(C, 'removeChildren', function (orig) {
      return function () { var res = orig.apply(this, arguments); if (!players) markCleared(this); return res; };
    });
    [window.PIXI.WebGLRenderer, window.PIXI.CanvasRenderer].forEach(function (R) {
      if (!R || !R.prototype || typeof R.prototype.render !== 'function') return;
      hook(R.prototype, 'render', function (orig) {
        return function (root) {
          if (!players && root && roots.length < 8 && roots.indexOf(root) === -1) roots.push(root);
          return orig.apply(this, arguments);
        };
      });
    });
  }
  function stopHunt() { unhookAll(); hunting = false; roots.length = 0; }
  function searchLayer() {
    if (!roots.length || ++searchTick % 10) return;
    for (var r = 0; r < roots.length; r++) {
      var layers = roots[r].children || [];
      for (var i = 0; i < layers.length; i++) {
        var k = layers[i] && layers[i].children; if (!k) continue;
        for (var j = 0; j < k.length; j++) if (isCopter(k[j]) && k[j].usernameText) { adopt(layers[i], null); return; }
      }
    }
  }

  function adopt(layer, own) {
    players = layer; stopHunt();
    var baseAdd = layer.addChild, baseClear = layer.removeChildren;
    layer.addChild = function (child) {
      var res = baseAdd.apply(this, arguments);
      if (expectOwn && arguments.length === 1 && isCopter(child)) { expectOwn = false; ownId = child.playerId; }
      return res;
    };
    layer.removeChildren = function () {
      var res = baseClear.apply(this, arguments);
      releaseAll(); mine = null; ownId = null; expectOwn = true;
      Promise.resolve().then(function () { expectOwn = false; });
      return res;
    };
    if (own) ownId = own.playerId;
  }

  function findMine() {
    var kids = players.children, byId = null;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i]; if (!isCopter(c)) continue;
      var t = c.usernameText;
      if (t && !has(t, '__dnt_alpha') && t.alpha < 0.999) return c;
      if (!byId && sameId(c.playerId, ownId)) byId = c;
    }
    return byId;
  }
  function playing() { return !!(mine && mine.parent === players && mine.visible !== false); }

  function apply() {
    var on = state === 'shown', t = mine.usernameText, b = mine.badge;
    if (t) { pin(t, 'alpha', on ? 1 : 0); pin(t, 'visible', on); }
    if (b) { pin(b, 'alpha', on ? 1 : 0); pin(b, 'visible', on); }
  }
  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!players) { startHunt(); searchLayer(); return; }
    var found = findMine();
    if (found !== mine) { releaseAll(); mine = found; }
    if (found) ownId = found.playerId;
    if (playing() && state !== 'vanilla') apply();
    else if (pinned.length) releaseAll();
  }

  function typing() {
    var a = document.activeElement; if (!a) return false;
    var tag = (a.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || a.isContentEditable === true;
  }
  function onKey(e) {
    if (e.repeat || typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyN' || (e.key && e.key.toLowerCase() === 'n')) API.toggle();
  }

  var API = {
    show: function () { state = 'shown'; if (playing()) apply(); return API; },
    hide: function () { state = 'hidden'; if (playing()) apply(); return API; },
    toggle: function () {
      if (!playing()) return API;
      if (state === 'shown') return API.hide();
      if (state === 'hidden') return API.show();
      var t = mine.usernameText;
      return (t && t.visible !== false && t.alpha >= 0.5) ? API.hide() : API.show();
    },
    release: function () { state = 'vanilla'; releaseAll(); return API; },
    status: function () {
      return { state: state, playing: playing(), found: !!mine, id: mine ? mine.playerId : null, badge: !!(mine && mine.badge), key: 'n' };
    },
    destroy: function () {
      if (rafId) cancelAnimationFrame(rafId); rafId = 0;
      window.removeEventListener('keydown', onKey, true);
      stopHunt();
      if (players) { try { delete players.addChild; delete players.removeChildren; } catch (e) {} }
      releaseAll(); players = mine = ownId = null; expectOwn = false;
      delete window.DeflyNameToggle;
    }
  };

  window.DeflyNameToggle = API;
  startHunt();
  window.addEventListener('keydown', onKey, true);
  rafId = requestAnimationFrame(frame);
  console.log('[name-toggle] loaded');
})();
