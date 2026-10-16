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
    const website = safeUrl(field(event, "Website URL", "Website Url", "websiteUrl"));
    const registration = safeUrl(field(event, "Registration URL", "Registration Url", "registrationUrl"));
    const results = safeUrl(field(event, "Results URL", "Results Url", "resultsUrl"));
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
    const upcoming = allEvents.filter(event => ["UPCOMING", "OPEN", "REGISTRATION OPEN"].includes(normalStatus(event)));
    const archived = allEvents.filter(event => ["ARCHIVED", "COMPLETED", "CLOSED"].includes(normalStatus(event)));
    $("#upcoming-count").textContent = upcoming.length;
    $("#archived-count").textContent = archived.length;
    const homeUpcomingCount = $("#home-upcoming-count");
    const homeArchivedCount = $("#home-archived-count");
    if (homeUpcomingCount) homeUpcomingCount.textContent = upcoming.length;
    if (homeArchivedCount) homeArchivedCount.textContent = archived.length;
    renderList("#upcoming-list", upcoming, false);
    renderList("#archived-list", archived, true);
  }

  async function loadEvents() {
    const status = $("#directory-status");
    status.textContent = "Refreshing event directory…";
    try {
      const response = await fetch(API_URL + "?action=events", { method: "GET", cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (!data || data.ok !== true || !Array.isArray(data.events)) throw new Error(data && data.error || "Unexpected directory response.");
      allEvents = data.events;
      render();
      renderInsights();
      status.textContent = "Event directory updated.";
    } catch (error) {
      render();
      status.textContent = "The event directory could not be refreshed. Please try again.";
      console.error("SRGF Sports directory error:", error);
    }
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
  const allowedTabs = ["home", "upcoming", "archived", "rankings", "insights"];
  const initialTab = initialParams.get("tab");
  if (allowedTabs.includes(initialTab || "")) activateTab(initialTab, false);
  $("#refresh-upcoming").addEventListener("click", loadEvents);
  $("#refresh-archived").addEventListener("click", loadEvents);


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

  function showSignedInAdmin(email, role) {
    headerAdminEmail.textContent = email || "Administrator";
    headerAdminRole.textContent = role || "ADMIN";
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
  function signOutAdmin() {
    currentCredential = "";
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
    setAuthStatus("You have signed out of the admin session.", "info");
  }
  $("#sign-out-button").addEventListener("click", signOutAdmin);
  $("#header-sign-out-button").addEventListener("click", signOutAdmin);


  // Sports rankings are read from separate sport-named tabs in the SRGF Sports master sheet.
  let rankingSports = [];
  let playerProfiles = new Map();
  let activeRankingSheet = "";
  let rankingEditMode = false;

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
    summary.textContent = selected.length ? AGE_BANDS.filter(b=>selected.includes(b.value)).map(b=>b.label).join(", ") : "All age groups";
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
            ratingTotal: 0, sportsPlayed: 0, matches: 0, wins: 0, losses: 0, draws: 0
          });
        }
        const player = byPlayer.get(row.id);
        player.name = player.name || row.name;
        player.gender = player.gender === "—" ? row.gender : player.gender;
        player.age = player.age === "—" ? row.age : player.age;
        player.ratingTotal += row.elo;
        player.sportsPlayed += 1;
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
        return '<tr><td>' + rank + '</td><td>' + escapeHtml(row.id) + '</td><td><strong>' +
          escapeHtml(row.name) + '</strong></td><td>All Sports</td><td>' + escapeHtml(row.gender) + '</td><td>' +
          escapeHtml(row.age) + '</td><td>' + row.sportsPlayed + '</td><td><strong>' +
          escapeHtml(row.averageElo.toFixed(1)) + '</strong></td><td>' + row.matches + '</td><td>' +
          row.wins + '</td><td>' + row.losses + '</td><td>' + row.draws + '</td></tr>';
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
      const iconsByCode = {TT:"🏓",PB:"🥒",BAD:"🏸",LT:"🎾"};
      const ratingRows = insightRows(sport)
        .filter(row => playerMatchesCategory(row["Player ID"], gender, ageBands))
        .map(row => ({name:String(row["Player Name"] || ""), id:String(row["Player ID"] || ""), elo:Number(row[eloKey] || 1000)}))
        .sort((a,b) => b.elo-a.elo || a.name.localeCompare(b.name));
      const leader = ratingRows[0];
      return '<article class="insight-kpi kpi-elo"><span class="kpi-icon">' + (iconsByCode[code] || ["🏓","🥒","🏸","🎾"][sportIndex%4]) + '</span><small>HIGHEST ' + escapeHtml(format.toUpperCase()) + ' · ' + escapeHtml(label.toUpperCase()) + '</small><strong>' + (leader ? escapeHtml(leader.elo) : "—") + '</strong><span>' + (leader ? escapeHtml(leader.name) + ' · ' + escapeHtml(leader.id) : 'No matching players') + '</span></article>';
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
      if (pageParams.get("tab") === "rankings") activateTab("rankings", false);
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
    saveRankingFilters();
    renderRankings();
  }));
  document.querySelectorAll('input[name="insights-age-band"]').forEach(input => input.addEventListener("change", () => {
    updateAgeSummary("insights");
    saveRankingFilters();
    renderInsights();
  }));
  $("#insights-format-filter").addEventListener("change", () => { saveRankingFilters(); renderInsights(); });
  $("#refresh-rankings").addEventListener("click", loadRankings);
  $("#toggle-ranking-edit").addEventListener("click", () => {
    rankingEditMode = !rankingEditMode;
    renderRankings();
  });

  // The current Racketlon website remains accessible even before an event
  // record is added to the new master directory.
  window.SRGFSportsDirectory = { refresh: loadEvents, racketlonUrl: RACKETLON_URL };
  render();
  loadEvents();
  loadRankings();
})();