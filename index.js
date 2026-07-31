(function () {
  'use strict';

  if (window.DeflyNameToggle && window.DeflyNameToggle.destroy) {
    try { window.DeflyNameToggle.destroy(); } catch (e) {}
  }

  var state = 'vanilla';
  var myCopter = null;
  var pinned = [];
  var rafId = 0;
  var guessId = -1, guessFrames = 0;

  var players = null, pixiPatched = false, origAddChild = null;

  function pin(obj, prop, value) {
    if (!obj) return;
    var slot = '__dnt_' + prop;
    if (Object.prototype.hasOwnProperty.call(obj, slot)) { obj[slot] = value; return; }
    var current = obj[prop];
    Object.defineProperty(obj, slot, {
      value: value, writable: true, configurable: true, enumerable: false
    });
    Object.defineProperty(obj, '__dnt_orig_' + prop, {
      value: current, writable: true, configurable: true, enumerable: false
    });
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: true,
      get: function () { return this[slot]; },
      set: function () {  }
    });
    if (pinned.indexOf(obj) === -1) pinned.push(obj);
  }

  function unpin(obj, prop) {
    if (!obj) return;
    var slot = '__dnt_' + prop;
    if (!Object.prototype.hasOwnProperty.call(obj, slot)) return;
    var restore = obj['__dnt_orig_' + prop];
    delete obj[prop];
    delete obj[slot];
    delete obj['__dnt_orig_' + prop];
    try { obj[prop] = restore; } catch (e) {}
  }

  function releaseAll() {
    for (var i = 0; i < pinned.length; i++) {
      unpin(pinned[i], 'alpha');
      unpin(pinned[i], 'visible');
    }
    pinned.length = 0;
  }

  function rootOf(n) { var g = 0; while (n && n.parent && g++ < 128) n = n.parent; return n; }

  function findPlayersContainer(root) {
    if (!root || !root.children) return null;
    for (var i = 0; i < root.children.length; i++) {
      var c = root.children[i];
      if (!c || !c.children || !c.children.length) continue;
      for (var j = 0; j < c.children.length; j++) {
        if (c.children[j] && typeof c.children[j].playerId === 'number') return c;
      }
    }
    return null;
  }

  function patchPixi() {
    if (pixiPatched || !window.PIXI || !window.PIXI.Container) return;
    var proto = window.PIXI.Container.prototype;
    origAddChild = proto.addChild;
    proto.addChild = function () {
      var res = origAddChild.apply(this, arguments);
      try {
        var child = arguments[0];
        if (child && typeof child.playerId === 'number' && child.playerId >= 0) {
          players = this;
          unpatchPixi();
        } else if (!players) {
          var pc = findPlayersContainer(rootOf(this));
          if (pc) { players = pc; unpatchPixi(); }
        }
      } catch (e) {}
      return res;
    };
    pixiPatched = true;
  }

  function unpatchPixi() {
    if (!pixiPatched) return;
    try { window.PIXI.Container.prototype.addChild = origAddChild; } catch (e) {}
    pixiPatched = false;
  }

  function detectMine() {
    if (!players) return null;
    var kids = players.children, i, c;

    for (i = 0; i < kids.length; i++) {
      c = kids[i];
      if (!c || typeof c.playerId !== 'number' || c.playerId < 0) continue;
      var t = c.usernameText;
      if (t && !Object.prototype.hasOwnProperty.call(t, '__dnt_alpha') && t.alpha < 0.999) {
        guessFrames = 0;
        return c;
      }
    }

    var wt = players.worldTransform;
    if (!wt) return null;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var best = null, bestD = Infinity;
    for (i = 0; i < kids.length; i++) {
      c = kids[i];
      if (!c || typeof c.playerId !== 'number' || c.playerId < 0) continue;
      if (c.visible === false) continue;
      var sx = wt.a * c.x + wt.c * c.y + wt.tx;
      var sy = wt.b * c.x + wt.d * c.y + wt.ty;
      var d = (sx - cx) * (sx - cx) + (sy - cy) * (sy - cy);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best || bestD > 80 * 80) { guessFrames = 0; return null; }
    if (best.playerId === guessId) guessFrames++;
    else { guessId = best.playerId; guessFrames = 1; }
    return guessFrames >= 20 ? best : null;
  }

  function apply() {
    if (state === 'vanilla' || !myCopter) return;
    var on = (state === 'shown');
    var t = myCopter.usernameText;
    if (t) { pin(t, 'alpha', on ? 1 : 0); pin(t, 'visible', on); }
    var b = myCopter.badge;
    if (b) { pin(b, 'alpha', on ? 1 : 0); pin(b, 'visible', on); }
  }

  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!players) { patchPixi(); return; }

    if (!myCopter || !myCopter.parent) {
      var found = detectMine();
      if (found && found !== myCopter) {
        releaseAll();
        myCopter = found;
      }
    }
    apply();
  }

  function typing() {
    var a = document.activeElement;
    if (!a) return false;
    var tag = (a.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || a.isContentEditable === true;
  }

  function onKey(e) {
    if (typing()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var hit = (e.code === 'KeyN') || (e.key && e.key.toLowerCase() === 'n');
    if (!hit) return;
    API.toggle();
  }

  var API = {
    show: function () {
      state = 'shown'; apply();
      console.log('[name-toggle] name + badge: ON');
      return API;
    },
    hide: function () {
      state = 'hidden'; apply();
      console.log('[name-toggle] name + badge: OFF');
      return API;
    },
    toggle: function () { return state === 'shown' ? API.hide() : API.show(); },
    release: function () {
      state = 'vanilla'; releaseAll();
      console.log('[name-toggle] released — back to the default fade');
      return API;
    },
    status: function () {
      console.log('[name-toggle] state:', state,
                  '| copter found:', !!myCopter,
                  '| id:', myCopter ? myCopter.playerId : '-',
                  '| badge:', myCopter && myCopter.badge ? 'yes' : 'no',
                  '| key:', 'n');
      return { state: state, found: !!myCopter, key: 'n' };
    },
    destroy: function () {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      window.removeEventListener('keydown', onKey, true);
      unpatchPixi();
      releaseAll();
      myCopter = null;
      delete window.DeflyNameToggle;
      console.log('[name-toggle] uninstalled');
    },
    __test: { pin: pin, unpin: unpin, releaseAll: releaseAll, pinnedList: pinned }
  };

  window.DeflyNameToggle = API;
  patchPixi();
  window.addEventListener('keydown', onKey, true);
  rafId = requestAnimationFrame(frame);

  console.log(
    '%c[name-toggle] ready%c\n' +
    'Press N to show or hide your own name + badge.\n' +
    'If nothing happens, spawn into a game first, then run DeflyNameToggle.status()',
    'background:#132;color:#9f8;padding:2px 6px;border-radius:3px;font-weight:700',
    'color:inherit'
  );
})();
