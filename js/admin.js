(() => {
  "use strict";
  const API_URL = "https://script.google.com/macros/s/AKfycbyLw0Yvg1xwH0JTStGa7buZ2k5AZ0OIigIursW0hOLTUWna3pwXAGga_Z80-5MEx6G5/exec";
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const sportNames = {TT:"Table Tennis",PB:"Pickleball",BAD:"Badminton",LT:"Lawn Tennis"};
  let idToken = "", players = [], matches = [], stagedRows = [], editingMatch = false;

  function setStatus(el, message, type) {
    if (!el) return;
    el.textContent = message || "";
    el.className = "admin-status" + (type ? " " + type : "");
  }
  async function get(action, params = {}) {
    const url = new URL(API_URL);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    const response = await fetch(url, {cache:"no-store"});
    if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  async function post(payload) {
    const response = await fetch(API_URL, {method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({...payload,idToken})});
    if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
    const data = await response.json();
    if (!data.ok && payload.action !== "bulkimport") throw new Error(data.error || "Request failed.");
    return data;
  }
  function normalizeSport(value) {
    const s = String(value || "").trim().toUpperCase();
    if (s === "BADMINTON" || s === "BAD" || s === "BAD-MATCH") return "BAD";
    if (s === "TABLE TENNIS" || s === "TABLETENNIS" || s === "TT") return "TT";
    if (s === "PICKLEBALL" || s === "PB") return "PB";
    if (s === "LAWN TENNIS" || s === "LAWTENNIS" || s === "LT") return "LT";
    return s;
  }
  function matchDateForInput(value) {
    if (!value) return "";
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function playerOptions() {
    const html = '<option value="">Select Player ID…</option>' + players.map(p => {
      const id = p["Player ID"] || p.playerId || p.ID || "";
      const name = p["Player Name"] || p["Name"] || p.name || "";
      return '<option value="' + esc(id) + '">' + esc(id + (name ? " — " + name : "")) + '</option>';
    }).join("");
    ["#admin-p1","#admin-p2","#admin-p3","#admin-p4"].forEach(sel => { if ($(sel)) $(sel).innerHTML = html; });
  }
  async function loadFeaturedEvents() {
    const select = $("#admin-featured-event");
    if (!select) return;
    const data = await get("events");
    const events = data.events || [];
    const featured = events.find(event => /^(TRUE|YES|1|FEATURED)$/i.test(String(event.Featured || event["Is Featured"] || event["Featured Event"] || "").trim()));
    const racketlon = events.find(event => /racketlon/i.test(String(event["Event Name"] || event.eventName || "")));
    select.innerHTML = events.length
      ? events.map(event => {
          const id = String(event["Event ID"] || event.eventId || "").trim();
          const name = String(event["Event Name"] || event.eventName || "SRGF Sports Event").trim();
          const sport = String(event.Sport || "").trim();
          const status = String(event.Status || "").trim();
          return '<option value="' + esc(id) + '">' + esc(name + (sport ? " — " + sport : "") + (status ? " (" + status + ")" : "")) + '</option>';
        }).join("")
      : '<option value="">No events available in the directory</option>';
    const selected = featured ? String(featured["Event ID"] || featured.eventId || "") : racketlon ? String(racketlon["Event ID"] || racketlon.eventId || "") : "";
    if (selected) select.value = selected;
    $("#admin-save-featured-event").disabled = !idToken || !events.length || !select.value;
    setStatus($("#admin-featured-status"), featured ? "Current featured event: " + (featured["Event Name"] || featured.eventName || "Selected event") : "No featured flag is set yet. The Home page is using its Racketlon default until you save a choice.", "info");
  }

  async function loadPlayers() {
    const data = await get("players");
    players = data.players || [];
    playerOptions();
  }
  function toggleDoubles() {
    const isDoubles = $("#admin-format").value === "Doubles";
    $("#admin-p3-wrap").classList.toggle("admin-field-hidden", !isDoubles);
    $("#admin-p4-wrap").classList.toggle("admin-field-hidden", !isDoubles);
    $("#admin-p3").required = isDoubles;
    $("#admin-p4").required = isDoubles;
  }
  function clearForm() {
    editingMatch = false;
    $("#admin-match-form").reset();
    $("#admin-match-id").value = "";
    $("#admin-format").value = "Singles";
    $("#admin-status").value = "Completed";
    $("#admin-sport").value = $("#admin-history-sport").value === "ALL" ? "TT" : $("#admin-history-sport").value;
    $("#admin-match-date").value = new Date().toISOString().slice(0,10);
    $("#admin-match-form-title").textContent = "Add a match result";
    $("#admin-save-match").textContent = "Save match result";
    toggleDoubles();
    setStatus($("#admin-entry-status"), "", "");
  }
  function rowMatch(m) {
    const code = normalizeSport(m.Sport || m.sport || m["Sport Code"] || m._sport);
    const isSingles = String(m.Format || "").toLowerCase() === "singles";
    const side1 = [m["Player 1 ID"], ...(isSingles ? [] : [m["Player 2 ID"]])].filter(Boolean).join(" / ");
    const side2 = isSingles ? (m["Player 2 ID"] || "") : [m["Player 3 ID"],m["Player 4 ID"]].filter(Boolean).join(" / ");
    const id = m["Match ID"] || m.MatchID || "";
    return '<tr><td>' + esc(m["Match Date"] || "") + '</td><td>' + esc(sportNames[code] || code) + '</td><td>' + esc(id) + '</td><td>' + esc(m.Format || "") + '</td><td>' + esc(side1) + '</td><td>' + esc(side2) + '</td><td>' + esc(m.Result || "") + '</td><td>' + esc(m.Status || "") + '</td><td><button type="button" class="admin-edit-match" data-match-id="' + esc(id) + '" data-sport="' + esc(code) + '">Edit</button></td></tr>';
  }
  function renderMatches() {
    const target = $("#admin-match-history");
    const filter = $("#admin-history-sport").value;
    const rows = matches.filter(m => filter === "ALL" || normalizeSport(m._sport || m.Sport || m.sport) === filter);
    if (!rows.length) {
      target.innerHTML = '<div class="admin-empty">No matches found for this filter.</div>';
      return;
    }
    target.innerHTML = '<div class="admin-table-wrap"><table><thead><tr><th>Date</th><th>Sport</th><th>Match ID</th><th>Format</th><th>Side 1</th><th>Side 2</th><th>Result</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows.map(rowMatch).join("") + '</tbody></table></div>';
  }
  async function loadMatches() {
    const target = $("#admin-match-history");
    target.innerHTML = '<div class="loading-state">Loading match history…</div>';
    const sports = ["TT","PB","BAD","LT"];
    const results = await Promise.allSettled(sports.map(async sport => {
      const data = await get("matches", {sport});
      return (data.matches || []).map(m => ({...m,_sport:sport}));
    }));
    const errors = results.filter(r => r.status === "rejected");
    matches = results.filter(r => r.status === "fulfilled").flatMap(r => r.value);
    renderMatches();
    if (errors.length && !matches.length) throw errors[0].reason;
    if (errors.length) setStatus($("#admin-entry-status"), "Some sports could not be loaded. Use Refresh to try again.", "error");
  }
  function editMatch(id, sport) {
    const m = matches.find(x => String(x["Match ID"] || x.MatchID || "") === String(id) && normalizeSport(x._sport || x.Sport || x.sport) === normalizeSport(sport));
    if (!m) { setStatus($("#admin-entry-status"), "That match is no longer in the loaded history. Refresh and try again.", "error"); return; }
    editingMatch = true;
    $("#admin-sport").value = normalizeSport(sport);
    $("#admin-match-id").value = m["Match ID"] || m.MatchID || "";
    $("#admin-match-date").value = matchDateForInput(m["Match Date"]);
    $("#admin-format").value = m.Format || "Singles";
    $("#admin-status").value = m.Status || "Completed";
    $("#admin-result").value = m.Result || "";
    $("#admin-p1").value = m["Player 1 ID"] || "";
    $("#admin-p2").value = m["Player 2 ID"] || "";
    $("#admin-p3").value = m["Player 3 ID"] || "";
    $("#admin-p4").value = m["Player 4 ID"] || "";
    $("#admin-notes").value = m.Notes || "";
    $("#admin-match-form-title").textContent = "Edit match result";
    $("#admin-save-match").textContent = "Save changes";
    toggleDoubles();
    $("#admin-match-form").scrollIntoView({behavior:"smooth",block:"start"});
    setStatus($("#admin-entry-status"), "Editing Match ID " + ($("#admin-match-id").value || id) + ". Save changes when ready.", "info");
  }
  $("#admin-format").addEventListener("change", toggleDoubles);
  $("#admin-new-match").addEventListener("click", clearForm);
  $("#admin-history-sport").addEventListener("change", renderMatches);
  $("#admin-save-featured-event").addEventListener("click", async () => {
    const button = $("#admin-save-featured-event");
    const eventId = $("#admin-featured-event").value;
    if (!idToken) { setStatus($("#admin-featured-status"), "Sign in as an approved admin to change the Featured Event.", "error"); return; }
    if (!eventId) { setStatus($("#admin-featured-status"), "Choose an event first.", "error"); return; }
    button.disabled = true;
    setStatus($("#admin-featured-status"), "Saving Featured Event…", "info");
    try {
      const result = await post({action:"setfeaturedevent", eventId});
      setStatus($("#admin-featured-status"), result.message || "Featured Event updated.", "success");
      await loadFeaturedEvents();
      window.dispatchEvent(new CustomEvent("srgf-featured-event-updated"));
    } catch (err) {
      setStatus($("#admin-featured-status"), "Could not update Featured Event: " + err.message, "error");
    } finally {
      button.disabled = !idToken || !$("#admin-featured-event").value;
    }
  });

  $("#admin-recalculate-ratings").addEventListener("click", async () => {
    const button = $("#admin-recalculate-ratings");
    if (!idToken) {
      setStatus($("#admin-recalculate-status"), "Sign in as an approved administrator first.", "error");
      return;
    }
    if (!window.confirm("Recalculate Singles and Doubles ratings for all four sports from every Completed match in the Match sheets? This will rebuild all four Rating and RatingHistory sheets.")) return;
    button.disabled = true;
    button.textContent = "Recalculating…";
    setStatus($("#admin-recalculate-status"), "Replaying all completed matches for TT, Pickleball, Badminton and Lawn Tennis…", "info");
    try {
      const data = await post({action:"recalculateallrankings"});
      const summaries = (data.results || []).map(result =>
        result.sport + ": " + result.completedMatches + " completed matches, " + result.players + " players"
      );
      setStatus($("#admin-recalculate-status"),
        (data.message || "All ratings recalculated.") + (summaries.length ? " " + summaries.join(" · ") : ""),
        "success"
      );
    } catch (err) {
      setStatus($("#admin-recalculate-status"), "Full recalculation failed: " + err.message, "error");
    } finally {
      button.disabled = !idToken;
      button.textContent = "Recalculate all ratings";
    }
  });
  $("#admin-refresh-matches").addEventListener("click", async () => {
    try { await loadMatches(); setStatus($("#admin-entry-status"), "Match history refreshed.", "success"); }
    catch (e) { setStatus($("#admin-entry-status"), e.message, "error"); }
  });
  $("#admin-match-history").addEventListener("click", e => {
    const b = e.target.closest("[data-match-id]");
    if (b) editMatch(b.dataset.matchId, b.dataset.sport);
  });
  $("#admin-match-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!idToken) return setStatus($("#admin-entry-status"), "Sign in as an approved administrator first.", "error");
    const result = $("#admin-result").value;
    const match = {
      "Match ID": $("#admin-match-id").value.trim(),
      "Match Date": $("#admin-match-date").value,
      Format: $("#admin-format").value,
      "Player 1 ID": $("#admin-p1").value,
      "Player 2 ID": $("#admin-p2").value,
      "Player 3 ID": $("#admin-p3").value,
      "Player 4 ID": $("#admin-p4").value,
      Result: result,
      Status: $("#admin-status").value,
      Notes: $("#admin-notes").value.trim()
    };
    const button = $("#admin-save-match");
    button.disabled = true;
    setStatus($("#admin-entry-status"), "Validating and saving match…", "info");
    try {
      const data = await post({action:"savematch",sport:$("#admin-sport").value,match});
      setStatus($("#admin-entry-status"), (data.message || "Match saved.") + " Match ID: " + data.matchId, "success");
      $("#admin-match-id").value = data.matchId || match["Match ID"];
      await loadMatches();
      if (data.matchId) editMatch(data.matchId, $("#admin-sport").value);
    } catch (err) {
      setStatus($("#admin-entry-status"), err.message, "error");
    } finally { button.disabled = false; }
  });
  function parseUpload(file) {
    return new Promise((resolve,reject) => {
      if (!window.XLSX) return reject(new Error("Excel/CSV reader is still loading. Try again shortly."));
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const workbook = XLSX.read(ev.target.result,{type:"array",cellDates:true});
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet,{defval:"",raw:false});
          resolve(rows.map((r,i)=>({...r,__rowNumber:i+2})));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.readAsArrayBuffer(file);
    });
  }
  function validateUploadPreview() {
    const required = ["Match ID","Match Date","Sport","Format","Player 1 ID","Player 3 ID","Result","Status"];
    const missing = required.filter(h => stagedRows.length && !(h in stagedRows[0]));
    const ids = new Set(), duplicates = [];
    stagedRows.forEach(r => {
      const id = String(r["Match ID"] || "").trim();
      if (!id) duplicates.push("row " + r.__rowNumber + " has no Match ID");
      else if (ids.has(id)) duplicates.push("duplicate Match ID " + id + " in the file");
      else ids.add(id);
    });
    const invalidSports = stagedRows.filter(r => !["TT","PB","BAD","BADMINTON","PICKLEBALL","LT","LAWN TENNIS","TABLE TENNIS"].includes(normalizeSport(r.Sport))).map(r=>"row "+r.__rowNumber+" has an unsupported Sport");
    const invalidFormats = stagedRows.filter(r => !["SINGLES","DOUBLES"].includes(String(r.Format || "").trim().toUpperCase())).map(r=>"row "+r.__rowNumber+" must use Singles or Doubles");
    const missingPlayers = stagedRows.filter(r => {
      const format = String(r.Format || "").trim().toUpperCase();
      return !String(r["Player 1 ID"] || "").trim() || !String(r["Player 3 ID"] || "").trim() || (format === "DOUBLES" && (!String(r["Player 2 ID"] || "").trim() || !String(r["Player 4 ID"] || "").trim()));
    }).map(r=>"row "+r.__rowNumber+" is missing a player ID (Singles needs Player 1 and Player 3; Doubles needs all four IDs)");
    const errors = [...missing.map(h=>"missing column "+h),...duplicates,...invalidSports,...invalidFormats,...missingPlayers];
    const preview = $("#admin-upload-preview");
    if (errors.length) {
      preview.innerHTML = '<div class="admin-upload-errors"><strong>Please correct the file before importing:</strong><ul>' + errors.slice(0,20).map(e=>'<li>'+esc(e)+'</li>').join("") + '</ul></div>';
      if (errors.length > 20) preview.insertAdjacentHTML("beforeend",'<p class="admin-small-help">Showing the first 20 validation errors.</p>');
      $("#admin-confirm-upload").disabled = true;
      return false;
    }
    preview.innerHTML = '<p class="admin-preview-summary">Ready to review: <strong>'+stagedRows.length+'</strong> row(s). Previewing up to 10 rows.</p><div class="admin-table-wrap"><table><thead><tr><th>Row</th><th>Sport</th><th>Match ID</th><th>Date</th><th>Format</th><th>Side 1</th><th>Side 2</th><th>Result</th></tr></thead><tbody>' + stagedRows.slice(0,10).map(r=>{const doubles=String(r.Format).trim().toUpperCase()==="DOUBLES";const side1=doubles?[r["Player 1 ID"],r["Player 2 ID"]].filter(Boolean).join(" / "):r["Player 1 ID"];const side2=doubles?[r["Player 3 ID"],r["Player 4 ID"]].filter(Boolean).join(" / "):r["Player 3 ID"];return '<tr><td>'+r.__rowNumber+'</td><td>'+esc(r.Sport)+'</td><td>'+esc(r["Match ID"])+'</td><td>'+esc(r["Match Date"])+'</td><td>'+esc(r.Format)+'</td><td>'+esc(side1)+'</td><td>'+esc(side2)+'</td><td>'+esc(r.Result)+'</td></tr>';}).join("") + '</tbody></table></div>' + (stagedRows.length>10?'<p class="admin-small-help">Showing first 10 rows; all '+stagedRows.length+' rows will be submitted for server-side validation.</p>':"");
    $("#admin-confirm-upload").disabled = !idToken;
    return true;
  }
  $("#admin-upload-file").addEventListener("change", async e => {
    stagedRows = [];
    $("#admin-upload-preview").innerHTML = "";
    $("#admin-confirm-upload").disabled = true;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      stagedRows = await parseUpload(file);
      if (!stagedRows.length) throw new Error("No data rows found in the first worksheet.");
      if (validateUploadPreview()) setStatus($("#admin-upload-status"), "File parsed. Review the preview, then confirm the batch.", "success");
      else setStatus($("#admin-upload-status"), "The file needs corrections before import.", "error");
    } catch (err) { setStatus($("#admin-upload-status"), err.message, "error"); }
  });
  $("#admin-confirm-upload").addEventListener("click", async () => {
    if (!idToken) return setStatus($("#admin-upload-status"), "Sign in as an approved administrator first.", "error");
    if (!stagedRows.length || !validateUploadPreview()) return;
    const button = $("#admin-confirm-upload");
    button.disabled = true;
    setStatus($("#admin-upload-status"), "Server is validating all rows. No rows should be imported if validation fails.", "info");
    try {
      // In the upload template, Singles uses Player 1 and Player 3 so the
      // two sides line up visually with the Doubles team columns (1&2 vs 3&4).
      // Normalize Singles back to the backend's established P1-vs-P2 structure.
      const rowsForImport = stagedRows.map(row => {
        const normalized = {...row};
        if (String(normalized.Format || "").trim().toUpperCase() === "SINGLES") {
          normalized["Player 2 ID"] = normalized["Player 3 ID"];
          normalized["Player 3 ID"] = "";
          normalized["Player 4 ID"] = "";
        }
        return normalized;
      });
      const data = await post({action:"bulkimport",rows:rowsForImport});
      if (!data.ok) {
        const errors = (data.errors || []).map(x => "Row " + x.row + ": " + x.error).join(" • ");
        setStatus($("#admin-upload-status"), (data.error || "Import validation failed.") + (errors ? " " + errors : ""), "error");
        return;
      }
      setStatus($("#admin-upload-status"), "Imported " + data.imported + " row(s): " + data.inserted + " new, " + data.updated + " updated.", "success");
      stagedRows = [];
      $("#admin-upload-file").value = "";
      $("#admin-upload-preview").innerHTML = "";
      await loadMatches();
    } catch (err) { setStatus($("#admin-upload-status"), err.message, "error"); }
    finally { button.disabled = !idToken || !stagedRows.length; }
  });
  async function runSampleDataAction(action, button, successFallback) {
    if (!idToken) {
      setStatus($("#admin-sample-status"), "Sign in as an approved administrator first.", "error");
      return;
    }
    const loadButton = $("#admin-load-sample-data");
    const removeButton = $("#admin-remove-sample-data");
    loadButton.disabled = true;
    removeButton.disabled = true;
    setStatus($("#admin-sample-status"), action === "loadsampledata" ? "Loading demo data…" : "Removing demo data…", "info");
    try {
      const data = await post({action});
      if (data.ok === false || data.success === false) throw new Error(data.error || "The sample-data action did not complete.");
      const detail = data.message || data.msg || successFallback;
      setStatus($("#admin-sample-status"), detail, "success");
      await loadPlayers();
      await loadMatches();
    } catch (err) {
      setStatus($("#admin-sample-status"), err.message || "Sample-data action failed.", "error");
    } finally {
      const signedIn = !!idToken;
      loadButton.disabled = !signedIn;
      removeButton.disabled = !signedIn;
    }
  }
  $("#admin-sync-player-photos").addEventListener("click", async () => {
    const button = $("#admin-sync-player-photos");
    if (!idToken) {
      setStatus($("#admin-photo-sync-status"), "Sign in as an approved admin first.", "error");
      return;
    }
    if (!window.confirm("Sync player photos from the Google Drive links in SPORTS_PLAYERS into the SRGF-Sports GitHub repository? The original Photo links will be preserved.")) return;
    button.disabled = true;
    setStatus($("#admin-photo-sync-status"), "Reading Drive photos and syncing them to GitHub… This may take a few minutes.", "info");
    try {
      const data = await post({action:"syncplayerphotos"});
      const summary = data.summary || {};
      const detail = [
        (summary.synced || 0) + " uploaded",
        (summary.unchanged || 0) + " already up to date",
        (summary.skipped || 0) + " skipped",
        (summary.errors || []).length + " error(s)"
      ].join(" · ");
      const errors = (summary.errors || []).slice(0, 5);
      setStatus($("#admin-photo-sync-status"), (data.message || "Photo sync completed.") + (errors.length ? " Details: " + errors.join(" | ") : ""), errors.length ? "error" : "success");
      if (!errors.length) setStatus($("#admin-photo-sync-status"), (data.message || "Photo sync completed.") + " (" + detail + ")", "success");
      // Reload profiles so Player View immediately starts using the Git-hosted URLs.
      await loadPlayers();
      window.dispatchEvent(new CustomEvent("srgf-player-photos-synced"));
    } catch (err) {
      setStatus($("#admin-photo-sync-status"), "Photo sync failed: " + (err.message || err), "error");
    } finally {
      button.disabled = !idToken;
    }
  });

  $("#admin-load-sample-data").addEventListener("click", () => {
    runSampleDataAction("loadsampledata", $("#admin-load-sample-data"), "Sample data loaded.");
  });
  $("#admin-remove-sample-data").addEventListener("click", () => {
    if (!window.confirm("Remove only the SRGF-Sports demo/sample records? Genuine player and match records should be preserved.")) return;
    runSampleDataAction("removesampledata", $("#admin-remove-sample-data"), "Sample data removed.");
  });

  $("#admin-download-template").addEventListener("click", () => {
    const wb = XLSX.utils.book_new();
    const headers = ["Match ID","Match Date","Sport","Format","Player 1 ID","Player 2 ID","Player 3 ID","Player 4 ID","Result","Status","Notes"];
    const results = XLSX.utils.aoa_to_sheet([headers]);
    XLSX.utils.book_append_sheet(wb,results,"Results");
    // Keep the illustrative row on a separate sheet so it is never parsed
    // as an upload row when the user selects this workbook.
    const example = XLSX.utils.aoa_to_sheet([
      headers,
      ["EXAMPLE-S-001","2026-11-01","TT","Singles","SRGF0001","","SRGF0002","","Side 1 Win","Completed","SINGLES example: Player 1 vs Player 3. Replace with real match details and active Player IDs"],
      ["EXAMPLE-D-001","2026-11-02","TT","Doubles","SRGF0001","SRGF0002","SRGF0003","SRGF0004","Side 2 Win","Completed","DOUBLES example: Side 1 = Players 1+2; Side 2 = Players 3+4. Replace with real match details and active Player IDs"]
    ]);
    XLSX.utils.book_append_sheet(wb,example,"Example Data");
    const guide = XLSX.utils.aoa_to_sheet([
      ["SRGF Sports bulk match upload instructions"],
      ["Enter your real match rows in the Results sheet. The upload reads the first (Results) sheet only."],
      ["See the Example Data sheet for one completed Singles example and one completed Doubles example. Copy only the relevant example row(s) into Results after replacing the sample Match IDs, dates and Player IDs with real values."],
      ["Match ID is required and must be unique within the uploaded file. Existing Match IDs update matching records; new IDs create matches."],
      ["Sport values: TT, PB, Bad or LT. Format values: Singles or Doubles."],
      ["Singles: enter the two opponents in Player 1 ID and Player 3 ID; leave Player 2 ID and Player 4 ID blank."],
      ["Doubles: Player 1 ID and Player 2 ID are Side 1 (one team); Player 3 ID and Player 4 ID are Side 2 (the other team). All four IDs are required."],
      ["All Player IDs must already exist and be active in SPORTS_PLAYERS. Members are never created automatically."],
      ["Result: Side 1 Win, Side 2 Win or Draw. Status: Completed or Pending."],
      ["Result is required: Side 1 Win, Side 2 Win or Draw. ELO is calculated only from this result; no scores are collected."],
      ["All rows are validated by the backend before import. If any row has an error, correct the file and upload it again."]
    ]);
    XLSX.utils.book_append_sheet(wb,guide,"Instructions");
    XLSX.writeFile(wb,"SRGF-Sports-Match-Results-Template.xlsx");
  });
  window.addEventListener("srgf-admin-session", async event => {
    const detail = event.detail || {};
    idToken = detail.authorized ? (detail.idToken || "") : "";
    if (!idToken) {
      $("#results-admin-email").textContent = "";
      $("#admin-save-featured-event").disabled = true;
      $("#admin-confirm-upload").disabled = true;
      $("#admin-load-sample-data").disabled = true;
      $("#admin-remove-sample-data").disabled = true;
      $("#admin-sync-player-photos").disabled = true;
      $("#admin-recalculate-ratings").disabled = true;
      stagedRows = [];
      return;
    }
    $("#admin-load-sample-data").disabled = false;
    $("#admin-remove-sample-data").disabled = false;
    $("#admin-sync-player-photos").disabled = false;
    $("#admin-recalculate-ratings").disabled = false;
    $("#admin-save-featured-event").disabled = false;
    try {
      await loadFeaturedEvents();
    } catch (err) {
      setStatus($("#admin-featured-status"), "Could not load events: " + err.message, "error");
    }
    $("#results-admin-email").textContent = detail.email || "";
    $("#admin-confirm-upload").disabled = !stagedRows.length;
    try {
      await loadPlayers();
      clearForm();
      await loadMatches();
    } catch (err) {
      setStatus($("#admin-entry-status"), "Admin tools opened, but initial data could not be loaded: " + err.message, "error");
    }
  });
  window.addEventListener("srgf-admin-tab-activated", async () => {
    if (!idToken) return;
    try {
      await loadFeaturedEvents();
      await loadPlayers();
      await loadMatches();
      setStatus($("#admin-entry-status"), "Admin data refreshed.", "success");
    } catch (err) {
      setStatus($("#admin-entry-status"), "Admin data could not be refreshed: " + err.message, "error");
    }
  });
  toggleDoubles();
})();