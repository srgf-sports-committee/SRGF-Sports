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
  function deriveResult() {
    const a = $("#admin-score1").value, b = $("#admin-score2").value;
    if (a === "" || b === "") return "";
    return Number(a) > Number(b) ? "Side 1 Win" : Number(a) < Number(b) ? "Side 2 Win" : "Draw";
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
    $("#admin-score1").value = m["Score 1"] ?? "";
    $("#admin-score2").value = m["Score 2"] ?? "";
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
    const result = $("#admin-result").value || deriveResult();
    const match = {
      "Match ID": $("#admin-match-id").value.trim(),
      "Match Date": $("#admin-match-date").value,
      Format: $("#admin-format").value,
      "Player 1 ID": $("#admin-p1").value,
      "Player 2 ID": $("#admin-p2").value,
      "Player 3 ID": $("#admin-p3").value,
      "Player 4 ID": $("#admin-p4").value,
      "Score 1": $("#admin-score1").value,
      "Score 2": $("#admin-score2").value,
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
    const required = ["Match ID","Match Date","Sport","Format","Player 1 ID","Player 2 ID","Result","Status"];
    const missing = required.filter(h => stagedRows.length && !(h in stagedRows[0]));
    const ids = new Set(), duplicates = [];
    stagedRows.forEach(r => {
      const id = String(r["Match ID"] || "").trim();
      if (!id) duplicates.push("row " + r.__rowNumber + " has no Match ID");
      else if (ids.has(id)) duplicates.push("duplicate Match ID " + id + " in the file");
      else ids.add(id);
    });
    const invalidSports = stagedRows.filter(r => !["TT","PB","BAD","BADMINTON","PICKLEBALL","LT","LAWN TENNIS","TABLE TENNIS"].includes(normalizeSport(r.Sport))).map(r=>"row "+r.__rowNumber+" has an unsupported Sport");
    const errors = [...missing.map(h=>"missing column "+h),...duplicates,...invalidSports];
    const preview = $("#admin-upload-preview");
    if (errors.length) {
      preview.innerHTML = '<div class="admin-upload-errors"><strong>Please correct the file before importing:</strong><ul>' + errors.slice(0,20).map(e=>'<li>'+esc(e)+'</li>').join("") + '</ul></div>';
      if (errors.length > 20) preview.insertAdjacentHTML("beforeend",'<p class="admin-small-help">Showing the first 20 validation errors.</p>');
      $("#admin-confirm-upload").disabled = true;
      return false;
    }
    preview.innerHTML = '<p class="admin-preview-summary">Ready to review: <strong>'+stagedRows.length+'</strong> row(s). Previewing up to 10 rows.</p><div class="admin-table-wrap"><table><thead><tr><th>Row</th><th>Sport</th><th>Match ID</th><th>Date</th><th>Format</th><th>Player IDs</th><th>Result</th></tr></thead><tbody>' + stagedRows.slice(0,10).map(r=>'<tr><td>'+r.__rowNumber+'</td><td>'+esc(r.Sport)+'</td><td>'+esc(r["Match ID"])+'</td><td>'+esc(r["Match Date"])+'</td><td>'+esc(r.Format)+'</td><td>'+esc([r["Player 1 ID"],r["Player 2 ID"],r["Player 3 ID"],r["Player 4 ID"]].filter(Boolean).join(" / "))+'</td><td>'+esc(r.Result)+'</td></tr>').join("") + '</tbody></table></div>' + (stagedRows.length>10?'<p class="admin-small-help">Showing first 10 rows; all '+stagedRows.length+' rows will be submitted for server-side validation.</p>':"");
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
      const data = await post({action:"bulkimport",rows:stagedRows});
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
  $("#admin-download-template").addEventListener("click", () => {
    const wb = XLSX.utils.book_new();
    const results = XLSX.utils.aoa_to_sheet([["Match ID","Match Date","Sport","Format","Player 1 ID","Player 2 ID","Player 3 ID","Player 4 ID","Score 1","Score 2","Result","Status","Notes"]]);
    XLSX.utils.book_append_sheet(wb,results,"Results");
    const guide = XLSX.utils.aoa_to_sheet([
      ["SRGF Sports bulk match upload instructions"],
      ["Use one row per match in the Results sheet."],
      ["Match ID is required and must be unique within the uploaded file. Existing Match IDs update matching records; new IDs create matches."],
      ["Sport values: TT, PB, Bad or LT. Format values: Singles or Doubles."],
      ["Player 1 ID and Player 2 ID are required. Doubles also requires Player 3 ID and Player 4 ID."],
      ["All Player IDs must already exist and be active in SPORTS_PLAYERS. Members are never created automatically."],
      ["Result: Side 1 Win, Side 2 Win or Draw. Status: Completed or Pending."],
      ["You may leave Result blank if both scores are supplied; the system may derive the result from scores."],
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
      $("#admin-confirm-upload").disabled = true;
      stagedRows = [];
      return;
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
  toggleDoubles();
})();