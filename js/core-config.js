  window.Flock = window.Flock || {};
  var API = (function() {
    var m = document.querySelector('meta[name="flock-api-url"]');
    return (m && m.getAttribute('content') ? m.getAttribute('content').trim() : '');
  })();
  //  Hash-based routing 
  var HASH_MAP = {
    'home':        'pg-home',
    'dashboard':   'pg-dash',
    'log':         'pg-log',
    'history':     'pg-history',
    'settings':    'pg-settings',
    'appsettings': 'pg-appsettings',
    'cadence':     'pg-cadence',
    'addperson':   'pg-addperson',
    'analytics':   'pg-analytics',
    'search':      'pg-search',
    'guide':       'pg-guide',
    'todos':       'pg-todos'
  };
  var PAGE_HASH = {};
  Object.keys(HASH_MAP).forEach(function(h){ PAGE_HASH[HASH_MAP[h]] = h; });
  var _navigating = false;
  var _addPersonReturn = null;

  function showApiMissingBanner_() {
    if (!isApiConfigMissing_(API) || document.getElementById('api-missing-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'api-missing-banner';
    banner.textContent = 'App not configured: set FLOCK_CLIENT_API_URL';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fef3c7;color:#7c2d12;border-bottom:1px solid #fcd34d;padding:10px 14px;font-size:13px;font-weight:600;text-align:center;';
    document.body.appendChild(banner);
  }
  function isApiConfigMissing_(value) {
    var v = String(value || '').trim();
    if (!v) return true;
    if (v === '__FLOCK_API_URL__') return true;
    if (v === '__FLOCK_CLIENT_API_URL__') return true;
    if (v === 'FLOCK_API_URL') return true;
    return false;
  }
  if (isApiConfigMissing_(API)) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showApiMissingBanner_);
    else showApiMissingBanner_();
  }

  var _globalFallbackShownAt = 0;
  var _lastGlobalErrorSig = '';
  var _lastGlobalErrorAt = 0;
  var _opaqueScriptErrCount = 0;
  var _opaqueScriptErrTimer = null;
  function escLocal_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }
  function showGlobalFallback_(msg) {
    var now = Date.now();
    if (now - _globalFallbackShownAt < 1200) return;
    _globalFallbackShownAt = now;
    var box = document.getElementById('global-error-fallback');
    if (!box) {
      box = document.createElement('div');
      box.id = 'global-error-fallback';
      box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:10000;background:#fff8e8;color:#5f3f16;border:1px solid #e3c27a;border-radius:10px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.15);font-size:13px;line-height:1.4;';
      document.body.appendChild(box);
    }
    box.innerHTML = '<div style="font-weight:700;margin-bottom:2px;">Something went wrong</div><div>' + escLocal_(String(msg || 'The app hit an unexpected error.')) + '</div>';
  }

  function isOpaqueScriptError_(detail) {
    var d = String(detail || '').trim().toLowerCase();
    return d === 'script error.' || d === 'script error' || d === '[object event]';
  }

  function appLooksReady_() {
    return !!document.querySelector('.page.active');
  }

  function shouldDedupGlobalError_(sig, now) {
    if (!sig) return false;
    if (sig === _lastGlobalErrorSig && (now - _lastGlobalErrorAt) < 5000) return true;
    _lastGlobalErrorSig = sig;
    _lastGlobalErrorAt = now;
    return false;
  }

  function handleGlobalError_(err, where, meta) {
    var now = Date.now();
    var detail = err && err.message ? err.message : String(err || 'Unknown error');
    var locationHint = '';
    if (meta && meta.filename) {
      locationHint = String(meta.filename) + (meta.lineno ? ':' + String(meta.lineno) : '');
    }
    var sig = [where || 'unknown', detail, locationHint].join('|');
    if (shouldDedupGlobalError_(sig, now)) return;

    if (isOpaqueScriptError_(detail)) {
      console.warn('[Flock] Opaque script error received:', { where: where, meta: meta });
      _opaqueScriptErrCount += 1;
      if (_opaqueScriptErrTimer) clearTimeout(_opaqueScriptErrTimer);
      _opaqueScriptErrTimer = setTimeout(function() {
        _opaqueScriptErrTimer = null;
        var shouldWarn = !appLooksReady_() || _opaqueScriptErrCount >= 3;
        _opaqueScriptErrCount = 0;
        if (shouldWarn && window.showUxToast) {
          window.showUxToast('Some scripts are still loading. If this screen stays blank, refresh.');
        }
      }, 2200);
      return;
    }

    console.error('[Flock] Global error in ' + (where || 'unknown') + ':', err, meta || '');
    showGlobalFallback_(detail);
    if (window.showUxToast) window.showUxToast('An error occurred. You can keep using other sections.');
  }

  function safeExecute_(fn, where) {
    try {
      var out = fn();
      if (out && typeof out.then === 'function') {
        return out.catch(function(err) {
          handleGlobalError_(err, where);
          return null;
        });
      }
      return Promise.resolve(out);
    } catch (err) {
      handleGlobalError_(err, where);
      return Promise.resolve(null);
    }
  }

  function initGlobalErrorBoundary_() {
    if (window.__flockGlobalErrorBoundaryReady) return;
    window.__flockGlobalErrorBoundaryReady = true;
    window.addEventListener('error', function(e) {
      if (!e) return;
      handleGlobalError_(e.error || e.message || 'Unexpected runtime error', 'window.onerror', {
        filename: e.filename || '',
        lineno: e.lineno || 0,
        colno: e.colno || 0
      });
    });
    window.addEventListener('unhandledrejection', function(e) {
      handleGlobalError_((e && e.reason) || 'Unhandled promise rejection', 'unhandledrejection');
      if (e && e.preventDefault) e.preventDefault();
    });
  }
  initGlobalErrorBoundary_();
  window.safeExecute_ = safeExecute_;
  window.handleGlobalError_ = handleGlobalError_;

  function updateMobileTabState_(pageId) {
    var bar = document.getElementById('mobile-tab-bar');
    if (!bar) return;
    bar.querySelectorAll('.tab-item').forEach(function(item) {
      item.classList.toggle('active', item.getAttribute('data-page') === pageId);
    });
  }

  function activePageId_() {
    var active = document.querySelector('.page.active');
    return active ? active.id : 'pg-home';
  }

  function showPage(id, pushState) {
    var currentId = activePageId_();
    if (id === 'pg-addperson' && currentId !== 'pg-addperson') {
      _addPersonReturn = { page: currentId || 'pg-home', scrollY: window.scrollY || 0 };
    }
    document.querySelectorAll('.page').forEach(function(p){
      p.classList.remove('active');
      p.classList.remove('page-in');
    });
    var targetPage = document.getElementById(id);
    if (!targetPage) return;
    targetPage.classList.add('active');
    targetPage.classList.add('page-in');
    setTimeout(function(){ targetPage.classList.remove('page-in'); }, 220);
    updateMobileTabState_(id);
    window.scrollTo(0,0);
    // Update hash without triggering hashchange handler
    if (pushState !== false) {
      _navigating = true;
      window.location.hash = PAGE_HASH[id] || 'home';
      setTimeout(function(){ _navigating = false; }, 50);
    }
    if (id === 'pg-dash')         safeExecute_(function(){ return loadDash(); }, 'showPage:loadDash');
    if (id === 'pg-log')          safeExecute_(function(){ return initLogPage(); }, 'showPage:initLogPage');
    if (id === 'pg-home')         safeExecute_(function(){ return loadHome(); }, 'showPage:loadHome');
    if (id === 'pg-history')      safeExecute_(function(){ return initHistoryPage(); }, 'showPage:initHistoryPage');
    if (id === 'pg-settings')     { safeExecute_(function(){ return initSettingsPage(); }, 'showPage:initSettingsPage'); }
    if (id === 'pg-appsettings')  safeExecute_(function(){ return loadAppSettings(); }, 'showPage:loadAppSettings');
    if (id === 'pg-cadence')      safeExecute_(function(){ return initCadencePage(); }, 'showPage:initCadencePage');
    if (id === 'pg-addperson')    safeExecute_(function(){ return initAddPersonPage(); }, 'showPage:initAddPersonPage');
    if (id === 'pg-analytics')    safeExecute_(function(){ return loadAnalytics(); }, 'showPage:loadAnalytics');
    if (id === 'pg-todos')        safeExecute_(function(){ return loadTodos(); }, 'showPage:loadTodos');
    if (id === 'pg-search') {
      setTimeout(function(){
        var inp = document.getElementById('search-page-input');
        if (inp) inp.focus();
      }, 120);
    }
    // close bottom sheet and stop voice when navigating away
    if (id !== 'pg-search') stopVoice && stopVoice();
  }

  function openAddPerson() {
    showPage('pg-addperson');
  }
  window.openAddPerson = openAddPerson;

  function returnFromAddPerson() {
    var ret = _addPersonReturn || { page: 'pg-home', scrollY: 0 };
    showPage(ret.page || 'pg-home');
    setTimeout(function(){ window.scrollTo(0, Number(ret.scrollY) || 0); }, 40);
  }
  window.returnFromAddPerson = returnFromAddPerson;

  window.addEventListener('hashchange', function() {
    if (_navigating) return;
    var hash = window.location.hash.replace('#', '');
    var pageId = HASH_MAP[hash] || 'pg-home';
    showPage(pageId, false);
  });


