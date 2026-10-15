(() => {
  "use strict";
  const API_URL = "https://script.google.com/macros/s/AKfycbyLw0Yvg1xwH0JTStGa7buZ2k5AZ0OIigIursW0hOLTUWna3pwXAGga_Z80-5MEx6G5/exec";
  const RACKETLON_URL = "https://srgf-sports-committee.github.io/SRGF-Racketlon-2027/";
  const $ = (selector) => document.querySelector(selector);
  let allEvents = [];

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
      status.textContent = "Event directory updated.";
    } catch (error) {
      render();
      status.textContent = "The event directory could not be refreshed. Please try again.";
      console.error("SRGF Sports directory error:", error);
    }
  }

  function activateTab(name) {
    document.querySelectorAll("[data-tab]").forEach(button => {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".tab-panel").forEach(panel => {
      panel.hidden = panel.id !== name + "-panel";
    });
  }

  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => activateTab(button.dataset.tab)));
  document.querySelectorAll("[data-tab-target]").forEach(button => button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget);
    document.querySelector("#section-heading").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  $("#refresh-upcoming").addEventListener("click", loadEvents);
  $("#refresh-archived").addEventListener("click", loadEvents);

  // The current Racketlon website remains accessible even before an event
  // record is added to the new master directory.
  window.SRGFSportsDirectory = { refresh: loadEvents, racketlonUrl: RACKETLON_URL };
  render();
  loadEvents();
})();