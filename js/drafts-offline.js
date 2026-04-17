(function(){
  var AI_DRAFT_KEY = 'ct-ai-draft-v2';
  var LOG_DRAFT_KEY = 'ct-log-draft-v1';
  var BS_DRAFT_KEY = 'ct-bs-draft-v1';
  var REMINDERS_KEY = 'ct-local-reminders-v1';
  var _aiConfirmInFlight = false;

  function byId(id){ return document.getElementById(id); }
  function safeJsonParse(str, fallback){ try { return JSON.parse(str); } catch(e){ return fallback; } }
  function setLS(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  function getLS(k, fallback){ try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; } }
  function delLS(k){ try { localStorage.removeItem(k); } catch(e){} }
  function normalize(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim(); }
  function words(s){ return normalize(s).split(' ').filter(function(x){ return x && x.length > 1; }); }
  function initials(name){ var parts = String(name||'').trim().split(/\s+/).filter(Boolean); return parts.length === 1 ? parts[0].slice(0,2).toUpperCase() : (parts[0][0] + parts[parts.length-1][0]).toUpperCase(); }
  function dtLocalValue(d){
    if (!(d instanceof Date) || isNaN(d)) return '';
    var yyyy=d.getFullYear(), mm=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
    var hh=String(d.getHours()).padStart(2,'0'), mi=String(d.getMinutes()).padStart(2,'0');
    return yyyy+'-'+mm+'-'+dd+'T'+hh+':'+mi;
  }
  function dateOnlyValue(d){
    if (!(d instanceof Date) || isNaN(d)) return '';
    var yyyy=d.getFullYear(), mm=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
    return yyyy+'-'+mm+'-'+dd;
  }
  function timeOnlyValue(d){
    if (!(d instanceof Date) || isNaN(d)) return '';
    var hh=String(d.getHours()).padStart(2,'0'), mi=String(d.getMinutes()).padStart(2,'0');
    return hh+':'+mi;
  }
  function parseLocalDate(v){ return v ? new Date(v) : null; }
  function splitDateTimeParts_(value){
    var raw = String(value || '').trim();
    if (!raw) return { date:'', time:'' };
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
      return { date: raw.slice(0, 10), time: raw.slice(11, 16) };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return { date: raw, time: '' };
    }
    var d = new Date(raw);
    if (isNaN(d.getTime())) return { date:'', time:'' };
    return { date: dateOnlyValue(d), time: timeOnlyValue(d) };
  }
  function buildDateTime_(dateValue, timeValue){
    var d = String(dateValue || '').trim();
    var t = String(timeValue || '').trim();
    if (!d) return null;
    if (!t) t = '12:00';
    return d + 'T' + t;
  }
  function isWithinNextWeek(d){
    if (!(d instanceof Date) || isNaN(d)) return false;
    var now = new Date();
    return d.getTime() - now.getTime() <= 7*24*60*60*1000 && d.getTime() >= now.getTime() - 60*1000;
  }
  function formatResolvedDate(d){
    if (!(d instanceof Date) || isNaN(d)) return 'No date selected';
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diffDays = Math.round((startDate - startToday) / 86400000);
    var timeStr = d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
    var dateStr = d.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
    if (diffDays === 0) return 'Today - ' + dateStr + ', ' + timeStr;
    if (diffDays === 1) return 'Tomorrow - ' + dateStr + ', ' + timeStr;
    if (diffDays > 1 && diffDays <= 7) return dateStr + ', ' + timeStr;
    if (diffDays === 14) return 'In 2 weeks - ' + dateStr + ', ' + timeStr;
    if (diffDays === 21) return 'In 3 weeks - ' + dateStr + ', ' + timeStr;
    return d.toLocaleDateString([], { weekday:'long', month:'short', day:'numeric' }) + ', ' + timeStr;
  }
  function twoWeeksDate(){ var d=new Date(); d.setDate(d.getDate()+14); d.setHours(10,0,0,0); return d; }
  function nextWeekDate(base){
    var d = new Date(base || new Date());
    d.setDate(d.getDate() + 7);
    d.setHours(10,0,0,0);
    return d;
  }
  function tomorrowDate(){ var d=new Date(); d.setDate(d.getDate()+1); d.setHours(10,0,0,0); return d; }
  function thisFridayDate(){
    var d=new Date();
    var day=d.getDay();
    var diff=(5 - day + 7) % 7;
    if (diff === 0 && d.getHours() >= 17) diff = 7;
    d.setDate(d.getDate()+diff);
    d.setHours(10,0,0,0);
    return d;
  }
  function notify(title, body, tag){
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body: body || '', tag: tag || '' }); } catch(e) {}
  }
  function getDailySummaryMode(){ try { return localStorage.getItem('ct-daily-summary-mode') || ''; } catch(e){ return ''; } }
  function setDailySummaryMode(mode){ try { localStorage.setItem('ct-daily-summary-mode', mode || ''); } catch(e){} }
  function supportsSystemNotifications(){
    return ('Notification' in window);
  }
  function isiOSWebPushEligible(){
    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return { ok: true, reason: '' };
    var isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone && !window.navigator.standalone) {
      return { ok: false, reason: 'On iPhone, notifications require the app to be installed (Add to Home Screen).' };
    }
    return { ok: true, reason: '' };
  }
  function isDailySummaryEnabled(){ try { return localStorage.getItem('ct-daily-summary-enabled') === '1'; } catch(e){ return false; } }
  function getDailySummaryStatusText(){
    if (!isDailySummaryEnabled()) return 'Off';
    var mode = getDailySummaryMode();
    if (mode === 'inapp') return 'On (in-app)';
    if (!supportsSystemNotifications()) return 'On (in-app)';
    var iosCheck = isiOSWebPushEligible();
    if (!iosCheck.ok) return 'On (in-app)';
    if (Notification.permission === 'granted') return 'On';
    if (Notification.permission === 'denied') return 'Blocked in browser';
    return 'Needs permission';
  }
  function requestPhoneNotifications(){
    if (!('Notification' in window)) { return Promise.resolve('unsupported'); }
    var iosCheck = isiOSWebPushEligible();
    if (!iosCheck.ok) return Promise.resolve('ios-install-required');
    return Notification.requestPermission().then(function(permission){
      return permission;
    });
  }
  function requestNotificationPermission(){
    return requestPhoneNotifications().then(function(permission){
      updateDailySummaryUi();
      return permission;
    }).catch(function(e){
      if (window.showUxToast) window.showUxToast('Could not request notifications right now.');
      console.warn('[Flock]', e);
      updateDailySummaryUi();
      return 'error';
    });
  }
  function updateDailySummaryUi(){
    var stat = byId('phone-notif-status');
    if (stat) stat.textContent = getDailySummaryStatusText();
    var label = byId('daily-summary-toggle-label');
    if (label) { label.textContent = isDailySummaryEnabled() ? 'On' : 'Off'; label.className = 'sw-label ' + (isDailySummaryEnabled() ? 'on' : 'off'); }
    var toggle = byId('daily-summary-toggle');
    if (toggle) toggle.checked = isDailySummaryEnabled();
  }
  function toggleDailySummary(on){
    var canSystemNotify = supportsSystemNotifications() && isiOSWebPushEligible().ok;
    if (on) {
      if (!canSystemNotify) {
        try { localStorage.setItem('ct-daily-summary-enabled', '1'); } catch(e){}
        setDailySummaryMode('inapp');
        updateDailySummaryUi();
        notifyDueSummaryOnce(true);
        if (window.showUxToast) window.showUxToast('Daily alerts enabled (in-app).');
        return;
      }
      requestNotificationPermission().then(function(permission){
        if (permission === 'granted') {
          try { localStorage.setItem('ct-daily-summary-enabled', '1'); } catch(e){}
          setDailySummaryMode('system');
          updateDailySummaryUi();
          notifyDueSummaryOnce(true);
        } else {
          try { localStorage.setItem('ct-daily-summary-enabled', '1'); } catch(e){}
          setDailySummaryMode('inapp');
          updateDailySummaryUi();
          notifyDueSummaryOnce(true);
          if (window.showUxToast) window.showUxToast('System notifications unavailable. Using in-app daily alerts.');
        }
      });
    } else {
      try { localStorage.setItem('ct-daily-summary-enabled', '0'); } catch(e){}
      setDailySummaryMode('');
      updateDailySummaryUi();
    }
  }
  window.requestPhoneNotifications = requestPhoneNotifications;
  window.requestNotificationPermission = requestNotificationPermission;
  window.toggleDailySummary = toggleDailySummary;

  function listReminders(){ return getLS(REMINDERS_KEY, []); }
  function saveReminders(list){ setLS(REMINDERS_KEY, list); }
  var _scheduledTimers = [];
  function clearReminderTimers(){ _scheduledTimers.forEach(clearTimeout); _scheduledTimers=[]; }
  function scheduleLocalReminder(payload){ return; }
  function bootstrapReminderTimers(){ clearReminderTimers(); }

  function enhanceSettings(){
    var old = byId('settings-your-name');
    if (old) {
      var card = old.closest('div[style*="background:var(--surface)"]');
      if (card) card.remove();
    }
  }

  var _origLoadAppSettings = window.loadAppSettings;
  window.loadAppSettings = function(){
    var el = byId('app-settings-list');
    if (!el) return;
    el.innerHTML = '<div class="people-loading" style="padding:16px 0"><span>Loading</span><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>';
    apiFetch('getSettings').then(function(list){
      list = Array.isArray(list) ? list.slice() : [];
      var keyNorm = function(s){ return String((s && s.key) || '').trim().toUpperCase(); };
      var nameEntry = list.find(function(s){ return keyNorm(s) === 'YOUR_NAME'; }) || { key:'YOUR_NAME', label:'Your Name', desc:'Used in greetings and reminders.', val:(window._userName && window._userName !== 'Pastor' ? window._userName : '') };
      var notifEntry = list.find(function(s){ return keyNorm(s) === 'NOTIFICATIONS_ENABLED'; }) || { key:'NOTIFICATIONS_ENABLED', label:'Notifications', desc:'Turn daily and weekly reminder notifications on or off.', val:'true' };
      list = list.filter(function(s){ var k = keyNorm(s); return k !== 'YOUR_NAME' && k !== 'NOTIFICATIONS_ENABLED'; });
      var icons = {
        'REMINDER_EMAIL':'&#128231;','MORNING_REMINDER_HOUR':'&#127749;','DUESTATUS_REFRESH_HOUR':'&#128260;','MONDAY_FOLLOWUPS_HOUR':'&#128203;','TIMEZONE':'&#127757;'
      };
      var h = '';
      h += '<div class="aset-row">' +
        '<div class="aset-label">&#128100; Your Name</div>' +
        '<div class="aset-desc">Used in greetings and reminders.</div>' +
        '<div class="aset-row-ctrl aset-row-ctrl-name">' +
          '<input class="aset-input" id="appsettings-your-name" value="' + esc(nameEntry.val || '') + '" placeholder="e.g. Pastor John">' +
          '<button class="aset-save" id="appsettings-your-name-btn" data-action="save-your-name">Save</button>' +
          '<span class="aset-status" id="appsettings-your-name-status"></span>' +
        '</div>' +
      '</div>';
      h += '<div class="aset-row">' +
        '<div class="aset-label">&#128197; Daily Summary Notifications</div>' +
        '<div class="aset-desc">Get one summary notification per day.</div>' +
        '<div class="aset-inline-divider"></div>' +
        '<div class="aset-switch-row">' +
          '<div class="aset-switch-label">Enable notifications</div>' +
          '<div class="sw-wrap">' +
            '<span class="sw-label ' + (isDailySummaryEnabled() ? 'on' : 'off') + '" id="daily-summary-toggle-label">' + (isDailySummaryEnabled() ? 'On' : 'Off') + '</span>' +
            '<label class="sw">' +
              '<input type="checkbox" id="daily-summary-toggle" ' + (isDailySummaryEnabled() ? 'checked' : '') + ' data-action="toggle-daily-summary">' +
              '<span class="sw-track"></span>' +
            '</label>' +
          '</div>' +
        '</div>' +
        '<div id="phone-notif-status" class="aset-desc aset-status-line">' + getDailySummaryStatusText() + '</div>' +
      '</div>';
      var notifRaw = String(notifEntry.val == null ? '' : notifEntry.val).trim().toLowerCase();
      var notifOn = notifRaw === 'true' || notifRaw === '1' || notifRaw === 'yes' || notifRaw === 'on';
      h += '<div class="aset-row">' +
        '<div class="aset-label">&#9881; ' + esc(notifEntry.label || 'Notifications') + '</div>' +
        (notifEntry.desc ? '<div class="aset-desc">' + esc(notifEntry.desc) + '</div>' : '') +
        '<input type="hidden" class="aset-input" id="aset-NOTIFICATIONS_ENABLED" data-setting-input="NOTIFICATIONS_ENABLED" value="' + (notifOn ? 'true' : 'false') + '">' +
        '<div class="aset-inline-divider"></div>' +
        '<div class="aset-switch-row">' +
          '<div class="aset-switch-label">Enable notifications</div>' +
          '<div class="sw-wrap">' +
            '<span class="sw-label ' + (notifOn ? 'on' : 'off') + '" id="notif-enabled-label">' + (notifOn ? 'On' : 'Off') + '</span>' +
            '<label class="sw">' +
              '<input type="checkbox" id="notif-enabled-toggle" ' + (notifOn ? 'checked' : '') + ' data-action="toggle-notifications-setting" data-setting-input="NOTIFICATIONS_ENABLED" data-key="NOTIFICATIONS_ENABLED" data-label-id="notif-enabled-label">' +
              '<span class="sw-track"></span>' +
            '</label>' +
          '</div>' +
        '</div>' +
        '<div class="aset-row-ctrl aset-row-ctrl-bool" style="justify-content:flex-end;margin-top:8px;">' +
          '<span class="aset-status" id="asstat-NOTIFICATIONS_ENABLED"></span>' +
        '</div>' +
      '</div>';
      h += list.map(function(s){
        var keyRaw = String((s && s.key) || '').trim();
        var keyUpper = keyRaw.toUpperCase();
        var k = esc(keyRaw), icon = icons[keyUpper] || '&#9881;';
        var ctrlHtml =
          '<div class="aset-row-ctrl">' +
            '<input class="aset-input" id="aset-' + k + '" data-setting-input="' + k + '" value="' + esc(s.val) + '" placeholder="-">' +
            '<button class="aset-save" id="assave-' + k + '" data-action="save-app-setting" data-key="' + k + '">Save</button>' +
            '<span class="aset-status" id="asstat-' + k + '"></span>' +
          '</div>';
        return '<div class="aset-row">' +
          '<div class="aset-label">' + icon + ' ' + esc(s.label || keyRaw) + '</div>' +
          (s.desc ? '<div class="aset-desc">' + esc(s.desc) + '</div>' : '') +
          ctrlHtml +
        '</div>';
      }).join('');
      el.innerHTML = h;
    }).catch(function(e){
      el.innerHTML = '<div class="err-box">Could not load settings.<br><small>' + esc(String(e)) + '</small></div>';
    });
  };
  window.saveYourName = function(){
    var inp = byId('appsettings-your-name') || byId('settings-your-name');
    var btn = byId('appsettings-your-name-btn') || byId('your-name-btn');
    var stat = byId('appsettings-your-name-status') || byId('your-name-status');
    if (!inp) return;
    var val = inp.value.trim();
    if (!val) { if (stat) { stat.textContent = 'âœ•'; stat.className='aset-status err'; } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'â€¦'; }
    apiPost('saveSetting', { key:'YOUR_NAME', val:val }).then(function(res){
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      if (res && res.success) {
        window._userName = val;
        var greetEl = byId('home-greeting');
        if (greetEl) { var gr = window.getGreeting_ ? window.getGreeting_() : 'Good morning'; greetEl.textContent = val ? gr + ', ' + val + '.' : gr + '.'; }
        if (stat) { stat.textContent = 'âœ“'; stat.className='aset-status ok'; }
      } else if (stat) { stat.textContent='âœ•'; stat.className='aset-status err'; }
    }).catch(function(e){ console.warn('[Flock]', e); if (btn) { btn.disabled=false; btn.textContent='Save'; } if (stat) { stat.textContent='âœ•'; stat.className='aset-status err'; } });
  };

  function saveAiDraft(){
    var draft = {
      text: byId('ai-input') ? byId('ai-input').value : '',
      parsed: window._aiParsed || null,
      updatedAt: new Date().toISOString()
    };
    setLS(AI_DRAFT_KEY, draft);
  }
  function clearAiDraft(){ delLS(AI_DRAFT_KEY); }
  function saveLogDraft(){
    var pid = byId('person-id') ? byId('person-id').value : '';
    var draft = {
      personId: pid,
      personName: byId('sel-name') ? byId('sel-name').textContent : '',
      result: window.selResult || '',
      action: window.selAction || 'None',
      date: byId('next-dt') ? byId('next-dt').value : '',
      summary: byId('summary') ? byId('summary').value : ''
    };
    setLS(LOG_DRAFT_KEY, draft);
  }
  function clearLogDraft(){ delLS(LOG_DRAFT_KEY); }
  function saveBsDraft(){
    if (!window.bsPid) return;
    setLS(BS_DRAFT_KEY, {
      personId: window.bsPid,
      personName: window.bsName,
      result: window.bsResult || '',
      action: window.bsAction || 'None',
      date: byId('bs-next-dt') ? byId('bs-next-dt').value : '',
      summary: byId('bs-summary') ? byId('bs-summary').value : ''
    });
  }
  function clearBsDraft(){ delLS(BS_DRAFT_KEY); }

  function restoreLogDraft(){
    var draft = getLS(LOG_DRAFT_KEY, null);
    if (!draft || !draft.personId || !byId('person-id')) return;
    byId('person-id').value = draft.personId;
    if (byId('person-search')) byId('person-search').style.display = 'none';
    if (byId('sel-pill')) byId('sel-pill').classList.add('on');
    if (byId('sel-name')) byId('sel-name').textContent = draft.personName || draft.personId;
    if (byId('sel-av')) byId('sel-av').textContent = initials(draft.personName || draft.personId);
    if (draft.summary && byId('summary')) byId('summary').value = draft.summary;
    if (draft.date && byId('next-dt')) byId('next-dt').value = draft.date;
    window.selResult = draft.result || '';
    window.selAction = draft.action || 'None';
    document.querySelectorAll('.chip').forEach(function(c){ c.className = 'chip'; });
    document.querySelectorAll('.ac').forEach(function(c){ c.className = 'ac'; });
    if (draft.result) {
      var rb = document.querySelector('.chip[data-r="' + draft.result.replace(/"/g,'\\"') + '"]');
      if (rb && window.pickResult) window.pickResult(rb);
    }
    var ab = document.querySelector('.ac[data-a="' + (draft.action || 'None').replace(/"/g,'\\"') + '"]');
    if (ab && window.pickAction) window.pickAction(ab);
    if ((draft.action === 'Callback' || draft.action === 'Follow-up') && byId('dateWrap')) byId('dateWrap').classList.add('on');
    if (byId('msg-bar')) { byId('msg-bar').textContent = 'Draft restored.'; byId('msg-bar').className = 'msg info'; }
  }

  function restoreBsDraftIfMatch(pid){
    var draft = getLS(BS_DRAFT_KEY, null);
    if (!draft || draft.personId !== pid) return;
    if (draft.summary && byId('bs-summary')) byId('bs-summary').value = draft.summary;
    if (draft.date && byId('bs-next-dt')) byId('bs-next-dt').value = draft.date;
    if (draft.result) {
      var rbtn = document.querySelector('#bsheet .chip[data-r="' + draft.result.replace(/"/g,'\\"') + '"]');
      if (rbtn && window.bsPick) window.bsPick(rbtn,'r');
    }
    var abtn = document.querySelector('#bsheet .ac[data-a="' + (draft.action || 'None').replace(/"/g,'\\"') + '"]');
    if (abtn && window.bsPick) window.bsPick(abtn,'a');
    if ((draft.action === 'Callback' || draft.action === 'Follow-up') && byId('bs-dateWrap')) byId('bs-dateWrap').style.display = 'block';
    if (byId('bs-msg')) { byId('bs-msg').textContent = 'Draft restored.'; byId('bs-msg').className = 'msg info'; }
  }

  function escapeRegExp_(str){
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function uniq_(arr){
    var seen = {};
    var out = [];
    (arr || []).forEach(function(item){
      var key = String(item || '').trim();
      if (!key) return;
      var norm = key.toLowerCase();
      if (seen[norm]) return;
      seen[norm] = true;
      out.push(key);
    });
    return out;
  }
  function normalizeForAssist_(text){
    var raw = String(text || '');
    var contractions = {
      "can't":"cannot","won't":"will not","don't":"do not","didn't":"did not","isn't":"is not","aren't":"are not",
      "wasn't":"was not","weren't":"were not","couldn't":"could not","shouldn't":"should not","wouldn't":"would not",
      "haven't":"have not","hasn't":"has not","hadn't":"had not","i'm":"i am","i've":"i have","i'll":"i will",
      "we're":"we are","we've":"we have","we'll":"we will","they're":"they are","they've":"they have","they'll":"they will",
      "he's":"he is","she's":"she is","it's":"it is","that's":"that is","there's":"there is","let's":"let us"
    };
    var lower = raw.toLowerCase().replace(/[\u2018\u2019]/g, "'");
    Object.keys(contractions).forEach(function(c){
      lower = lower.replace(new RegExp('\\b' + escapeRegExp_(c) + '\\b', 'g'), contractions[c]);
    });
    lower = lower.replace(/[^a-z0-9:/,\-\s]/g, ' ');
    lower = lower.replace(/\s+/g, ' ').trim();
    return lower;
  }
  function sentenceList_(text){
    return String(text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function(s){ return s.trim(); })
      .filter(Boolean);
  }
  function extractTodosSmart_(text){
    var actions = [];
    var trigger = /\b(will|need to|must|should|plan to|going to|todo|to do|action item|remind|follow up|check in|send|text|email|pray|visit|call|share|schedule|prepare|review)\b/i;
    sentenceList_(text).forEach(function(s){
      if (s.length < 6 || s.length > 180) return;
      if (!trigger.test(s)) return;
      actions.push(s.replace(/^[\-*]\s*/, '').trim());
    });
    return uniq_(actions).slice(0, 6);
  }
  function detectResultSmart_(norm){
    if (!norm) return { value:'', confidence:0 };
    var leftMessageHints = ['left message','left a message','voicemail','voice mail','went to voicemail'];
    var noAnswerHints = ['no answer','did not answer','did not pick up','not available','could not reach','missed call','no response'];
    var reachedHints = ['spoke with','talked with','talked to','connected with','had a call','had a chat','answered','picked up','discussed','shared that'];
    var rescheduledHints = ['rescheduled','postponed','moved the call','moved to next','moved to later'];
    var has = function(list){ return list.some(function(p){ return norm.indexOf(p) >= 0; }); };
    if (has(leftMessageHints)) return { value:'Left Message', confidence:0.97 };
    if (has(noAnswerHints)) return { value:'No Answer', confidence:0.95 };
    if (has(rescheduledHints)) return { value:'Rescheduled Call', confidence:0.88 };
    if (has(reachedHints)) return { value:'Reached', confidence:0.9 };
    return { value:'', confidence:0 };
  }
  function detectActionSmart_(norm){
    if (!norm) return { value:'', confidence:0 };
    var callbackHints = ['call back','callback','ring back','phone back','call me back','call them back','call her back','call him back'];
    var followUpHints = ['follow up','check in','check on','touch base','reconnect','reach out','circle back','send','email','text','visit','next week','tomorrow','this friday','next monday','in 2 days','in 3 days','in a week'];
    var has = function(list){ return list.some(function(p){ return norm.indexOf(p) >= 0; }); };
    if (has(callbackHints)) return { value:'Callback', confidence:0.9 };
    if (has(followUpHints)) return { value:'Follow-up', confidence:0.82 };
    return { value:'', confidence:0 };
  }
  function detectDateSmart_(rawText, normText){
    var parsed = null;
    var confidence = 0;
    try {
      if (typeof chrono !== 'undefined' && chrono.parse) {
        var results = chrono.parse(rawText, new Date(), { forwardDate:true });
        if (results && results.length) {
          parsed = results[0].start.date();
          if (parsed && !isNaN(parsed.getTime())) {
            if (!results[0].start.isCertain('hour')) parsed.setHours(10, 0, 0, 0);
            confidence = results[0].start.isCertain('day') ? 0.82 : 0.65;
            return { date: parsed, confidence: confidence };
          }
        }
      }
    } catch(e){}
    var relativeMatch = normText.match(/\bin\s+(\d{1,2})\s+days?\b/);
    if (relativeMatch) {
      parsed = new Date();
      parsed.setDate(parsed.getDate() + parseInt(relativeMatch[1], 10));
      parsed.setHours(10, 0, 0, 0);
      return { date: parsed, confidence: 0.6 };
    }
    if (/\btomorrow\b/.test(normText)) return { date: tomorrowDate(), confidence: 0.74 };
    if (/\bnext week\b/.test(normText)) return { date: nextWeekDate(), confidence: 0.6 };
    if (/\bthis friday\b|\bfriday\b/.test(normText)) return { date: thisFridayDate(), confidence: 0.58 };
    return { date: null, confidence: 0 };
  }
  function matchPeople(desc, people){
    var raw = String(desc || '');
    var normalizedDesc = normalizeForAssist_(raw);
    var descTokens = words(normalizedDesc).filter(function(t){ return t.length > 2; });
    var ranked = (people || []).map(function(p){
      var name = String((p && p.name) || '').trim();
      if (!name) return { person:p, score:0 };
      var score = 0;
      var nameNorm = normalizeForAssist_(name);
      var nameTokens = words(nameNorm).filter(function(t){ return t.length > 2; });
      if (nameNorm && normalizedDesc.indexOf(nameNorm) >= 0) score += 0.78;
      if (nameTokens.length >= 2) {
        var fullRe = new RegExp('\\b' + nameTokens.map(escapeRegExp_).join('\\s+') + '\\b', 'i');
        if (fullRe.test(raw)) score += 0.24;
      }
      nameTokens.forEach(function(tok){
        if (descTokens.indexOf(tok) >= 0) score += 0.09;
      });
      if (nameTokens[0]) {
        var firstRe = new RegExp('\\b' + escapeRegExp_(nameTokens[0]) + '\\b', 'i');
        if (firstRe.test(raw)) score += 0.08;
      }
      var idNorm = normalizeForAssist_(p && p.id ? p.id : '');
      if (idNorm && normalizedDesc.indexOf(idNorm) >= 0) score += 0.26;
      var fellowNorm = normalizeForAssist_(p && p.fellowship ? p.fellowship : '');
      if (fellowNorm && normalizedDesc.indexOf(fellowNorm) >= 0) score += 0.16;
      if (score > 1) score = 1;
      return { person:p, score:score };
    }).sort(function(a,b){ return b.score - a.score; });
    var top = ranked[0] || null;
    var second = ranked[1] || null;
    var confidence = 'low';
    if (top && top.score >= 0.78 && (!second || (top.score - second.score) >= 0.12)) confidence = 'high';
    else if (top && top.score >= 0.5) confidence = 'medium';
    return {
      confidence: confidence,
      top: top,
      suggestions: ranked.filter(function(x){ return x.score >= 0.35; }).slice(0, 4),
      score: top ? top.score : 0
    };
  }
  function parseSmartAssist_(text, people){
    var rawText = String(text || '').trim();
    var normalized = normalizeForAssist_(rawText);
    var resultMatch = detectResultSmart_(normalized);
    var actionMatch = detectActionSmart_(normalized);
    var dateMatch = detectDateSmart_(rawText, normalized);
    var personMatch = matchPeople(rawText, people || []);
    var todos = extractTodosSmart_(rawText);
    var nextAction = actionMatch.value;
    if (!nextAction && dateMatch.date) nextAction = 'Follow-up';
    var personId = '';
    var personName = '';
    if (personMatch && personMatch.confidence === 'high' && personMatch.top && personMatch.top.person) {
      personId = personMatch.top.person.id;
      personName = personMatch.top.person.name || personMatch.top.person.id || '';
    }
    return {
      personName: personName || '',
      personId: personId || '',
      result: resultMatch.value || '',
      nextAction: nextAction || '',
      nextActionDateTime: dateMatch.date ? dtLocalValue(dateMatch.date) : '',
      summary: rawText,
      todos: todos,
      confidence: {
        person: Math.max(0, Math.min(1, personMatch.score || 0)),
        result: resultMatch.confidence || 0,
        nextAction: actionMatch.confidence || 0,
        date: dateMatch.confidence || 0
      },
      matchConfidence: personMatch.confidence || 'low',
      suggestions: personMatch.suggestions || []
    };
  }
  function inferAssistFromTextLocal(text){
    var parsed = parseSmartAssist_(text, (window.allPeople || []));
    return {
      nextAction: parsed.nextAction || 'None',
      nextActionDateTime: parsed.nextActionDateTime || '',
      todos: parsed.todos || []
    };
  }
  function buildSummary(text){
    return String(text || '').trim();
  }

  function ensureAiEditors(){
    var dateRow = byId('ai-conf-date-row');
    if (dateRow && !byId('ai-date-edit')) {
      dateRow.classList.add('ai-editable-card');
      dateRow.insertAdjacentHTML('beforeend', '' +
        '<div id="ai-date-edit" class="ai-inline-edit ai-date-edit open">' +
          '<div class="ai-mini-label">Follow-up date and time</div>' +
          '<div class="ai-date-grid">' +
            '<div class="ai-date-cell">' +
              '<label class="ai-mini-label ai-mini-label-inline" for="ai-date-input">Date</label>' +
              '<input type="date" id="ai-date-input">' +
            '</div>' +
            '<div class="ai-date-cell">' +
              '<label class="ai-mini-label ai-mini-label-inline" for="ai-time-input">Time (optional)</label>' +
              '<input type="time" id="ai-time-input" step="900">' +
            '</div>' +
          '</div>' +
          '<div class="ai-date-shortcuts">' +
            '<button class="ai-date-chip" type="button" data-action="ai-date-shortcut" data-shortcut="tomorrow">Tomorrow</button>' +
            '<button class="ai-date-chip" type="button" data-action="ai-date-shortcut" data-shortcut="friday">This Friday</button>' +
            '<button class="ai-date-chip" type="button" data-action="ai-date-shortcut" data-shortcut="nextweek">Next week</button>' +
            '<button class="ai-date-chip" type="button" data-action="ai-date-shortcut" data-shortcut="twoweeks">In 2 weeks</button>' +
            '<button class="ai-date-chip" type="button" data-action="ai-date-clear">Clear</button>' +
          '</div>' +
          '<div class="ai-helper-note" id="ai-date-helper">Choose a date/time or use a shortcut.</div>' +
        '</div>');
      var onDatePartChange = function(){
        if (!window._aiParsed) return;
        var dVal = byId('ai-date-input') ? byId('ai-date-input').value : '';
        var tVal = byId('ai-time-input') ? byId('ai-time-input').value : '';
        window._aiParsed.nextActionDateTime = buildDateTime_(dVal, tVal) || '';
        if (dVal && (!window._aiParsed.nextAction || window._aiParsed.nextAction === 'None')) window._aiParsed.nextAction = 'Follow-up';
        renderAiDate();
        saveAiDraft();
      };
      byId('ai-date-input').addEventListener('input', onDatePartChange);
      byId('ai-time-input').addEventListener('input', onDatePartChange);
    }
    var personWrap = byId('ai-person-override');
    if (personWrap && !byId('ai-conf-edit-person')) {
      var personHeader = byId('ai-conf-av') && byId('ai-conf-av').parentNode && byId('ai-conf-av').parentNode.parentNode;
      if (personHeader) {
        personHeader.classList.add('ai-editable-card');
        personHeader.id = 'ai-conf-edit-person';
        personHeader.insertAdjacentHTML('afterend', '<div id="ai-person-inline" class="ai-inline-edit"><div class="ai-mini-label">Change person</div><div style="position:relative;"><input id="ai-override-search" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-soft);font-family:inherit;font-size:14px;color:var(--text);outline:none;" placeholder="Search by name..." oninput="aiOverrideSearch()" autocomplete="off"><div id="ai-override-drop" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--surface);border:1px solid var(--accent);border-radius:var(--radius-sm);box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:160px;overflow-y:auto;z-index:100;"></div></div><div class="ai-person-picked" id="ai-person-picked-note"></div></div>');
        personHeader.addEventListener('click', function(e){ if (e.target.closest('#ai-person-inline')) return; byId('ai-person-inline').classList.toggle('open'); var inp=byId('ai-override-search'); if (inp) setTimeout(function(){ inp.focus(); }, 50); });
      }
      personWrap.style.display = 'none';
    }
  }

  function renderAiDate(){
    var row = byId('ai-conf-date-row'), out = byId('ai-conf-date'), dateInput = byId('ai-date-input'), timeInput = byId('ai-time-input'), edit = byId('ai-date-edit');
    if (!row || !out || !window._aiParsed) return;
    var a = window._aiParsed.nextAction || 'None';
    var hasAction = (a === 'Callback' || a === 'Follow-up');
    row.style.display = hasAction ? 'block' : 'none';
    if (edit) edit.classList.add('open');
    var parts = splitDateTimeParts_(window._aiParsed.nextActionDateTime || '');
    var d = parseLocalDate(window._aiParsed.nextActionDateTime);
    out.textContent = d ? formatResolvedDate(d) : 'No date selected';
    if (dateInput) dateInput.value = parts.date || '';
    if (timeInput) timeInput.value = parts.time || '';
    updateDateHelperState_();
  }

  window.aiApplyDateShortcut = function(type){
    if (!window._aiParsed) return;
    var d = type === 'tomorrow' ? tomorrowDate() : type === 'friday' ? thisFridayDate() : type === 'twoweeks' ? twoWeeksDate() : nextWeekDate();
    window._aiParsed.nextAction = window._aiParsed.nextAction === 'Callback' ? 'Callback' : 'Follow-up';
    window._aiParsed.nextActionDateTime = dtLocalValue(d);
    var dateInput = byId('ai-date-input');
    var timeInput = byId('ai-time-input');
    if (dateInput) dateInput.value = dateOnlyValue(d);
    if (timeInput) timeInput.value = timeOnlyValue(d);
    renderAiDate();
    saveAiDraft();
  };

  function updateDateHelperState_(){
    var helper = byId('ai-date-helper');
    var row = byId('ai-conf-date-row');
    var dateInput = byId('ai-date-input');
    var timeInput = byId('ai-time-input');
    if (!helper || !row) return;
    var hasAction = !!(window._aiParsed && (window._aiParsed.nextAction === 'Callback' || window._aiParsed.nextAction === 'Follow-up'));
    var hasDate = !!(dateInput && dateInput.value);
    var hasTime = !!(timeInput && timeInput.value);
    row.classList.remove('ai-date-required');
    if (!hasAction) {
      helper.textContent = 'Select a follow-up date';
      return;
    }
    if (!hasDate) {
      helper.textContent = 'Select a follow-up date';
      row.classList.add('ai-date-required');
      return;
    }
    if (hasDate && !hasTime) {
      helper.textContent = 'Time optional';
      return;
    }
    helper.textContent = 'Follow-up scheduled';
  }

  window.aiClearDate = function(){
    if (!window._aiParsed) return;
    window._aiParsed.nextActionDateTime = '';
    var dateInput = byId('ai-date-input');
    var timeInput = byId('ai-time-input');
    if (dateInput) dateInput.value = '';
    if (timeInput) timeInput.value = '';
    renderAiDate();
    if (dateInput) setTimeout(function(){ dateInput.focus(); }, 20);
    saveAiDraft();
  };

  window.aiOverrideSearch = function(){
    var q = normalize((byId('ai-override-search') && byId('ai-override-search').value) || '');
    var drop = byId('ai-override-drop');
    if (!drop) return;
    var people = (window._peopleCache && Array.isArray(window._peopleCache.data) && window._peopleCache.data.length)
      ? window._peopleCache.data
      : (window.allPeople || []);
    var list = people.filter(function(p){
      return !q || normalize(p.name).indexOf(q) >= 0 || normalize(p.id).indexOf(q) >= 0;
    }).slice(0,8);
    if (!list.length) { drop.style.display='block'; drop.innerHTML='<div class="no-results">No matches</div>'; return; }
    drop.style.display='block';
    drop.innerHTML = list.map(function(p){
      return '<button type="button" class="ai-suggestion-btn" data-action="ai-choose-person" data-pid="' + esc(String(p.id)) + '">' + esc(p.name || p.id) + '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + esc(p.id || '') + '</div></button>';
    }).join('');
  };

  window.aiChoosePerson = function(pid){
    var people = (window._peopleCache && Array.isArray(window._peopleCache.data) && window._peopleCache.data.length)
      ? window._peopleCache.data
      : (window.allPeople || []);
    var p = people.find(function(x){ return String(x.id) === String(pid); });
    if (!p || !window._aiParsed) return;
    window._aiParsed.personId = p.id;
    window._aiParsed.personName = p.name || p.id;
    window._aiParsed.matchConfidence = 'manual';
    if (byId('ai-conf-name')) byId('ai-conf-name').textContent = p.name || p.id;
    if (byId('ai-conf-av')) byId('ai-conf-av').textContent = initials(p.name || p.id);
    if (byId('ai-conf-match')) byId('ai-conf-match').textContent = 'Manual selection';
    if (byId('ai-person-picked-note')) byId('ai-person-picked-note').textContent = 'Selected: ' + (p.name || p.id);
    if (byId('ai-override-drop')) byId('ai-override-drop').style.display = 'none';
    saveAiDraft();
  };

  function renderAiSuggestions(parsed){
    var note = byId('ai-person-picked-note'); if (note) note.textContent = '';
    if (!parsed) return;
    if (byId('ai-conf-name')) byId('ai-conf-name').textContent = parsed.personName || 'Select a person';
    if (byId('ai-conf-av')) byId('ai-conf-av').textContent = initials(parsed.personName || '?');
    if (byId('ai-conf-match')) {
      byId('ai-conf-match').textContent = parsed.matchConfidence === 'high' ? 'High confidence match' : parsed.matchConfidence === 'medium' ? 'Possible match - please confirm' : parsed.matchConfidence === 'manual' ? 'Manual selection' : 'No confident match';
    }
    var inline = byId('ai-person-inline');
    var drop = byId('ai-override-drop');
    if (inline) {
      inline.classList.toggle('open', parsed.matchConfidence !== 'high');
      if (drop && parsed.suggestions && parsed.suggestions.length) {
        drop.style.display = 'block';
        drop.innerHTML = '<div class="ai-mini-label" style="padding:10px 10px 0;">Did you mean...?</div>' + parsed.suggestions.map(function(item){ return '<button type="button" class="ai-suggestion-btn" data-action="ai-choose-person" data-pid="' + esc(String(item.person.id)) + '">' + esc(item.person.name || item.person.id) + '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + Math.round(item.score*100) + '% match</div></button>'; }).join('');
      } else if (drop) {
        drop.style.display = 'none';
      }
    }
  }

  window.runAiParse = function(){
    var desc = (byId('ai-input') && byId('ai-input').value.trim()) || '';
    if (!desc) { var msg = byId('ai-input-msg'); if (msg) { msg.textContent='Please describe the call first.'; msg.className='msg error'; } return; }
    if (window.stopVoice) stopVoice();
    var btn = byId('ai-parse-btn'); if (btn) { btn.disabled = true; btn.textContent='Processing...'; }
    if (byId('ai-input-msg')) byId('ai-input-msg').className='msg';
    var peoplePromise = (window.allPeople && window.allPeople.length)
      ? Promise.resolve(window.allPeople)
      : (window.getPeople ? window.getPeople() : apiFetch('people'));
    peoplePromise.then(function(people){
      if (Array.isArray(people) && people.length) window.allPeople = people;
      var parsed = parseSmartAssist_(desc, people || []);
      window._aiParsed = {
        rawText: desc,
        personName: parsed.personName || '',
        personId: parsed.personId || null,
        result: parsed.result || '',
        nextAction: parsed.nextAction || '',
        nextActionDateTime: parsed.nextActionDateTime || '',
        summary: buildSummary(desc),
        todos: parsed.todos || [],
        confidence: parsed.confidence || {},
        matchConfidence: parsed.matchConfidence || 'low',
        suggestions: parsed.suggestions || []
      };
      ensureAiEditors();
      if (byId('ai-conf-summary-row')) byId('ai-conf-summary-row').style.display = 'block';
      if (byId('ai-conf-summary')) byId('ai-conf-summary').value = window._aiParsed.summary || '';
      document.querySelectorAll('#ai-result-chips .ai-rc').forEach(function(b){ b.className='ai-rc'; if (window._aiParsed.result && b.getAttribute('data-r') === window._aiParsed.result) aiPickResult(b); });
      document.querySelectorAll('#ai-action-chips .ai-rc').forEach(function(b){ b.className='ai-rc'; if (window._aiParsed.nextAction && b.getAttribute('data-a') === window._aiParsed.nextAction) b.className='ai-rc sel-action'; });
      renderAiSuggestions(window._aiParsed);
      renderAiDate();
      aiShowStep('confirm');
      if (byId('ai-input-msg')) {
        if (!window._aiParsed.result || (window._aiParsed.nextAction === 'Follow-up' && !window._aiParsed.nextActionDateTime)) {
          byId('ai-input-msg').textContent = 'Parsed with low confidence. Please review before saving.';
          byId('ai-input-msg').className = 'msg info';
        } else {
          byId('ai-input-msg').className = 'msg';
          byId('ai-input-msg').textContent = '';
        }
      }
      saveAiDraft();
      if (btn) { btn.disabled=false; btn.textContent='Quick Parse'; }
    }).catch(function(e){ if (btn) { btn.disabled=false; btn.textContent='Quick Parse'; } var msg = byId('ai-input-msg'); if (msg) { msg.textContent='Could not parse right now. ' + String(e); msg.className='msg error'; } });
  };

  var _origAiPickResult = window.aiPickResult;
  window.aiPickResult = function(btn){
    if (_origAiPickResult) _origAiPickResult(btn); else {
      var r = btn.getAttribute('data-r');
      if (window._aiParsed) window._aiParsed.result = r;
    }
    saveAiDraft();
  };

  window.aiPickAction = function(btn){
    var a = btn.getAttribute('data-a');
    if (window._aiParsed) {
      window._aiParsed.nextAction = a;
      if (a !== 'Callback' && a !== 'Follow-up') window._aiParsed.nextActionDateTime = '';
    }
    document.querySelectorAll('#ai-action-chips .ai-rc').forEach(function(b){ b.className='ai-rc'; });
    btn.className='ai-rc sel-action';
    renderAiDate();
    if (a === 'Callback' || a === 'Follow-up') {
      setTimeout(function(){
        var input = byId('ai-date-input');
        if (input) input.focus();
      }, 50);
    }
    saveAiDraft();
  };

  window.confirmAiLog = function(){
    if (_aiConfirmInFlight) return;
    if (!window._aiParsed) return;
    var p = window._aiParsed;
    if (!p.personId) {
      var msg = byId('ai-confirm-msg'); if (msg) { msg.textContent='Please choose the person before saving.'; msg.className='msg error'; } return;
    }
    var summaryText = byId('ai-conf-summary') ? byId('ai-conf-summary').value.trim() : (p.summary || '');
    var aiAssist = inferAssistFromTextLocal(summaryText);
    if ((!p.nextAction || p.nextAction === 'None') && aiAssist.nextAction !== 'None') p.nextAction = aiAssist.nextAction;
    if (!p.nextActionDateTime && aiAssist.nextActionDateTime && (p.nextAction === 'Callback' || p.nextAction === 'Follow-up')) {
      p.nextActionDateTime = aiAssist.nextActionDateTime;
    }
    if (p.nextAction === 'Callback' || p.nextAction === 'Follow-up') {
      var dateVal = byId('ai-date-input') ? byId('ai-date-input').value : '';
      var timeVal = byId('ai-time-input') ? byId('ai-time-input').value : '';
      var builtDt = buildDateTime_(dateVal, timeVal);
      if (builtDt) p.nextActionDateTime = builtDt;
    }
    if ((p.nextAction === 'Callback' || p.nextAction === 'Follow-up') && !p.nextActionDateTime) {
      var row = byId('ai-conf-date-row');
      if (row) row.classList.add('ai-date-required');
      updateDateHelperState_();
      var msg2 = byId('ai-confirm-msg'); if (msg2) { msg2.textContent='Please choose a follow-up date.'; msg2.className='msg error'; } return;
    }
    var payload = {
      personId: p.personId,
      fullName: p.personName,
      result: p.result,
      nextAction: p.nextAction || 'None',
      summary: summaryText,
      nextActionDateTime: p.nextActionDateTime || null
    };
    if (Array.isArray(aiAssist.todos) && aiAssist.todos.length) {
      payload._queuedTodos = aiAssist.todos.map(function(t){ return { text: t }; });
    }
    var btn = byId('ai-confirm-btn'); if (btn) { btn.disabled=true; btn.textContent='Saving...'; }
    _aiConfirmInFlight = true;
    var savePromise = (typeof saveInteractionWithOfflineFallback_ === 'function')
      ? saveInteractionWithOfflineFallback_(payload)
      : (!navigator.onLine
          ? (queueOfflineCall(payload), Promise.resolve({ success:true, offline:true }))
          : apiPost('saveInteraction', { payload: payload }));
    savePromise.then(function(res){
      _aiConfirmInFlight = false;
      if (res && res.success) {
        if (window.runPostSaveRefresh) runPostSaveRefresh().catch(function(e){ console.warn('[Flock]', e); });
        var aiTodos = aiAssist.todos || [];
        if (aiTodos.length && res.interactionId && !res.offline) {
          apiPost('saveTodos', { payload: {
            interactionId: res.interactionId,
            personId: payload.personId,
            personName: payload.fullName,
            todos: aiTodos.map(function(t){ return { text: t }; })
          } }).then(function(){ if (window.loadTodos && byId('pg-todos') && byId('pg-todos').classList.contains('active')) loadTodos(); }).catch(function(e){ console.warn('[Flock]', e); });
        }
        scheduleLocalReminder(payload);
        clearAiDraft();
        if (byId('ai-success-sub')) byId('ai-success-sub').textContent = (res.offline ? 'Saved offline - ' : 'Call with ') + payload.fullName + (res.offline ? ' will sync when reconnected.' : ' has been logged.') + (aiTodos.length ? ' ' + aiTodos.length + ' action item' + (aiTodos.length > 1 ? 's' : '') + ' added.' : '');
        aiShowStep('success');
      } else {
        if (btn) { btn.disabled=false; btn.textContent='Log this call'; }
        var msg = byId('ai-confirm-msg'); if (msg) { msg.textContent='Save failed. Check that the selected person exists and your Apps Script endpoint is responding.'; msg.className='msg error'; }
      }
    }).catch(function(e){
      _aiConfirmInFlight = false;
      if (btn) { btn.disabled=false; btn.textContent='Log this call'; }
      var msg = byId('ai-confirm-msg');
      if (msg) {
        var errText = (e && e.message) ? e.message : String(e);
        msg.textContent='Error: ' + errText;
        msg.className='msg error';
      }
    });
  };

  var _origOpenAiAssist = window.openAiAssist;
  window.openAiAssist = function(){
    if (_origOpenAiAssist) _origOpenAiAssist();
    _aiConfirmInFlight = false;
    var confirmBtn = byId('ai-confirm-btn');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Log this call'; }
    ensureAiEditors();
    var draft = getLS(AI_DRAFT_KEY, null);
    if (draft && byId('ai-input')) {
      byId('ai-input').value = draft.text || '';
      if (draft.parsed) {
        window._aiParsed = draft.parsed;
        if (byId('ai-conf-summary')) byId('ai-conf-summary').value = draft.parsed.summary || '';
      }
      if (byId('ai-input-msg') && (draft.text || (draft.parsed && draft.parsed.personId))) {
        byId('ai-input-msg').textContent = 'Draft restored.';
        byId('ai-input-msg').className = 'msg info';
      }
    }
  };

  var _origCloseAiAssist = window.closeAiAssist;
  window.closeAiAssist = function(){
    // If AI log was successfully saved, do not recreate a draft on close.
    var savedView = byId('ai-step-success') && byId('ai-step-success').style.display !== 'none';
    if (savedView) clearAiDraft();
    else saveAiDraft();
    if (_origCloseAiAssist) _origCloseAiAssist();
  };

  var _origInitLogPage = window.initLogPage;
  window.initLogPage = function(){ if (_origInitLogPage) _origInitLogPage(); restoreLogDraft(); };
  var _origResetLogForm = window.resetLogForm;
  window.resetLogForm = function(){ if (_origResetLogForm) _origResetLogForm(); clearLogDraft(); };
  var _origOpenBsheet = window.openBsheet;
  window.openBsheet = function(pid, name){ if (_origOpenBsheet) _origOpenBsheet(pid, name); restoreBsDraftIfMatch(pid); };
  var _origSaveBsheet = window.saveBsheet;
  window.saveBsheet = function(){
    var payload = { personId: window.bsPid, fullName: window.bsName, result: window.bsResult, nextAction: window.bsAction || 'None', summary: byId('bs-summary') ? byId('bs-summary').value.trim() : '', nextActionDateTime: byId('bs-next-dt') ? byId('bs-next-dt').value : '' };
    var before = JSON.stringify(payload);
    var origMsg = byId('bs-msg') ? byId('bs-msg').textContent : '';
    var p = _origSaveBsheet ? _origSaveBsheet() : null;
    setTimeout(function(){
      var msg = byId('bs-msg') ? byId('bs-msg').textContent : '';
      if (/saved/i.test(msg)) { clearBsDraft(); scheduleLocalReminder(payload); }
      else if (before) saveBsDraft();
    }, 100);
    return p;
  };
  var _origSaveCall = window.saveCall;
  window.saveCall = function(){
    var payload = { personId: byId('person-id') ? byId('person-id').value : '', fullName: byId('sel-name') ? byId('sel-name').textContent : '', result: window.selResult || '', nextAction: window.selAction || 'None', summary: byId('summary') ? byId('summary').value.trim() : '', nextActionDateTime: byId('next-dt') ? byId('next-dt').value : '' };
    var ret = _origSaveCall ? _origSaveCall() : null;
    setTimeout(function(){
      if (byId('success-screen') && byId('success-screen').classList.contains('on')) { clearLogDraft(); scheduleLocalReminder(payload); }
      else saveLogDraft();
    }, 120);
    return ret;
  };

  document.addEventListener('click', function(e){
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');
    if (action === 'save-your-name') { saveYourName(); return; }
    if (action === 'save-app-setting') { saveAppSetting(actionEl.getAttribute('data-key') || ''); return; }
    if (action === 'ai-date-shortcut') { aiApplyDateShortcut(actionEl.getAttribute('data-shortcut') || 'tomorrow'); return; }
    if (action === 'ai-date-clear') { aiClearDate(); return; }
    if (action === 'ai-choose-person') { aiChoosePerson(actionEl.getAttribute('data-pid') || ''); return; }
  });

  document.addEventListener('input', function(e){
    var id = e.target && e.target.id;
    if (id === 'ai-input' || id === 'ai-conf-summary' || id === 'ai-date-input') saveAiDraft();
    if (id === 'summary' || id === 'next-dt') saveLogDraft();
    if (id === 'bs-summary' || id === 'bs-next-dt') saveBsDraft();
  });
  document.addEventListener('change', function(e){
    var target = e.target;
    var id = target && target.id;
    if (id === 'next-dt' || id === 'summary') saveLogDraft();
    if (id === 'bs-next-dt' || id === 'bs-summary') saveBsDraft();
    var action = target && target.getAttribute ? target.getAttribute('data-action') : '';
    if (action === 'toggle-daily-summary') {
      toggleDailySummary(!!target.checked);
      return;
    }
  });

  var _origPickResult = window.pickResult;
  window.pickResult = function(btn){ var r=_origPickResult? _origPickResult(btn):null; saveLogDraft(); return r; };
  var _origPickAction = window.pickAction;
  window.pickAction = function(btn){ var r=_origPickAction? _origPickAction(btn):null; saveLogDraft(); return r; };
  var _origBsPick = window.bsPick;
  window.bsPick = function(btn, type){ var r=_origBsPick? _origBsPick(btn, type):null; saveBsDraft(); return r; };

  function notifyDueSummaryOnce(force){
    if (!isDailySummaryEnabled()) return;
    var mode = getDailySummaryMode() || 'system';
    var canSystem = supportsSystemNotifications() && Notification.permission === 'granted' && isiOSWebPushEligible().ok && mode !== 'inapp';
    var todayKey = new Date().toISOString().slice(0,10);
    if (!force && localStorage.getItem('ct-due-summary-notified') === todayKey) return;
    Promise.all([apiFetch('duePeople'), apiFetch('getTodos')]).then(function(res){
      var data = res[0] || {};
      var todosRes = res[1] || {};
      var duePeople = (data.today || []).length + (data.overdue || []).length + (data.callbacks || []).length;
      var dueTasks = 0;
      var todos = Array.isArray(todosRes.todos) ? todosRes.todos : [];
      if (todos.length) {
        todos.forEach(function(t){
          if (!t || t.done) return;
          var iso = String(t.dueDateIso || '').trim();
          if (iso === todayKey) dueTasks++;
        });
      }
      var total = duePeople + dueTasks;
      if (total > 0) {
        var bits = [];
        if (duePeople > 0) bits.push(duePeople + ' people due/overdue');
        if (dueTasks > 0) bits.push(dueTasks + ' tasks due today');
        var msg = 'Today: ' + bits.join(' • ') + '.';
        if (canSystem) notify('Call Tracker', msg, 'ct-daily-summary');
        else if (window.showUxToast) window.showUxToast(msg);
        localStorage.setItem('ct-due-summary-notified', todayKey);
      }
    }).catch(function(e){ console.warn('[Flock]', e); });
  }

  document.addEventListener('DOMContentLoaded', function(){
    enhanceSettings();
    ensureAiEditors();
    bootstrapReminderTimers();
    if (byId('ai-input')) byId('ai-input').addEventListener('input', saveAiDraft);
    if (localStorage.getItem('ct-dark') === null) { document.body.classList.remove('dark'); }
    updateDailySummaryUi();
    notifyDueSummaryOnce();
  });
})();


