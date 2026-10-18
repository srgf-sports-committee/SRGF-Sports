(() => {
  "use strict";
  const API_URL = "https://script.google.com/macros/s/AKfycbyLw0Yvg1xwH0JTStGa7buZ2k5AZ0OIigIursW0hOLTUWna3pwXAGga_Z80-5MEx6G5/exec";
  const RACKETLON_URL = "https://srgf-sports-committee.github.io/SRGF-Racketlon-2027/";
  const $ = (selector) => document.querySelector(selector);
  let allEvents = [];
  const GOOGLE_CLIENT_ID = "558722597292-0bod7pch3lnjb2j8421922rvtsdmjm1v.apps.googleusercontent.com";
  let currentCredential = "";
  let googleInitialized = false;

  function field(event, ...names) {
    for (const name of names) {
      const value = event && event[name];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
  }

  function safeUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.href);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch (_) { return ""; }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[c]);
  }

  function normalStatus(event) {
    return field(event, "Status", "status").toUpperCase();
  }

  function eventCard(event, archived) {
    const name = field(event, "Event Name", "eventName") || "SRGF Sports Event";
    const sport = field(event, "Sport", "sport") || "Community sports";
    const start = field(event, "Start Date", "Start date", "startDate");
    const end = field(event, "End Date", "End date", "endDate");
    const venue = field(event, "Venue", "venue");
    const website = safeUrl(field(event, "Website URL", "Website Url", "Website Link", "Event Website", "websiteUrl", "website"));
    // Accept common spreadsheet header variants: Register URL/Link, Registration URL/Link, etc.
    const registration = safeUrl(field(event,
      "Registration URL", "Registration Url", "Register URL", "Register Url",
      "Registration Link", "Register Link", "Registration Page", "Register Page",
      "Registration", "Register", "registrationUrl", "registerUrl", "registrationLink", "registerLink"
    ));
    // Accept singular/plural variants for the event result link.
    const results = safeUrl(field(event,
      "Results URL", "Results Url", "Result URL", "Result Url",
      "Results Link", "Result Link", "Results Page", "Result Page",
      "Results", "Result", "resultsUrl", "resultUrl", "resultsLink", "resultLink"
    ));
    const dates = start ? (end && end !== start ? start + " – " + end : start) : "Dates to be announced";
    const links = [];
    if (website) links.push('<a href="' + escapeHtml(website) + '" target="_blank" rel="noopener noreferrer">Event website ↗</a>');
    if (registration && !archived) links.push('<a href="' + escapeHtml(registration) + '" target="_blank" rel="noopener noreferrer">Register ↗</a>');
    if (results) links.push('<a href="' + escapeHtml(results) + '" target="_blank" rel="noopener noreferrer">Results ↗</a>');
    return '<article class="event-card"><div class="event-topline"><span class="event-sport">' + escapeHtml(sport) + '</span><span class="status-pill ' + (archived ? "archived" : "") + '">' + (archived ? "Completed" : "Upcoming") + '</span></div><h4>' + escapeHtml(name) + '</h4><div class="event-meta"><span>▦ ' + escapeHtml(dates) + '</span>' + (venue ? '<span>⌖ ' + escapeHtml(venue) + '</span>' : "") + '</div><div class="event-links">' + (links.join("") || '<span class="event-sport">Event links coming soon</span>') + '</div></article>';
  }

  function renderList(target, events, archived) {
    const container = $(target);
    if (!events.length) {
      container.innerHTML = '<div class="empty-state"><strong>' + (archived ? "No archived results yet" : "More events are on the way") + '</strong>' + (archived ? "Completed events and published results will appear here." : "Upcoming SRGF events will appear here when added to the directory.") + '</div>';
      return;
    }
    container.innerHTML = events.map(event => eventCard(event, archived)).join("");
  }

  function render() {
    const statusKey = event => normalStatus(event).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const archivedStatuses = new Set(["ARCHIVED", "COMPLETED", "CLOSED", "FINISHED", "RESULTS PUBLISHED"]);
    const upcomingStatuses = new Set(["UPCOMING", "UPCOMING SPORTS", "OPEN", "REGISTRATION OPEN", "COMING SOON", "ONGOING", "IN PROGRESS"]);
    const archived = allEvents.filter(event => archivedStatuses.has(statusKey(event)));
    // Keep the featured Racketlon event discoverable even if it is missing from the directory sheet/API response.
    const racketlonFallback = {
      "Event Name": "SRGF Racketlon 2027",
      "Sport": "Racketlon",
      "Status": "UPCOMING",
      "Website URL": RACKETLON_URL
    };
    const directoryHasRacketlon = allEvents.some(event => /racketlon/i.test(field(event, "Event Name", "eventName", "Name", "name")));
    // Count active directory events even when their status uses a variant label.
    const upcoming = allEvents.filter(event => {
      const status = statusKey(event);
      return upcomingStatuses.has(status) || (!archivedStatuses.has(status) && status !== "" && !["DRAFT", "HIDDEN", "CANCELLED", "CANCELED"].includes(status));
    });
    if (!directoryHasRacketlon) upcoming.unshift(racketlonFallback);
    // The Home layout uses home-* counters; the legacy standalone counters may not exist.
    const upcomingCount = $("#upcoming-count");
    const archivedCount = $("#archived-count");
    const homeUpcomingCount = $("#home-upcoming-count");
    const homeArchivedCount = $("#home-archived-count");
    if (upcomingCount) upcomingCount.textContent = upcoming.length;
    if (archivedCount) archivedCount.textContent = archived.length;
    if (homeUpcomingCount) homeUpcomingCount.textContent = upcoming.length;
    if (homeArchivedCount) homeArchivedCount.textContent = archived.length;
    renderList("#upcoming-list", upcoming, false);
    renderList("#archived-list", archived, true);
  }

  const EVENTS_CACHE_KEY = "srgfSportsEventsCacheV1";
  const EVENTS_REFRESH_MS = 60000;
  let eventsLastFetchAt = 0;
  let eventsRequestInFlight = null;
  let eventsHasLoadedSuccessfully = false;

  function restoreCachedEvents() {
    try {
      const cached = JSON.parse(localStorage.getItem(EVENTS_CACHE_KEY) || "null");
      if (!cached || !Array.isArray(cached.events)) return false;
      allEvents = cached.events;
      render();
      renderInsights();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function loadEvents(force = false) {
    const status = $("#directory-status");
    const now = Date.now();
    if (eventsRequestInFlight) return eventsRequestInFlight;
    // Reuse the most recent successful response on tab changes; explicit refresh bypasses this.
    if (!force && eventsHasLoadedSuccessfully && now - eventsLastFetchAt < EVENTS_REFRESH_MS) return;
    if (!eventsHasLoadedSuccessfully && !allEvents.length) restoreCachedEvents();
    if (status) status.textContent = allEvents.length ? "Checking for event updates…" : "Loading event directory…";

    eventsRequestInFlight = (async () => {
      try {
        const response = await fetch(API_URL + "?action=events", { method: "GET", cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        if (!data || data.ok !== true || !Array.isArray(data.events)) throw new Error(data && data.error || "Unexpected directory response.");
        allEvents = data.events;
        eventsLastFetchAt = Date.now();
        eventsHasLoadedSuccessfully = true;
        try {
          localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify({ savedAt: eventsLastFetchAt, events: allEvents }));
        } catch (_) { /* Storage may be disabled or full; live data still works. */ }
        render();
        renderInsights();
        if (status) status.textContent = "Event directory updated.";
      } catch (error) {
        // Keep the last successful in-memory or saved data visible when the network is unavailable.
        render();
        if (status) status.textContent = allEvents.length
          ? "Showing saved event data. Could not refresh; will retry automatically."
          : "The event directory could not be loaded. Please try again.";
        console.error("SRGF Sports directory error:", error);
      } finally {
        eventsRequestInFlight = null;
      }
    })();
    return eventsRequestInFlight;
  }

  function updatePageUrl(key, value) {
    const url = new URL(window.location.href);
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function activateTab(name, updateUrl = true) {
    document.querySelectorAll("[data-tab]").forEach(button => {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".tab-panel").forEach(panel => {
      panel.hidden = panel.id !== name + "-panel";
    });
    if (updateUrl) updatePageUrl("tab", name === "home" ? "" : name);
    // Refresh the data for the tab whenever the user opens it.
    if (name === "upcoming" || name === "archived") {
      loadEvents();
    } else if (name === "rankings") {
      loadRankings();
    } else if (name === "player-view") {
      loadRankings().then(loadPlayerViewHistory);
    } else if (name === "admin") {
      window.dispatchEvent(new CustomEvent("srgf-admin-tab-activated"));
    } else if (name === "home") {
      loadEvents();
      loadRankings();
    }
    // The selected tab is encoded in the URL so refresh restores it.
  }

  function saveRankingFilters() {
    try {
      sessionStorage.setItem("srgfSportsRankingFilters", JSON.stringify({
        player: $("#ranking-player-filter").value,
        format: $("#ranking-format-filter").value,
        gender: $("#ranking-gender-filter").value,
        ages: Array.from(document.querySelectorAll('input[name="ranking-age-band"]:checked')).map(el => el.value),
        insightsFormat: $("#insights-format-filter").value,
        insightsGender: $("#insights-gender-filter").value,
        insightsAges: Array.from(document.querySelectorAll('input[name="insights-age-band"]:checked')).map(el => el.value)
      }));
    } catch (_) {}
  }

  function restoreRankingFilters() {
    try {
      const saved = JSON.parse(sessionStorage.getItem("srgfSportsRankingFilters") || "null");
      if (!saved) return;
      if (saved.player != null) $("#ranking-player-filter").dataset.restorePlayer = saved.player;
      if (saved.format) $("#ranking-format-filter").value = saved.format;
      if (saved.gender) $("#ranking-gender-filter").value = saved.gender;
      if (saved.insightsFormat) $("#insights-format-filter").value = saved.insightsFormat;
      if (saved.insightsGender) $("#insights-gender-filter").value = saved.insightsGender;
      document.querySelectorAll('input[name="ranking-age-band"]').forEach(el => { el.checked = (saved.ages || []).includes(el.value); });
      document.querySelectorAll('input[name="insights-age-band"]').forEach(el => { el.checked = (saved.insightsAges || []).includes(el.value); });
      updateAgeSummary("ranking");
      updateAgeSummary("insights");
    } catch (_) {}
  }

  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => activateTab(button.dataset.tab)));
  document.querySelectorAll("[data-tab-target]").forEach(button => button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget);
    document.querySelector("#section-heading").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  restoreRankingFilters();
  const initialParams = new URLSearchParams(window.location.search);
  const allowedTabs = ["home", "upcoming", "archived", "rankings", "player-view"];
  const initialTab = initialParams.get("tab");
  if (allowedTabs.includes(initialTab || "")) activateTab(initialTab, false);
  $("#refresh-upcoming").addEventListener("click", () => loadEvents(true));
  $("#refresh-archived").addEventListener("click", () => loadEvents(true));


  // Admin sign-in stays on this page; it uses only the separate SRGF Sports backend.
  const adminModal = $("#admin-login-modal");
  const signInWrap = $("#google-signin-wrap");
  const authStatus = $("#auth-status");
  const confirmation = $("#admin-confirmation");
  const verifiedEmail = $("#verified-email");
  const headerAdminEmail = $("#header-admin-email");
  const headerAdminRole = $("#header-admin-role");
  const adminSessionIndicator = $("#admin-session-indicator");
  const openAdminButton = $("#open-admin-login");
  const ADMIN_SESSION_KEY = "srgfSportsAdminSessionV1";
  const ADMIN_IDLE_MS = 60 * 60 * 1000;
  let adminSessionEmail = "";
  let adminSessionRole = "ADMIN";
  let idleTimer = null;
  let restoringAdminSession = false;

  function readAdminSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || "null");
      if (!saved || !saved.credential || !saved.lastActivity || Date.now() - saved.lastActivity >= ADMIN_IDLE_MS) {
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
        return null;
      }
      return saved;
    } catch (_) { return null; }
  }

  function saveAdminSession() {
    if (!currentCredential) return;
    try { sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({credential: currentCredential, email: adminSessionEmail, role: adminSessionRole, lastActivity: Date.now()})); } catch (_) {}
  }

  function clearAdminSessionStorage() {
    try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch (_) {}
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = null;
  }

  function recordAdminActivity() {
    if (!currentCredential) return;
    saveAdminSession();
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      const saved = readAdminSession();
      if (saved && Date.now() - saved.lastActivity < ADMIN_IDLE_MS) { armAdminIdleTimer(); return; }
      signOutAdmin(true);
      setAuthStatus("You were signed out after one hour of inactivity. Please sign in again.", "info");
    }, ADMIN_IDLE_MS + 100);
  }

  function armAdminIdleTimer() {
    if (idleTimer) window.clearTimeout(idleTimer);
    const saved = readAdminSession();
    if (!saved) return;
    const remaining = ADMIN_IDLE_MS - (Date.now() - saved.lastActivity);
    if (remaining <= 0) { signOutAdmin(true); setAuthStatus("You were signed out after one hour of inactivity. Please sign in again.", "info"); return; }
    idleTimer = window.setTimeout(() => {
      const latest = readAdminSession();
      if (!latest) { signOutAdmin(true); setAuthStatus("You were signed out after one hour of inactivity. Please sign in again.", "info"); }
      else armAdminIdleTimer();
    }, remaining + 100);
  }

  ["click","keydown","pointerdown","touchstart","input","change"].forEach(type => {
    document.addEventListener(type, () => { if (currentCredential) recordAdminActivity(); }, { passive: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentCredential) recordAdminActivity();
  });

  function showSignedInAdmin(email, role) {
    headerAdminEmail.textContent = email || "Administrator";
    headerAdminRole.textContent = role || "ADMIN";
    adminSessionEmail = email || "";
    adminSessionRole = role || "ADMIN";
    adminSessionIndicator.hidden = false;
    openAdminButton.hidden = true;
    const adminTab = $("#tab-admin");
    if (adminTab) adminTab.hidden = false;
    window.dispatchEvent(new CustomEvent("srgf-admin-session", { detail: { authorized: true, idToken: currentCredential, email: email || "" } }));
  }

  function clearSignedInAdmin() {
    const adminTab = $("#tab-admin");
    if (adminTab) adminTab.hidden = true;
    if (document.querySelector("#admin-panel") && !document.querySelector("#admin-panel").hidden) activateTab("home");
    window.dispatchEvent(new CustomEvent("srgf-admin-session", { detail: { authorized: false } }));
    adminSessionIndicator.hidden = true;
    openAdminButton.hidden = false;
    headerAdminEmail.textContent = "";
    headerAdminRole.textContent = "ADMIN";
    adminSessionEmail = "";
    adminSessionRole = "ADMIN";
  }

  function setAuthStatus(message, state) {
    authStatus.textContent = message;
    authStatus.dataset.state = state || "info";
  }

  function closeAdminModal() {
    adminModal.hidden = true;
    document.body.classList.remove("admin-modal-open");
  }

  function openAdminModal() {
    adminModal.hidden = false;
    document.body.classList.add("admin-modal-open");
    if (!googleInitialized) initializeGoogleSignIn();
  }

  function initializeGoogleSignIn() {
    if (!window.google || !google.accounts || !google.accounts.id) {
      setAuthStatus("Loading Google sign-in…", "info");
      window.setTimeout(initializeGoogleSignIn, 250);
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    renderGoogleButton();
    googleInitialized = true;
  }

  function renderGoogleButton() {
    if (!(window.google && google.accounts && google.accounts.id)) return;
    const button = $("#google-signin-button");
    button.innerHTML = "";
    google.accounts.id.renderButton(button, {
      type: "standard", theme: "outline", size: "large",
      text: "signin_with", shape: "pill", logo_alignment: "left", width: 280
    });
  }

  async function handleGoogleCredential(response) {
    if (!response || !response.credential) {
      setAuthStatus("Google sign-in did not return a credential. Please try again.", "error");
      return;
    }
    currentCredential = response.credential;
    signInWrap.hidden = true;
    setAuthStatus("Verifying your administrator access…", "info");
    try {
      const result = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "adminauth", idToken: currentCredential })
      });
      if (!result.ok) throw new Error("HTTP " + result.status);
      const data = await result.json();
      if (!data || data.ok !== true || data.authorized !== true ||
          String(data.role || "").toUpperCase() !== "ADMIN") {
        currentCredential = "";
        signInWrap.hidden = false;
        renderGoogleButton();
        setAuthStatus((data && data.error) || "This Google account is not authorised for SRGF Sports administration.", "error");
        return;
      }
      const email = String(data.email || "");
      const role = String(data.role || "ADMIN").toUpperCase();
      verifiedEmail.textContent = email;
      confirmation.hidden = false;
      showSignedInAdmin(email, role);
      saveAdminSession();
      armAdminIdleTimer();
      renderRankings();
      setAuthStatus("Your account has been verified by the SRGF Sports backend.", "success");
      // Authentication is reflected in the homepage header; no separate page is opened.
      window.setTimeout(closeAdminModal, 700);
    } catch (error) {
      currentCredential = "";
      signInWrap.hidden = false;
      renderGoogleButton();
      setAuthStatus("Could not verify admin access. Please try again later.", "error");
      console.error("SRGF Sports admin authentication:", error);
    }
  }

  $("#open-admin-login").addEventListener("click", openAdminModal);
  document.querySelectorAll("[data-admin-close]").forEach(el => el.addEventListener("click", closeAdminModal));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !adminModal.hidden) closeAdminModal();
  });
  function signOutAdmin(fromIdleTimeout = false) {
    currentCredential = "";
    clearAdminSessionStorage();
    confirmation.hidden = true;
    signInWrap.hidden = false;
    clearSignedInAdmin();
    rankingEditMode = false;
    renderRankings();
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
      google.accounts.id.cancel();
      renderGoogleButton();
    }
    if (!fromIdleTimeout) setAuthStatus("You have signed out of the admin session.", "info");
  }
  $("#sign-out-button").addEventListener("click", signOutAdmin);
  $("#header-sign-out-button").addEventListener("click", signOutAdmin);

  async function restoreAdminSession() {
    if (restoringAdminSession) return;
    const saved = readAdminSession();
    if (!saved) return;
    restoringAdminSession = true;
    currentCredential = saved.credential;
    adminSessionEmail = saved.email || "";
    adminSessionRole = saved.role || "ADMIN";
    setAuthStatus("Restoring your administrator session…", "info");
    try {
      const result = await fetch(API_URL, {method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, body: JSON.stringify({action: "adminauth", idToken: currentCredential})});
      if (!result.ok) throw new Error("HTTP " + result.status);
      const data = await result.json();
      if (!data || data.ok !== true || data.authorized !== true || String(data.role || "").toUpperCase() !== "ADMIN") {
        currentCredential = ""; clearAdminSessionStorage(); clearSignedInAdmin();
        setAuthStatus("Your saved administrator sign-in has expired. Please sign in again.", "info");
        return;
      }
      const email = String(data.email || saved.email || "");
      const role = String(data.role || saved.role || "ADMIN").toUpperCase();
      showSignedInAdmin(email, role);
      try { sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({credential: currentCredential, email, role, lastActivity: saved.lastActivity})); } catch (_) {}
      armAdminIdleTimer();
      confirmation.hidden = false;
      verifiedEmail.textContent = email;
      renderRankings();
      setAuthStatus("Administrator session restored.", "success");
    } catch (error) {
      currentCredential = ""; clearAdminSessionStorage(); clearSignedInAdmin();
      setAuthStatus("Your administrator session could not be restored. Please sign in again.", "info");
      console.error("SRGF Sports session restore:", error);
    } finally { restoringAdminSession = false; }
  }
  restoreAdminSession();


  // Sports rankings are read from separate sport-named tabs in the SRGF Sports master sheet.
  let rankingSports = [];
  let playerProfiles = new Map();
  let activeRankingSheet = "";
  let rankingEditMode = false;

  // Player View is read-only and uses the SRGF Sports rating/history sheets.
  let playerViewHistory = [];
  let playerViewChart = null;
  let playerViewFiltersInitialized = false;
  const PLAYER_VIEW_COLORS = ["#176b87","#e36a42","#5b8c45","#8757b5","#d49a18","#c44e82","#2d9d91","#5666c2","#8b6745","#697582"];

  function playerViewPlayerList() {
    const byId = new Map();
    rankingSports.forEach(sport => rankingObjects(sport).forEach(row => {
      const id = String(row["Player ID"] || "").trim();
      const name = String(row["Player Name"] || "").trim();
      if (id && name && !byId.has(id)) byId.set(id, name);
    }));
    playerProfiles.forEach(profile => {
      const id = String(profile["Player ID"] || profile.id || "").trim();
      const name = String(profile["Player Name"] || profile.name || "").trim();
      if (id && name && !byId.has(id)) byId.set(id, name);
    });
    return Array.from(byId.entries()).sort((a,b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  }

  function populatePlayerViewFilters() {
    const primary = $("#player-view-primary");
    const compare = $("#player-view-compare");
    if (!primary || !compare) return;
    const previousPrimary = primary.value;
    // Browsers may restore multi-select values after a reload. Start each page
    // load with no comparison players; preserve choices only during later filter updates.
    const previousCompare = playerViewFiltersInitialized
      ? Array.from(compare.selectedOptions).map(option => option.value)
      : [];
    const players = playerViewPlayerList();
    primary.innerHTML = '<option value="">Select a player</option>' + players.map(([id,name]) =>
      '<option value="' + escapeHtml(id) + '">' + escapeHtml(name) + '</option>'
    ).join("");
    // On the first page load, select the first player in the list automatically.
    // On later refreshes, preserve the user's current selection when it still exists.
    primary.value = players.some(([id]) => id === previousPrimary)
      ? previousPrimary
      : (!playerViewFiltersInitialized && players.length ? players[0][0] : "");
    const excludedId = primary.value;
    compare.innerHTML = players.filter(([id]) => id !== excludedId).map(([id,name]) =>
      '<option value="' + escapeHtml(id) + '">' + escapeHtml(name + " (" + id + ")") + '</option>'
    ).join("");
    previousCompare.filter(id => id !== excludedId).forEach(id => {
      const option = Array.from(compare.options).find(item => item.value === id);
      if (option) option.selected = true;
    });
    playerViewFiltersInitialized = true;
  }

  function renderPlayerViewRatings() {
    const primary = $("#player-view-primary");
    const title = $("#player-view-rating-title");
    const container = $("#player-view-rating-tiles");
    if (!primary || !title || !container) return;
    const id = primary.value;
    const selected = playerViewPlayerList().find(item => item[0] === id);
    if (!selected) {
      title.textContent = "Select a player to see ratings";
      container.innerHTML = '<div class="insight-empty">Choose a player from the filter above. Each tile shows both Singles and Doubles current Elo.</div>';
      return;
    }
    title.textContent = selected[1] + " · Current ratings";
    const tiles = rankingSports.map((sport,index) => {
      const row = rankingObjects(sport).find(item => String(item["Player ID"] || "").trim() === id);
      const singles = row && row["Singles Elo"] !== "" ? row["Singles Elo"] : "—";
      const doubles = row && row["Doubles Elo"] !== "" ? row["Doubles Elo"] : "—";
      const name = sport.name || String(sport.sheetName || "").replace(/-Rating$/i,"");
      const code = String(sport.code || sport.sheetName || "").replace(/-Rating$/i,"").toUpperCase();
      const icons = {TT:"🏓",PB:"🥒",BAD:"🏸",LT:"🎾"};
      return '<article class="player-rating-tile player-rating-tone-' + (index%4+1) + '"><div class="player-rating-tile-head"><span>' + (icons[code] || "🏅") + '</span><div><small>' + escapeHtml(code) + '</small><strong>' + escapeHtml(name) + '</strong></div></div><div class="player-rating-values"><div><small>SINGLES</small><strong>' + escapeHtml(singles) + '</strong></div><div><small>DOUBLES</small><strong>' + escapeHtml(doubles) + '</strong></div></div></article>';
    });
    container.innerHTML = tiles.length ? tiles.join("") : '<div class="insight-empty">Sport rating sheets are not available yet.</div>';
  }

  function renderPlayerViewChart() {
    const canvas = $("#player-view-chart");
    const status = $("#player-view-chart-status");
    const note = $("#player-view-legend-note");
    if (!canvas || !status) return;
    if (playerViewChart) { playerViewChart.destroy(); playerViewChart = null; }
    const primaryId = $("#player-view-primary").value;
    const showComparisons = $("#player-view-show-comparisons")?.checked === true;
    const compareIds = showComparisons ? Array.from($("#player-view-compare").selectedOptions).map(option => option.value) : [];
    const playerIds = [primaryId].concat(compareIds).filter(Boolean);
    const format = $("#player-view-format").value;
    const sport = showComparisons ? $("#player-view-sport").value : "ALL";
    if (!primaryId) {
      status.textContent = "Select a primary player to display rating history.";
      if (note) note.textContent = "";
      return;
    }

    const players = new Map(playerViewPlayerList());
    const allCodes = ["TT","PB","BAD","LT"];
    const codes = sport === "ALL" ? allCodes : [sport];
    const months = [];
    const now = new Date();
    for (let year=2026, month=0; year<now.getFullYear() || (year===now.getFullYear() && month<=now.getMonth()); ) {
      months.push(year + "-" + String(month+1).padStart(2,"0"));
      month++;
      if (month===12) { month=0; year++; }
    }
    if (!months.length) {
      status.textContent = "Monthly rating history starts in January 2026.";
      return;
    }

    const rowDate = row => String(row["Match Date"] || "").slice(0,10);
    const selectedRows = playerViewHistory.filter(row =>
      playerIds.includes(String(row["Player ID"] || "").trim()) &&
      String(row.Format || "").toLowerCase() === format.toLowerCase() &&
      codes.includes(String(row["Sport Code"] || "").toUpperCase()) &&
      Number.isFinite(Number(row["Elo After"])) &&
      String(row["Match Date"] || "").trim()
    );
    const seriesList = [];

    playerIds.forEach(id => {
      const sportMonthly = {};
      codes.forEach(code => {
        const rows = selectedRows.filter(row =>
          String(row["Player ID"] || "").trim() === id &&
          String(row["Sport Code"] || "").toUpperCase() === code
        ).sort((a,b) => rowDate(a).localeCompare(rowDate(b)) ||
          String(a["Recorded At"] || "").localeCompare(String(b["Recorded At"] || "")));
        let carryRating = 1000;
        rows.filter(row => rowDate(row) < "2026-01-01").forEach(row => {
          carryRating = Number(row["Elo After"]);
        });
        const from2026 = rows.filter(row => rowDate(row) >= "2026-01-01");
        sportMonthly[code] = months.map(monthKey => {
          const inMonth = from2026.filter(row => rowDate(row).slice(0,7) === monthKey);
          if (inMonth.length) carryRating = Number(inMonth[inMonth.length-1]["Elo After"]);
          return carryRating;
        });
      });

      if (!showComparisons) {
        // Default profile: four individual sport lines plus a dotted All Sports average.
        allCodes.forEach(code => {
          seriesList.push({
            id,code,name:players.get(id)||id,
            sport:({TT:"Table Tennis",PB:"Pickleball",BAD:"Badminton",LT:"Lawn Tennis"})[code],
            values:sportMonthly[code],
            isAllSports:false
          });
        });
        const average = months.map((_, monthIndex) => {
          const values = allCodes.map(code => sportMonthly[code][monthIndex]).filter(Number.isFinite);
          return values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
        });
        seriesList.push({id,code:"ALL",name:players.get(id)||id,sport:"All Sports average",values:average,isAllSports:true});
      } else if (sport === "ALL") {
        const average = months.map((_, monthIndex) => {
          const values = allCodes.map(code => sportMonthly[code][monthIndex]).filter(Number.isFinite);
          return values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
        });
        seriesList.push({id,code:"ALL",name:players.get(id)||id,sport:"All Sports average",values:average,isAllSports:true});
      } else {
        seriesList.push({
          id,code:sport,name:players.get(id)||id,
          sport:String((selectedRows.find(row=>String(row["Player ID"]||"").trim()===id && String(row["Sport Code"]||"").toUpperCase()===sport)||{}).Sport ||
            ({TT:"Table Tennis",PB:"Pickleball",BAD:"Badminton",LT:"Lawn Tennis"})[sport] || sport),
          values:sportMonthly[sport],
          isAllSports:false
        });
      }
    });

    const labels = months.map(key => {
      const [year,month]=key.split("-").map(Number);
      return new Date(year,month-1,1).toLocaleDateString(undefined,{month:"short",year:"numeric"});
    });
    const datasets = seriesList.map((series,index) => {
      const playerIndex = Math.max(0,playerIds.indexOf(series.id));
      const sportIndex = series.code === "ALL" ? 0 : Math.max(0,allCodes.indexOf(series.code));
      const color = PLAYER_VIEW_COLORS[(playerIndex*4+sportIndex)%PLAYER_VIEW_COLORS.length];
      return {
        label: series.name+" · "+(series.isAllSports ? "All Sports average" : series.sport),
        data:series.values,
        borderColor:color,backgroundColor:color,borderWidth:series.isAllSports?3:(series.id===primaryId?2:2),
        borderDash:series.isAllSports?[5,5]:(series.id===primaryId?[]:[6,4]),pointRadius:series.isAllSports?0:2,pointHoverRadius:5,
        tension:.22,spanGaps:true
      };
    });
    if (typeof Chart === "undefined") {
      status.textContent = "The chart library could not be loaded. Please refresh the page.";
      return;
    }
    playerViewChart = new Chart(canvas,{
      type:"line",data:{labels,datasets},
      options:{
        responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},
        plugins:{
          legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:8,padding:16}},
          tooltip:{callbacks:{label:context=>context.dataset.label+": "+(context.parsed.y==null?"—":context.parsed.y.toFixed(2)+" Elo")}}
        },
        scales:{
          x:{title:{display:true,text:"Month"},ticks:{maxRotation:0,minRotation:0,autoSkip:false}},
          y:{title:{display:true,text:!showComparisons || sport==="ALL"?"Monthly Elo rating":"Monthly Elo rating"},beginAtZero:false}
        }
      }
    });
    status.textContent="Showing monthly ratings from Jan 2026 to "+labels[labels.length-1]+". Missing months carry forward the previous rating.";
    if(note) note.textContent=!showComparisons
      ?"Full profile: four solid lines show Table Tennis, Pickleball, Badminton and Lawn Tennis; the dotted line shows the average across all four sports for "+format+". Each sport carries its last rating forward when there is no match that month."
      :sport==="ALL"
        ?"All Sports shows the average of Table Tennis, Pickleball, Badminton and Lawn Tennis for "+format+". Each sport carries its last rating forward when there is no match that month."
        :"Showing "+format+" monthly rating history for "+($("#player-view-sport option:checked")?.textContent||sport)+".";
  }

  function exportPlayerViewHistory() {
    const primaryId=$("#player-view-primary").value;
    if(!primaryId) { alert("Please select a primary player first."); return; }
    if(typeof XLSX==="undefined") { alert("The Excel export library could not be loaded. Please refresh and try again."); return; }
    const selectedIds=[primaryId].concat(Array.from($("#player-view-compare").selectedOptions).map(option=>option.value));
    const players=new Map(playerViewPlayerList());
    const sportNames={TT:"Table Tennis",PB:"Pickleball",BAD:"Badminton",LT:"Lawn Tennis"};
    const sportCodes=["TT","PB","BAD","LT"];
    const exportHeaders=["Match Date","Player Name","Player ID","Format","Match ID","Opponent(s)","Result","Elo Before","Elo Change","Elo After","Rank Before","Rank After","Recorded At"];
    const workbook=XLSX.utils.book_new();
    sportCodes.forEach(code=>{
      ["Singles","Doubles"].forEach(format=>{
        const rows=playerViewHistory.filter(row=>
          selectedIds.includes(String(row["Player ID"]||"").trim()) &&
          String(row["Sport Code"]||"").toUpperCase()===code &&
          String(row.Format||"").toLowerCase()===format.toLowerCase() &&
          String(row["Match Date"]||"").trim()
        ).sort((a,b)=>String(a["Match Date"]).localeCompare(String(b["Match Date"])) ||
          String(a["Recorded At"]||"").localeCompare(String(b["Recorded At"]||"")) ||
          String(a["Player Name"]||"").localeCompare(String(b["Player Name"]||"")));
        const data=[exportHeaders].concat(rows.map(row=>[
          String(row["Match Date"]||"").slice(0,10),
          players.get(String(row["Player ID"]||"").trim())||row["Player Name"]||"",
          String(row["Player ID"]||""),
          String(row.Format||format),
          String(row["Match ID"]||""),
          String(row["Opponent(s)"]||""),
          String(row.Result||""),
          row["Elo Before"]===""?"":Number(row["Elo Before"]),
          row["Elo Change"]===""?"":Number(row["Elo Change"]),
          row["Elo After"]===""?"":Number(row["Elo After"]),
          row["Rank Before"]===""?"":Number(row["Rank Before"]),
          row["Rank After"]===""?"":Number(row["Rank After"]),
          String(row["Recorded At"]||"")
        ]));
        const sheet=XLSX.utils.aoa_to_sheet(data);
        sheet["!cols"]=[{wch:13},{wch:24},{wch:20},{wch:11},{wch:20},{wch:28},{wch:12},{wch:13},{wch:13},{wch:13},{wch:12},{wch:12},{wch:24}];
        const sheetName=({TT:"TT",PB:"Pickleball",BAD:"Badminton",LT:"Lawn Tennis"})[code]+" "+format;
        XLSX.utils.book_append_sheet(workbook,sheet,sheetName.slice(0,31));
      });
    });
    const stamp=new Date().toISOString().slice(0,10);
    XLSX.writeFile(workbook,"SRGF_Player_Rating_History_"+stamp+".xlsx");
  }
  async function loadPlayerViewHistory() {
    const status = $("#player-view-chart-status");
    if (status) status.textContent = "Loading rating history…";
    try {
      const response = await fetch(API_URL + "?action=ratinghistory", {method:"GET",cache:"no-store"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (!data || data.ok !== true || !Array.isArray(data.history)) throw new Error(data && data.error || "Unexpected rating history response.");
      playerViewHistory = data.history;
      populatePlayerViewFilters();
      renderPlayerViewRatings();
      renderPlayerViewChart();
    } catch (error) {
      if (status) status.textContent = "Rating history could not be loaded. Confirm the SRGF Sports Apps Script has the ratinghistory read endpoint deployed.";
      console.error("SRGF Sports player view history:", error);
    }
  }

  function refreshPlayerView() {
    loadRankings().then(loadPlayerViewHistory);
  }

  $("#player-view-primary").addEventListener("change", () => {
    populatePlayerViewFilters();
    renderPlayerViewRatings();
    renderPlayerViewChart();
  });
  const playerViewShowComparisons = $("#player-view-show-comparisons");
  const playerViewSportFilter = $("#player-view-sport");
  const playerViewCompareFilter = $("#player-view-compare");
  function syncPlayerViewComparisonControls() {
    const enabled = playerViewShowComparisons.checked;
    playerViewSportFilter.disabled = !enabled;
    playerViewCompareFilter.disabled = !enabled;
    $("#player-view-clear-compare").disabled = !enabled;
    playerViewSportFilter.value = "ALL";
    if (!enabled) Array.from(playerViewCompareFilter.options).forEach(option => { option.selected = false; });
    renderPlayerViewChart();
  }
  playerViewShowComparisons.addEventListener("change", syncPlayerViewComparisonControls);
  playerViewShowComparisons.checked = false;
  syncPlayerViewComparisonControls();
  $("#player-view-format").addEventListener("change", renderPlayerViewChart);
  $("#player-view-sport").addEventListener("change", renderPlayerViewChart);
  $("#player-view-compare").addEventListener("change", renderPlayerViewChart);
  $("#player-view-clear-compare").addEventListener("click", () => {
    Array.from($("#player-view-compare").options).forEach(option => { option.selected = false; });
    renderPlayerViewChart();
  });
  $("#refresh-player-view").addEventListener("click", refreshPlayerView);
  $("#player-view-export").addEventListener("click", exportPlayerViewHistory);

  function playerAge(profile) {
    if (!profile) return null;
    const rawAge = profile.Age ?? profile.age;
    if (rawAge !== undefined && rawAge !== null && String(rawAge).trim() !== "" && Number.isFinite(Number(rawAge))) return Math.max(0, Math.floor(Number(rawAge)));
    const rawDob = String(profile["Date of Birth"] || profile.DOB || profile["Birth Date"] || profile.Birthdate || "").trim();
    if (!rawDob) return null;
    let dob = null, match = rawDob.match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/);
    if (match) dob = new Date(Number(match[1]), Number(match[2])-1, Number(match[3]));
    if (!dob) {
      match = rawDob.match(/^([0-9]{1,2})[/. -]([0-9]{1,2})[/. -]([0-9]{4})$/);
      if (match) dob = new Date(Number(match[3]), Number(match[2])-1, Number(match[1]));
    }
    if (!dob) dob = new Date(rawDob);
    if (Number.isNaN(dob.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) age--;
    return age >= 0 && age < 130 ? age : null;
  }

  const AGE_BANDS = [
    {value:"under12",label:"Below 12",test:age=>age<12},
    {value:"12to18",label:"12 to 17",test:age=>age>=12&&age<18},
    {value:"18to45",label:"18 to 44",test:age=>age>=18&&age<45},
    {value:"45to60",label:"45 to 59",test:age=>age>=45&&age<60},
    {value:"60plus",label:"60+",test:age=>age>=60}
  ];

  function selectedAgeBands(prefix) {
    return Array.from(document.querySelectorAll('input[name="' + prefix + '-age-band"]:checked')).map(input=>input.value);
  }

  function updateAgeSummary(prefix) {
    const summary = $("#" + prefix + "-age-summary");
    if (!summary) return;
    const selected = selectedAgeBands(prefix);
    const selectAll = document.querySelector('[data-age-select-all="' + prefix + '"]');
    if (selectAll) selectAll.checked = selected.length === AGE_BANDS.length;
    summary.textContent = selected.length === AGE_BANDS.length || selected.length === 0
      ? "All age groups"
      : AGE_BANDS.filter(b=>selected.includes(b.value)).map(b=>b.label).join(", ");
  }

  function playerMatchesCategory(playerId, genderFilter, ageBands) {
    const gender = String(genderFilter || "All").toLowerCase();
    const bands = Array.isArray(ageBands) ? ageBands : [];
    if (gender === "all" && !bands.length) return true;
    const profile = playerProfiles.get(String(playerId || "").trim().toUpperCase());
    if (!profile) return false;
    if (gender !== "all") {
      const playerGender = String(profile.Gender || profile.gender || profile.Sex || "").trim().toLowerCase();
      const isMale = ["male","man","m"].includes(playerGender);
      const isFemale = ["female","woman","women","f"].includes(playerGender);
      if (gender === "male" && !isMale) return false;
      if (gender === "female" && !isFemale) return false;
    }
    if (!bands.length) return true;
    const age = playerAge(profile);
    if (age === null) return false;
    return AGE_BANDS.some(b=>bands.includes(b.value) && b.test(age));
  }

  function selectedCategoryLabel(genderFilter, ageBands) {
    const gender = !genderFilter || genderFilter === "All" ? "" : genderFilter;
    const ages = AGE_BANDS.filter(b=>(ageBands||[]).includes(b.value)).map(b=>b.label);
    return [gender,...ages].filter(Boolean).join(" + ") || "All";
  }

  function selectedRankingSport() {
    if (activeRankingSheet === "__ALL__") return null;
    return rankingSports.find(s => String(s.sheetName || s.name) === activeRankingSheet) || rankingSports[0] || null;
  }

  function renderRankingPicker() {
    const picker = $("#ranking-sport-picker");
    picker.innerHTML = "";
    const choices = [{name:"All Sports",sheetName:"__ALL__"}, ...rankingSports, {name:"Summary",sheetName:"__SUMMARY__"}];
    choices.forEach(sport => {
      const sheet = String(sport.sheetName || sport.name || "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ranking-sport-chip" + (sheet === activeRankingSheet ? " active" : "");
      button.textContent = String(sport.name || sheet);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(sheet === activeRankingSheet));
      button.addEventListener("click", () => {
        activeRankingSheet = sheet;
        rankingEditMode = false;
        const code = sheet === "__ALL__" ? "ALL" : sheet === "__SUMMARY__" ? "SUMMARY" : (sport.code || sheet.replace(/-Rating$/i, ""));
        updatePageUrl("sport", code);
        updatePageUrl("tab", "rankings");
        saveRankingFilters();
        renderRankings();
      });
      picker.appendChild(button);
    });
  }

  function rankingSheetForSport(sport) {
    return rankingSports.find(s => String(s.code || "").toUpperCase() === String(sport || "").toUpperCase()) ||
      rankingSports.find(s => String(s.sheetName || "").replace(/-Rating$/i,"").toUpperCase() === String(sport || "").toUpperCase()) || null;
  }

  function rankingObjects(sport) {
    const headers = Array.isArray(sport.headers) ? sport.headers : [];
    return (sport.rows || []).map(row => {
      const item = {};
      headers.forEach((h, i) => item[h] = Array.isArray(row) ? (row[i] ?? "") : "");
      return item;
    });
  }

  function populateRankingPlayerFilter() {
    const select = $("#ranking-player-filter");
    if (!select) return;
    const previous = select.value;
    const byId = new Map();
    rankingSports.forEach(sport => rankingObjects(sport).forEach(row => {
      const id = String(row["Player ID"] || "").trim();
      const name = String(row["Player Name"] || "").trim();
      if (id && name && !byId.has(id)) byId.set(id, name);
    }));
    select.innerHTML = '<option value="">All players</option>' +
      Array.from(byId.entries()).sort((a,b) => a[1].localeCompare(b[1])).map(([id,name]) =>
        '<option value="' + escapeHtml(id) + '">' + escapeHtml(name + " (" + id + ")") + '</option>'
      ).join("");
    const restorePlayer = select.dataset.restorePlayer || "";
    if (byId.has(previous)) select.value = previous;
    else if (byId.has(restorePlayer)) select.value = restorePlayer;
    delete select.dataset.restorePlayer;
  }

  function renderAllSportsRankings() {
    const content = $("#ranking-content");
    const selectedPlayer = $("#ranking-player-filter").value;
    const format = $("#ranking-format-filter").value;
    const eloKey = format + " Elo";
    const matchesKey = format + " Matches";
    const winsKey = format + " Wins";
    const lossesKey = format + " Losses";
    const drawsKey = format + " Draws";
    const gender = $("#ranking-gender-filter")?.value || "All";
    const ageBands = selectedAgeBands("ranking");
    const isAllSports = activeRankingSheet === "__ALL__";
    const selectedSport = isAllSports ? null :
      rankingSports.find(s => String(s.sheetName || s.name) === activeRankingSheet);
    const sources = selectedSport ? [selectedSport] : rankingSports;
    const rows = [];

    sources.forEach(sport => rankingObjects(sport).forEach(row => {
      const id = String(row["Player ID"] || "").trim();
      if (!id || (selectedPlayer && id !== selectedPlayer)) return;
      if (!playerMatchesCategory(id, gender, ageBands)) return;
      const profile = playerProfiles.get(id.toUpperCase()) || {};
      const age = playerAge(profile);
      const rating = Number(row[eloKey]);
      rows.push({
        sport: sport.name || String(sport.sheetName || "").replace(/-Rating$/i, ""),
        id,
        name: String(row["Player Name"] || ""),
        gender: String(profile.Gender || profile.gender || profile.Sex || "").trim() || "—",
        age: age === null ? "—" : age,
        elo: Number.isFinite(rating) ? rating : 1000,
        matches: Number(row[matchesKey] || 0),
        wins: Number(row[winsKey] || 0),
        losses: Number(row[lossesKey] || 0),
        draws: Number(row[drawsKey] || 0)
      });
    }));

    const isSummary = activeRankingSheet === "__SUMMARY__";
    let displayRows;
    if (isAllSports) {
      // One combined row per player, ranked by average Elo across sports
      // in which the player has a rating row.
      const byPlayer = new Map();
      rows.forEach(row => {
        if (!byPlayer.has(row.id)) {
          byPlayer.set(row.id, {
            id: row.id, name: row.name, gender: row.gender, age: row.age,
            ratingTotal: 0, sportsPlayed: 0, matches: 0, wins: 0, losses: 0, draws: 0, sportDetails: []
          });
        }
        const player = byPlayer.get(row.id);
        player.name = player.name || row.name;
        player.gender = player.gender === "—" ? row.gender : player.gender;
        player.age = player.age === "—" ? row.age : player.age;
        player.ratingTotal += row.elo;
        player.sportsPlayed += 1;
        player.sportDetails.push(row);
        player.matches += row.matches;
        player.wins += row.wins;
        player.losses += row.losses;
        player.draws += row.draws;
      });
      displayRows = Array.from(byPlayer.values()).map(player => ({
        ...player,
        averageElo: player.sportsPlayed ? player.ratingTotal / player.sportsPlayed : 0
      })).sort((a, b) => b.averageElo - a.averageElo || b.sportsPlayed - a.sportsPlayed || a.name.localeCompare(b.name));
    } else if (isSummary) {
      // Show a separate row for every player/sport combination, with ranks
      // calculated independently inside each sport.
      displayRows = rows.sort((a, b) => a.sport.localeCompare(b.sport) || b.elo - a.elo || a.name.localeCompare(b.name));
      let currentSport = "";
      let sportRank = 0;
      displayRows = displayRows.map(row => {
        if (row.sport !== currentSport) { currentSport = row.sport; sportRank = 0; }
        return {...row, rank: ++sportRank};
      });
    } else {
      displayRows = rows.sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
    }

    if (!displayRows.length) {
      content.innerHTML = '<div class="empty-state"><strong>No matching rankings yet</strong>' +
        (selectedPlayer ? 'This player has no rating row for the selected sport and format.' : 'Registered players will appear here once the sports rating tabs are populated.') +
        '</div>';
      return;
    }

    const tableRows = displayRows.map((row, index) => {
      const rank = isSummary ? row.rank : index + 1;
      if (isAllSports) {
        const detailsId = "ranking-sport-tree-" + String(row.id).replace(/[^a-zA-Z0-9_-]/g, "_");
        const sportRows = row.sportDetails.slice().sort((a, b) => a.sport.localeCompare(b.sport)).map(detail =>
          '<div class="ranking-tree-child"><span class="ranking-tree-branch" aria-hidden="true">└</span><span class="ranking-tree-sport">' +
          escapeHtml(detail.sport) + '</span><strong>' + escapeHtml(String(detail.elo)) + ' Elo</strong>' +
          '<span class="ranking-tree-record">' + detail.matches + ' matches · ' + detail.wins + 'W / ' + detail.losses + 'L / ' + detail.draws + 'D</span></div>'
        ).join("");
        return '<tr class="ranking-tree-parent"><td>' + rank + '</td><td>' + escapeHtml(row.id) + '</td><td><button type="button" class="ranking-tree-toggle" aria-expanded="false" aria-controls="' + detailsId + '" data-tree-target="' + detailsId + '"><span aria-hidden="true">▸</span><strong>' +
          escapeHtml(row.name) + '</strong></button></td><td>All Sports</td><td>' + escapeHtml(row.gender) + '</td><td>' +
          escapeHtml(row.age) + '</td><td>' + row.sportsPlayed + '</td><td><strong>' +
          escapeHtml(row.averageElo.toFixed(1)) + '</strong></td><td>' + row.matches + '</td><td>' +
          row.wins + '</td><td>' + row.losses + '</td><td>' + row.draws + '</td></tr>' +
          '<tr class="ranking-tree-details-row" hidden><td colspan="12"><div id="' + detailsId + '" class="ranking-tree-details"><div class="ranking-tree-heading">Individual sport ratings</div>' +
          (sportRows || '<div class="ranking-tree-child">No individual sport ratings available.</div>') + '</div></td></tr>';
      }
      return '<tr><td>' + rank + '</td><td>' + escapeHtml(row.id) + '</td><td><strong>' +
        escapeHtml(row.name) + '</strong></td><td>' + escapeHtml(row.sport) + '</td><td>' + escapeHtml(row.gender) + '</td><td>' +
        escapeHtml(row.age) + '</td><td>' + escapeHtml(row.elo) + '</td><td>' +
        escapeHtml(row.matches) + '</td><td>' + escapeHtml(row.wins) + '</td><td>' +
        escapeHtml(row.losses) + '</td><td>' + escapeHtml(row.draws) + '</td></tr>';
    }).join("");

    const headers = isAllSports
      ? '<th>Rank</th><th>Player ID</th><th>Player</th><th>Sports</th><th>Gender</th><th>Age</th><th>Sports Played</th><th>Average Elo</th><th>Matches</th><th>Wins</th><th>Losses</th><th>Draws</th>'
      : '<th>Rank</th><th>Player ID</th><th>Player</th><th>Sports</th><th>Gender</th><th>Age</th><th>' + escapeHtml(format) + ' Elo</th><th>Matches</th><th>Wins</th><th>Losses</th><th>Draws</th>';
    const description = isAllSports
      ? '<p class="category-ranking-note">Combined ranking: players are ranked by their average ' + escapeHtml(format) + ' Elo across the sports they have a rating in. Sports Played shows how many sports contribute to the average.</p>'
      : isSummary
        ? '<p class="category-ranking-note">Summary: each player is listed separately in every sport they have a rating for. Rank is calculated independently within each sport, so you can compare a player’s results across all sports.</p>'
        : '<p class="category-ranking-note">Ranking for ' + escapeHtml(selectedSport.name || selectedSport.sheetName || "this sport") + ', ordered by ' + escapeHtml(format) + ' Elo.</p>';
    content.innerHTML = description + '<div class="ranking-table-wrap"><table class="ranking-table"><thead><tr>' +
      headers + '</tr></thead><tbody>' + tableRows + '</tbody></table></div>';
    if (isAllSports) {
      content.querySelectorAll(".ranking-tree-toggle").forEach(toggle => {
        toggle.addEventListener("click", () => {
          const detailRow = toggle.closest("tr")?.nextElementSibling;
          if (!detailRow || !detailRow.classList.contains("ranking-tree-details-row")) return;
          const expanded = toggle.getAttribute("aria-expanded") === "true";
          toggle.setAttribute("aria-expanded", String(!expanded));
          const arrow = toggle.querySelector("span");
          if (arrow) arrow.textContent = expanded ? "▸" : "▾";
          detailRow.hidden = expanded;
        });
      });
    }
  }

  function renderRankings() {
    const content = $("#ranking-content");
    const sport = selectedRankingSport();
    const sheetName = String(sport && (sport.sheetName || sport.name) || "");
    // Ranking sheets are generated by the Elo engine; keep them read-only.
    $("#toggle-ranking-edit").hidden = true;
    $("#ranking-admin-note").hidden = !currentCredential;
    $("#toggle-ranking-edit").textContent = rankingEditMode ? "Cancel editing" : "Edit rankings";
    renderRankingPicker();
    if (!rankingSports.length) {
      content.innerHTML = '<div class="empty-state"><strong>No sports rankings available yet</strong>Refresh after the sports rating tabs have been configured.</div>';
      return;
    }
    if ($("#ranking-player-filter") && $("#ranking-format-filter")) {
      populateRankingPlayerFilter();
      renderAllSportsRankings();
      return;
    }
    // Fallback for older markup.
    if (!sport) {
      content.innerHTML = '<div class="empty-state"><strong>No sports rankings available yet</strong>Refresh this page to try again.</div>';
      return;
    }
    const headers = Array.isArray(sport.headers) ? sport.headers : [];
    const rows = Array.isArray(sport.rows) ? sport.rows : [];
    content.innerHTML = '<div class="ranking-table-wrap"><table class="ranking-table"><thead><tr>' +
      headers.map(h => '<th>' + escapeHtml(h) + '</th>').join("") + '</tr></thead><tbody>' +
      rows.map(row => '<tr>' + headers.map((_, ci) => '<td>' + escapeHtml(Array.isArray(row) ? (row[ci] ?? "") : "") + '</td>').join("") + '</tr>').join("") +
      '</tbody></table></div>';
  }

  function insightRows(sport) {
    const headers = Array.isArray(sport.headers) ? sport.headers : [];
    return (sport.rows || []).map(row => {
      const item = {};
      headers.forEach((h, i) => item[h] = Array.isArray(row) ? (row[i] ?? "") : "");
      return item;
    }).filter(row => String(row["Player ID"] || "").trim() && String(row["Player Name"] || "").trim());
  }

  function renderInsights() {
    const kpis = $("#insights-highlights");
    const sportHighlightsContainer = $("#insights-sport-highlights");
    if (!kpis || !sportHighlightsContainer) return;
    if (!rankingSports.length) {
      kpis.innerHTML = '<div class="insight-empty">Scoreboard metrics will appear when rankings are available.</div>';
      sportHighlightsContainer.innerHTML = '<div class="insight-empty">Highest ratings will appear when rankings are available.</div>';
      return;
    }
    const format = $("#insights-format-filter")?.value || "Singles";
    const gender = $("#insights-gender-filter")?.value || "All";
    const ageBands = selectedAgeBands("insights");
    const categoryLabel = selectedCategoryLabel(gender, ageBands);
    const eloKey = format + " Elo";
    const matchesKey = format + " Matches";
    const winsKey = format + " Wins";
    const lossesKey = format + " Losses";
    const drawsKey = format + " Draws";
    const playerMap = new Map();
    let highest = {name:"—", sport:"", elo:-Infinity};
    let matchAppearances = 0;
    const sportCards = rankingSports.map((sport, sportIndex) => {
      const rows = insightRows(sport).filter(row => playerMatchesCategory(row["Player ID"], gender, ageBands)).map(row => {
        const elo = Number(row[eloKey] || 1000);
        const matches = Number(row[matchesKey] || 0);
        if (elo > highest.elo) highest = {name:row["Player Name"],sport:sport.name || sport.sheetName,elo};
        matchAppearances += matches;
        const id = String(row["Player ID"]).trim().toUpperCase();
        if (!playerMap.has(id)) playerMap.set(id, {id,name:row["Player Name"],eloTotal:0,sports:[],matches:0,wins:0,losses:0,draws:0});
        const p = playerMap.get(id);
        p.name = p.name || row["Player Name"];
        p.eloTotal += elo;
        p.sports.push({name:sport.name || String(sport.sheetName || "").replace(/-Rating$/i,""),elo});
        p.matches += matches;
        p.wins += Number(row[winsKey] || 0);
        p.losses += Number(row[lossesKey] || 0);
        p.draws += Number(row[drawsKey] || 0);
        return {id,name:row["Player Name"],elo,matches,wins:Number(row[winsKey]||0),losses:Number(row[lossesKey]||0),draws:Number(row[drawsKey]||0)};
      }).sort((a,b)=>b.elo-a.elo || a.name.localeCompare(b.name));
      const label = sport.name || String(sport.sheetName || "").replace(/-Rating$/i,"");
      const code = String(sport.code || sport.sheetName || "").replace(/-Rating$/i,"").toLowerCase().replace(/[^a-z]/g,"");
      const icons = ["🏓","🥒","🏸","🎾"];
      return '<article class="sport-leader-card sport-tone-' + (sportIndex%4+1) + '"><div class="sport-leader-head"><span class="sport-leader-icon">' + icons[sportIndex%4] + '</span><div><p>' + escapeHtml(code.toUpperCase()) + ' LEADERBOARD</p><h4>' + escapeHtml(label) + '</h4></div><span class="leaderboard-format">' + escapeHtml(format) + '</span></div>' +
        (rows.length ? '<ol class="top-five-list">' + rows.slice(0,5).map((r,i)=>'<li><span class="leader-rank">' + (i===0?'🥇':i===1?'🥈':i===2?'🥉':String(i+1).padStart(2,"0")) + '</span><span class="leader-player"><strong>' + escapeHtml(r.name) + '</strong><small>' + escapeHtml(r.id) + ' · ' + r.matches + ' matches</small></span><strong class="leader-elo">' + escapeHtml(r.elo) + '</strong></li>').join("") + '</ol>' : '<div class="insight-empty">No players match this category yet. Check Gender and Date of Birth in SPORTS_PLAYERS.</div>') +
        '<div class="sport-leader-footer">Top ' + Math.min(5,rows.length) + ' ' + escapeHtml(categoryLabel) + ' players by ' + escapeHtml(format) + ' Elo</div></article>';
    });
    const players = Array.from(playerMap.values()).map(p=>({...p,average:p.sports.length?p.eloTotal/p.sports.length:0})).sort((a,b)=>b.average-a.average || b.sports.length-a.sports.length || a.name.localeCompare(b.name));
    const totalPlayers = playerMap.size;
    const totalMatches = Math.round(matchAppearances / (format === "Doubles" ? 4 : 2));
    const sportHighlights = rankingSports.map((sport, sportIndex) => {
      const label = sport.name || String(sport.sheetName || "").replace(/-Rating$/i,"");
      const code = String(sport.code || sport.sheetName || label).replace(/-Rating$/i,"").toUpperCase();
      const iconsByCode = {TT:"🏓",PB:"",BAD:"🏸",LT:"🎾"};
      const ratingRows = insightRows(sport)
        .filter(row => playerMatchesCategory(row["Player ID"], gender, ageBands))
        .map(row => ({name:String(row["Player Name"] || ""), id:String(row["Player ID"] || ""), elo:Number(row[eloKey] || 1000)}))
        .sort((a,b) => b.elo-a.elo || a.name.localeCompare(b.name));
      const leader = ratingRows[0];
      const sportIcon = code === "PB"
        ? '<span class="kpi-icon"><svg class="pickleball-card-icon" viewBox="0 0 64 64" role="img" aria-label="Pickleball paddle and ball" style="width:22px;height:22px;display:block"><g transform="rotate(35 25 28)"><rect x="14" y="5" width="23" height="34" rx="11" fill="#173b65"/><rect x="21" y="34" width="9" height="22" rx="4" fill="#173b65"/><path d="M19 12h13M18 17h15" stroke="#5cc5e8" stroke-width="2" stroke-linecap="round"/><g fill="#b8d8ef"><circle cx="20" cy="24" r="1"/><circle cx="26" cy="22" r="1"/><circle cx="31" cy="25" r="1"/><circle cx="22" cy="29" r="1"/><circle cx="28" cy="30" r="1"/></g></g><circle cx="45" cy="43" r="12" fill="#f7d82d" stroke="#d7ad11" stroke-width="1.5"/><g fill="#b98d08"><circle cx="41" cy="37" r="1.8"/><circle cx="49" cy="38" r="1.8"/><circle cx="38" cy="44" r="1.8"/><circle cx="46" cy="46" r="1.8"/><circle cx="43" cy="51" r="1.8"/><circle cx="52" cy="44" r="1.8"/></g></svg></span>'
        : '<span class="kpi-icon">' + (iconsByCode[code] || ["🏓","🏓","🏸","🎾"][sportIndex%4]) + '</span>';
      return '<article class="insight-kpi kpi-elo">' + sportIcon + '<small>HIGHEST ' + escapeHtml(format.toUpperCase()) + ' · ' + escapeHtml(label.toUpperCase()) + '</small><strong>' + (leader ? escapeHtml(leader.elo) : "—") + '</strong><span>' + (leader ? escapeHtml(leader.name) + ' · ' + escapeHtml(leader.id) : 'No matching players') + '</span></article>';
    });
    const allSportsLeader = players[0];
    const allSportsCard = '<article class="insight-kpi kpi-elo"><span class="kpi-icon">🌐</span><small>HIGHEST ALL SPORTS ELO · ' + escapeHtml(format.toUpperCase()) + '</small><strong>' + (allSportsLeader ? escapeHtml(Math.round(allSportsLeader.average)) : "—") + '</strong><span>' + (allSportsLeader ? escapeHtml(allSportsLeader.name) + ' · ' + escapeHtml(allSportsLeader.id) + ' · ' + allSportsLeader.sports.length + ' sport(s)' : 'No matching players') + '</span></article>';
    kpis.innerHTML =
      '<article class="insight-kpi kpi-players"><span class="kpi-icon">👥</span><small>' + escapeHtml(categoryLabel.toUpperCase()) + ' PLAYERS</small><strong>' + totalPlayers + '</strong><span>Unique players in selected category</span></article>' +
      '<article class="insight-kpi kpi-sports"><span class="kpi-icon">🏅</span><small>SPORTS TRACKED</small><strong>' + rankingSports.length + '</strong><span>Active Elo leaderboards</span></article>' +
      '<article class="insight-kpi kpi-matches"><span class="kpi-icon">🔥</span><small>MATCHES RECORDED</small><strong>' + totalMatches + '</strong><span>' + escapeHtml(format) + ' matches, estimated from player records</span></article>' +
      '<article class="insight-kpi kpi-tournaments"><span class="kpi-icon">🏆</span><small>TOURNAMENTS CONDUCTED</small><strong>' + allEvents.filter(event => ["ARCHIVED","COMPLETED","CLOSED"].includes(normalStatus(event))).length + '</strong><span>Completed events in the directory</span></article>';
    sportHighlightsContainer.innerHTML = allSportsCard + sportHighlights.join("");
    // Full sport leaderboards are intentionally shown only in the unified Sports Ranking tab.
  }

  function wireRemoveRankingRows() {
    document.querySelectorAll("[data-remove-row]").forEach(button => {
      button.onclick = () => button.closest("tr").remove();
    });
  }

  async function loadRankings() {
    const status = $("#ranking-status");
    status.textContent = "Loading sports rankings…";
    try {
      const response = await fetch(API_URL + "?action=rankings", {method:"GET", cache:"no-store"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (!data || data.ok !== true || !Array.isArray(data.sports)) throw new Error(data && data.error || "Ranking response is not configured yet.");
      rankingSports = data.sports;
      const pageParams = new URLSearchParams(window.location.search);
      const requestedSport = String(pageParams.get("sport") || "").trim().toUpperCase();
      if (requestedSport === "ALL") activeRankingSheet = "__ALL__";
      else if (requestedSport === "SUMMARY") activeRankingSheet = "__SUMMARY__";
      else if (requestedSport) {
        const matchingSport = rankingSports.find(s => {
          const code = String(s.code || "").trim().toUpperCase();
          const sheet = String(s.sheetName || "").replace(/-Rating$/i, "").trim().toUpperCase();
          const name = String(s.name || "").trim().toUpperCase();
          const aliases = {BAD:"BAD", BADMINTON:"BAD", TT:"TT", "TABLE TENNIS":"TT", PB:"PB", PICKLEBALL:"PB", LT:"LT", "LAWN TENNIS":"LT"};
          return [code, sheet, name, aliases[code], aliases[sheet], aliases[name]].includes(requestedSport);
        });
        if (matchingSport) activeRankingSheet = String(matchingSport.sheetName || matchingSport.name);
      }
      // Do not reactivate the Rankings tab from inside a data load; that caused repeated reloads.
      try {
        const playersResponse = await fetch(API_URL + "?action=players", {method:"GET", cache:"no-store"});
        const playersData = await playersResponse.json();
        if (playersResponse.ok && playersData && playersData.ok === true && Array.isArray(playersData.players)) {
          playerProfiles = new Map(playersData.players.map(p => [String(p["Player ID"] || "").trim().toUpperCase(), p]));
        }
      } catch (profileError) {
        console.warn("SRGF Sports player category details could not be loaded:", profileError);
      }
      if (activeRankingSheet !== "__ALL__" && activeRankingSheet !== "__SUMMARY__" && !rankingSports.some(s => String(s.sheetName || s.name) === activeRankingSheet)) {
        activeRankingSheet = "__ALL__";
      }
      renderRankings();
      renderInsights();
      status.textContent = "Rankings refreshed.";
    } catch (error) {
      status.textContent = "Rankings could not be loaded. The SRGF Sports Apps Script needs the rankings read endpoint.";
      console.error("SRGF Sports rankings:", error);
      renderRankings();
      renderInsights();
    }
  }

  async function saveRankingChanges() {
    if (!currentCredential) {
      $("#ranking-status").textContent = "Please sign in as an approved administrator before saving.";
      return;
    }
    const sport = selectedRankingSport();
    if (!sport) return;
    const headers = Array.isArray(sport.headers) ? sport.headers : [];
    const body = $("#ranking-edit-body");
    const rows = Array.from(body.querySelectorAll("tr")).map(tr => headers.map((_, ci) => {
      const input = tr.querySelector('[data-col="' + ci + '"]');
      return input ? input.value.trim() : "";
    })).filter(row => row.some(cell => cell !== ""));
    const saveButton = $("#save-ranking-changes");
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    $("#ranking-status").textContent = "Saving rankings to Google Sheets…";
    try {
      const response = await fetch(API_URL, {
        method:"POST",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({action:"saverankings", idToken:currentCredential, sheetName:String(sport.sheetName || sport.name), headers, rows})
      });
      const data = await response.json();
      if (!response.ok || !data || data.ok !== true) throw new Error(data && data.error || "Unable to save rankings.");
      rankingEditMode = false;
      await loadRankings();
      $("#ranking-status").textContent = "Rankings saved successfully.";
    } catch (error) {
      $("#ranking-status").textContent = "Save failed. The SRGF Sports Apps Script needs the protected ranking-save endpoint.";
      console.error("SRGF Sports ranking save:", error);
    } finally {
      const button = $("#save-ranking-changes");
      if (button) { button.disabled = false; button.textContent = "Save rankings"; }
    }
  }

  $("#ranking-player-filter").addEventListener("change", () => { saveRankingFilters(); renderRankings(); });
  $("#ranking-format-filter").addEventListener("change", () => { saveRankingFilters(); renderRankings(); });
  $("#ranking-gender-filter").addEventListener("change", () => { saveRankingFilters(); renderRankings(); });
  $("#insights-gender-filter").addEventListener("change", () => { saveRankingFilters(); renderInsights(); });
  document.querySelectorAll('input[name="ranking-age-band"]').forEach(input => input.addEventListener("change", () => {
    updateAgeSummary("ranking");
    const dropdown = input.closest(".age-multi-dropdown");
    if (dropdown) dropdown.open = false;
    saveRankingFilters();
    renderRankings();
  }));
  document.querySelectorAll('input[name="insights-age-band"]').forEach(input => input.addEventListener("change", () => {
    updateAgeSummary("insights");
    const dropdown = input.closest(".age-multi-dropdown");
    if (dropdown) dropdown.open = false;
    saveRankingFilters();
    renderInsights();
  }));

  document.querySelectorAll("[data-age-select-all]").forEach(input => input.addEventListener("change", () => {
    const prefix = input.dataset.ageSelectAll;
    document.querySelectorAll('input[name="' + prefix + '-age-band"]').forEach(band => { band.checked = input.checked; });
    updateAgeSummary(prefix);
    const dropdown = input.closest(".age-multi-dropdown");
    if (dropdown) dropdown.open = false;
    saveRankingFilters();
    if (prefix === "ranking") renderRankings();
    else renderInsights();
  }));

  // Dismiss either age selector when the user clicks or taps outside it.
  document.addEventListener("click", event => {
    document.querySelectorAll(".age-multi-dropdown[open]").forEach(dropdown => {
      if (!dropdown.contains(event.target)) dropdown.open = false;
    });
  });
  $("#insights-format-filter").addEventListener("change", () => { saveRankingFilters(); renderInsights(); });
  $("#refresh-rankings").addEventListener("click", loadRankings);
  $("#toggle-ranking-edit").addEventListener("click", () => {
    rankingEditMode = !rankingEditMode;
    renderRankings();
  });

  // The current Racketlon website remains accessible even before an event
  // record is added to the new master directory.
  window.SRGFSportsDirectory = { refresh: () => loadEvents(true), racketlonUrl: RACKETLON_URL };
  // Paint cached events immediately, then refresh from the directory in the background.
  restoreCachedEvents();
  render();
  // activateTab() loads the selected tab. Only load both datasets directly when there is no saved tab.
  if (!allowedTabs.includes(initialTab || "")) {
    loadEvents();
    loadRankings();
  }
  // Keep event listings fresh while the page is open; pause periodic checks in background tabs.
  window.setInterval(() => {
    if (!document.hidden) loadEvents();
  }, EVENTS_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadEvents();
  });
})();