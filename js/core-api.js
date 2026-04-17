  window.Flock = window.Flock || {};
  var _apiGetInFlight = {};
  var _connState = {
    status: navigator.onLine ? 'good' : 'offline',
    lastReason: navigator.onLine ? 'boot-online' : 'boot-offline',
    recentFailures: 0,
    lastFailureAt: 0,
    debounceTimer: null,
    unstableUntil: 0
  };
  var CONN_DEBOUNCE_MS = 700;
  var CONN_OFFLINE_MS = 120;
  var CONN_UNSTABLE_HOLD_MS = 10000;

  function publishConnectionState_(status, reason, delayMs) {
    if (!status) return;
    var delay = typeof delayMs === 'number' ? delayMs : CONN_DEBOUNCE_MS;
    if (_connState.debounceTimer) clearTimeout(_connState.debounceTimer);
    _connState.debounceTimer = setTimeout(function() {
      _connState.debounceTimer = null;
      if (_connState.status === status && _connState.lastReason === reason) return;
      _connState.status = status;
      _connState.lastReason = reason || '';
      window.dispatchEvent(new CustomEvent('flock:connection-state', {
        detail: {
          status: _connState.status,
          reason: _connState.lastReason,
          recentFailures: _connState.recentFailures,
          unstableUntil: _connState.unstableUntil
        }
      }));
    }, Math.max(0, delay));
  }

  function markNetworkFailure_(reason) {
    var now = Date.now();
    _connState.lastFailureAt = now;
    _connState.recentFailures = (_connState.recentFailures || 0) + 1;
    if (!navigator.onLine) {
      publishConnectionState_('offline', reason || 'browser-offline', CONN_OFFLINE_MS);
      return;
    }
    _connState.unstableUntil = now + CONN_UNSTABLE_HOLD_MS;
    publishConnectionState_('unstable', reason || 'network-failure', CONN_DEBOUNCE_MS);
  }

  function markNetworkSuccess_() {
    var now = Date.now();
    if (!navigator.onLine) return;
    if (_connState.unstableUntil && now < _connState.unstableUntil) return;
    _connState.recentFailures = 0;
    publishConnectionState_('good', 'request-success', CONN_DEBOUNCE_MS);
  }

  function getConnectionState_() {
    return {
      status: _connState.status,
      reason: _connState.lastReason,
      recentFailures: _connState.recentFailures,
      unstableUntil: _connState.unstableUntil
    };
  }

  window.addEventListener('offline', function() {
    markNetworkFailure_('browser-offline');
  });
  window.addEventListener('online', function() {
    _connState.recentFailures = 0;
    _connState.unstableUntil = 0;
    publishConnectionState_('good', 'browser-online', CONN_DEBOUNCE_MS);
  });

  function getGetTimeoutMs_(action) {
    if (action === 'duePeople') return 35000;
    if (action === 'getAnalytics') return 30000;
    return 15000;
  }

  function getPostTimeoutMs_(action) {
    if (action === 'saveInteraction') return 35000;
    if (action === 'saveTodos') return 25000;
    if (action === 'addPerson') return 25000;
    if (action === 'editPerson') return 25000;
    return 20000;
  }

  function isNetworkFailure_(err) {
    if (!err) return !navigator.onLine;
    if (!navigator.onLine) return true;
    if (err.name === 'AbortError' || err.code === 20) return true;
    var msg = String((err && err.message) ? err.message : err).toLowerCase();
    return (
      msg.indexOf('timed out') >= 0 ||
      msg.indexOf('timeout') >= 0 ||
      msg.indexOf('failed to fetch') >= 0 ||
      msg.indexOf('networkerror') >= 0 ||
      msg.indexOf('network error') >= 0 ||
      msg.indexOf('load failed') >= 0 ||
      msg.indexOf('fetch failed') >= 0 ||
      msg.indexOf('internet disconnected') >= 0
    );
  }

  function saveInteractionWithOfflineFallback_(payload) {
    var queuedPayload = Object.assign({}, payload || {});
    if (!navigator.onLine) {
      if (typeof queueOfflineCall === 'function') queueOfflineCall(queuedPayload);
      return Promise.resolve({ success: true, offline: true });
    }
    return apiPost('saveInteraction', { payload: payload || {} })
      .catch(function(err) {
        if (isNetworkFailure_(err)) {
          if (typeof queueOfflineCall === 'function') queueOfflineCall(queuedPayload);
          return { success: true, offline: true };
        }
        throw err;
      });
  }

  function apiFetch(action, params) {
    if (!API) return Promise.reject(new Error('API URL is not configured.'));
    var url = API + '?action=' + action;
    if (params) {
      Object.keys(params).forEach(function(k){
        url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
    }
    if (_apiGetInFlight[url]) return _apiGetInFlight[url];
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, getGetTimeoutMs_(action));
    _apiGetInFlight[url] = fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal })
      .then(function(r) {
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(text) {
        try {
          var parsed = normalizeApiResponse_(JSON.parse(text));
          markNetworkSuccess_();
          return parsed;
        } catch (e) {
          throw new Error('Response was not JSON: ' + text.slice(0, 200));
        }
      })
      .catch(function(e) {
        clearTimeout(timeoutId);
        if (e && e.name === 'AbortError') {
          markNetworkFailure_('request-timeout');
          throw new Error('Request timed out - please try again');
        }
        if (isNetworkFailure_(e)) markNetworkFailure_('network-failure');
        throw e;
      })
      .finally(function() {
        delete _apiGetInFlight[url];
      });
    return _apiGetInFlight[url];
  }

  function apiPost(action, payload) {
    if (!API) return Promise.reject(new Error('API URL is not configured.'));
    payload = payload || {};
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, getPostTimeoutMs_(action));
    return fetch(API + '?action=' + encodeURIComponent(action), {
      method: 'POST',
      redirect: 'follow',
      // Use a "simple request" content type to avoid CORS preflight failures
      // against Apps Script web apps (which often don't answer OPTIONS).
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload || {}),
      signal: controller.signal
    })
      .then(function(r) {
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(text) {
        try {
          var parsed = normalizeApiResponse_(JSON.parse(text));
          markNetworkSuccess_();
          return parsed;
        } catch (e) {
          throw new Error('Response was not JSON: ' + text.slice(0, 200));
        }
      })
      .catch(function(e) {
        clearTimeout(timeoutId);
        if (e && e.name === 'AbortError') {
          markNetworkFailure_('request-timeout');
          throw new Error('Request timed out - please try again');
        }
        if (isNetworkFailure_(e)) markNetworkFailure_('network-failure');
        throw e;
      });
  }

  function normalizeApiResponse_(res) {
    if (!res || typeof res !== 'object') return res;
    if (Object.prototype.hasOwnProperty.call(res, 'success')) {
      if (!res.success) throw new Error(res.error || 'Request failed');
      if (Object.prototype.hasOwnProperty.call(res, 'data')) return res.data;
      return res;
    }
    if (Object.prototype.hasOwnProperty.call(res, 'error')) {
      throw new Error(res.error || 'Request failed');
    }
    return res;
  }

  function hapticTick_() {
    if (navigator.vibrate) navigator.vibrate(30);
  }

  document.addEventListener('click', function(e) {
    var tab = e.target.closest('#mobile-tab-bar .tab-item');
    if (!tab) return;
    var pageId = tab.getAttribute('data-page');
    if (!pageId) return;
    showPage(pageId);
  });

  function getGreeting_() {
    var h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }
  window.getGreeting_ = getGreeting_;

  var _homeQuickStatsCache = null;
  var _peopleCache = { data: null, promise: null };

  function invalidatePeopleCache() {
    _peopleCache = { data: null, promise: null };
    window._peopleCache = _peopleCache;
  }

  function getPeople(forceRefresh) {
    if (!forceRefresh && Array.isArray(_peopleCache.data)) return Promise.resolve(_peopleCache.data);
    if (!forceRefresh && _peopleCache.promise) return _peopleCache.promise;
    _peopleCache.promise = apiFetch('people').then(function(list) {
      _peopleCache.data = Array.isArray(list) ? list : [];
      _peopleCache.promise = null;
      window._peopleCache = _peopleCache;
      return _peopleCache.data;
    }).catch(function(e) {
      _peopleCache.promise = null;
      window._peopleCache = _peopleCache;
      throw e;
    });
    return _peopleCache.promise;
  }
  window.getPeople = getPeople;
  window.invalidatePeopleCache = invalidatePeopleCache;
  window._peopleCache = _peopleCache;
  window.isNetworkFailure_ = isNetworkFailure_;
  window.saveInteractionWithOfflineFallback_ = saveInteractionWithOfflineFallback_;
  window.getConnectionState_ = getConnectionState_;
