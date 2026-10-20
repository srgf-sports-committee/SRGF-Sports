/************************************************************
 SRGF SPORTS — EVENT DIRECTORY + RANKING BACKEND
 Independent from the SRGF Racketlon backend.
 Existing event-directory/admin-auth behavior is retained.

 Required tabs:
   EVENTS, SPORTS_ADMINS, SPORTS_PLAYERS
   TT-Match, TT-Rating, TT-RatingHistory
   PB-Match, PB-Rating, PB-RatingHistory
   Bad-Match, Bad-Rating, Bad-RatingHistory
   LT-Match, LT-Rating, LT-RatingHistory

 Public GETs are read-only. Every POST requires an approved
 Google ID token and active ADMIN row in SPORTS_ADMINS.
************************************************************/

const SPORTS_VERSION = "1.4.0";
const SPORT_MAP_ = {
  TT:  { name: "Table Tennis",     prefix: "TT"  },
  PB:  { name: "Pickleball",       prefix: "PB"  },
  BAD: { name: "Badminton",        prefix: "Bad" },
  LT:  { name: "Lawn Tennis",      prefix: "LT"  }
};
const MATCH_HEADERS_ = [
  "Match ID", "Match Date", "Format",
  "Player 1 ID", "Player 1 Name", "Player 2 ID", "Player 2 Name",
  "Player 3 ID", "Player 3 Name", "Player 4 ID", "Player 4 Name",
  "Score 1", "Score 2", "Result", "Status", "Notes", "Created At", "Updated At"
];
const RATING_HEADERS_ = [
  "Player ID", "Player Name",
  "Singles Elo", "Singles Matches", "Singles Wins", "Singles Losses", "Singles Draws",
  "Doubles Elo", "Doubles Matches", "Doubles Wins", "Doubles Losses", "Doubles Draws",
  "Last Updated"
];
const HISTORY_HEADERS_ = [
  "Snapshot ID", "Match ID", "Match Date", "Player ID", "Player Name",
  "Format", "Opponent(s)", "Result", "Elo Before", "Elo Change", "Elo After",
  "Rank Before", "Rank After", "Recorded At"
];

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
function getDirectory_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPORTS_SPREADSHEET_ID");
  if (!id) throw new Error("SPORTS_SPREADSHEET_ID is not configured.");
  return SpreadsheetApp.openById(id);
}
function text_(v) { return String(v == null ? "" : v).trim(); }
function upper_(v) { return text_(v).toUpperCase(); }
function rowObjects_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0].map(h => text_(h));
  return { headers, rows: values.slice(1).filter(r => r.some(c => text_(c) !== ""))
    .map(r => { const o = {}; headers.forEach((h,i) => { if (h) o[h] = r[i] || ""; }); return o; }) };
}
function requireSheet_(ss, name, expectedHeaders) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Required tab "' + name + '" not found.');
  const actual = sheet.getRange(1,1,1,Math.max(1,sheet.getLastColumn())).getDisplayValues()[0]
    .map(h => text_(h)).filter((h,i,a) => h || i < expectedHeaders.length);
  const missing = expectedHeaders.filter(h => !actual.includes(h));
  if (missing.length) throw new Error('Tab "' + name + '" is missing required header(s): ' + missing.join(", "));
  return sheet;
}
function sportInfo_(value) {
  const s = upper_(value).replace(/[^A-Z]/g, "");
  if (s === "TT" || s === "TABLETENNIS") return SPORT_MAP_.TT;
  if (s === "PB" || s === "PICKLEBALL") return SPORT_MAP_.PB;
  if (s === "BAD" || s === "BADMINTON") return SPORT_MAP_.BAD;
  if (s === "LT" || s === "LAWNTENNIS" || s === "TENNIS") return SPORT_MAP_.LT;
  throw new Error('Unknown sport "' + text_(value) + '". Use TT, PB, Bad or LT.');
}
function matchSheetName_(sport) { return sport.prefix + "-Match"; }
function ratingSheetName_(sport) { return sport.prefix + "-Rating"; }
function historySheetName_(sport) { return sport.prefix + "-RatingHistory"; }
function ensureSchema_(ss, sport) {
  requireSheet_(ss, matchSheetName_(sport), MATCH_HEADERS_);
  requireSheet_(ss, ratingSheetName_(sport), RATING_HEADERS_);
  requireSheet_(ss, historySheetName_(sport), HISTORY_HEADERS_);
  requireSheet_(ss, "SPORTS_PLAYERS", ["Player ID","Player Name","Active","Created At"]);
}
function dateValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = text_(value);
  if (!s) return new Date();
  // Accept ISO dates and common spreadsheet date strings.
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error('Invalid Match Date "' + s + '". Use YYYY-MM-DD.');
  return d;
}
function dateIso_(value) {
  const d = dateValue_(value);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || "Asia/Kolkata", "yyyy-MM-dd");
}
function getPlayers_(ss, includeInactive) {
  const sheet = requireSheet_(ss, "SPORTS_PLAYERS", ["Player ID","Player Name","Active","Created At"]);
  const range = sheet.getDataRange();
  const display = range.getDisplayValues();
  const rich = range.getRichTextValues();
  const headers = (display[0] || []).map(h => text_(h));
  const column = {};
  headers.forEach((h, i) => { if (h) column[upper_(h)] = i; });
  const cell = (row, ...names) => {
    for (const name of names) {
      const index = column[upper_(name)];
      if (index != null && text_(row[index]) !== "") return text_(row[index]);
    }
    return "";
  };
  const byId = {};
  display.slice(1).forEach((row, rowIndex) => {
    const id = upper_(cell(row, "Player ID"));
    if (!id) return;
    const activeText = upper_(cell(row, "Active"));
    const active = activeText !== "FALSE" && activeText !== "NO" && activeText !== "INACTIVE";
    const photoIndex = column.PHOTO != null ? column.PHOTO
      : column.IMAGE != null ? column.IMAGE
      : column["PLAYER PHOTO"] != null ? column["PLAYER PHOTO"] : null;
    let photo = photoIndex == null ? "" : text_(row[photoIndex]);
    // If the cell displays a label (for example, "View photo") instead of its URL,
    // read the underlying Google Sheets hyperlink target.
    if (photoIndex != null && (!/^https?:\/\//i.test(photo) || /^(photo|view photo|image)$/i.test(photo))) {
      try {
        const richCell = rich[rowIndex + 1][photoIndex];
        const link = richCell && richCell.getLinkUrl();
        if (link) photo = link;
      } catch (_) {}
    }
    byId[id] = {
      id, name: cell(row, "Player Name"), active,
      Gender: cell(row, "Gender", "Sex"),
      "Date of Birth": cell(row, "Date of Birth", "DOB", "Birth Date", "Birthdate"),
      Age: cell(row, "Age"),
      Photo: photo,
      "Git Photo URL": cell(row, "Git Photo URL", "Photo Git URL")
    };
  });
  return Object.keys(byId).map(id => byId[id]).filter(p => includeInactive || p.active);
}
function playerMap_(ss, includeInactive) {
  const map = {};
  getPlayers_(ss, includeInactive).forEach(p => { map[p.id] = p; });
  return map;
}
function validatePlayerId_(map, value, rowLabel) {
  const id = upper_(value);
  if (!id) throw new Error(rowLabel + " Player ID is required.");
  if (!map[id]) throw new Error(rowLabel + ' Player ID "' + id + '" was not found in SPORTS_PLAYERS or is inactive. Add/activate the member manually, then retry.');
  if (!map[id].name) throw new Error('Player ID "' + id + '" has no Player Name in SPORTS_PLAYERS.');
  return map[id];
}
function readMatchRows_(ss, sport) {
  const sheet = requireSheet_(ss, matchSheetName_(sport), MATCH_HEADERS_);
  const vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  const headers = vals[0].map(h => text_(h));
  return vals.slice(1).map((r, index) => {
    const o = {}; headers.forEach((h,i) => { if (h) o[h] = r[i]; });
    o.__row = index + 2;
    return o;
  }).filter(o => text_(o["Match ID"]));
}
function findMatchIndex_(rows, id) {
  return rows.findIndex(r => upper_(r["Match ID"]) === upper_(id));
}
function nextMatchId_(ss, sport) {
  const prefix = sport.prefix.toUpperCase() + "-" +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Kolkata", "yyyyMMdd") + "-";
  const rows = readMatchRows_(ss, sport);
  let max = 0;
  rows.forEach(r => {
    const id = upper_(r["Match ID"]);
    if (id.indexOf(prefix) === 0) {
      const n = parseInt(id.slice(prefix.length), 10);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  });
  return prefix + String(max + 1).padStart(4, "0");
}
function normalFormat_(value) {
  const f = upper_(value);
  if (f === "SINGLES" || f === "SINGLE") return "Singles";
  if (f === "DOUBLES" || f === "DOUBLE") return "Doubles";
  throw new Error('Format must be "Singles" or "Doubles".');
}
function normalStatus_(value) {
  const s = upper_(value || "COMPLETED");
  if (s === "COMPLETED" || s === "COMPLETE") return "Completed";
  if (s === "PENDING" || s === "SCHEDULED") return "Pending";
  throw new Error('Status must be "Completed" or "Pending".');
}
function normalResult_(value, score1, score2, status) {
  let r = text_(value);
  if (!r && score1 !== "" && score2 !== "" && status === "Completed") {
    const a = Number(score1), b = Number(score2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Scores must be numeric.");
    r = a > b ? "Side 1 Win" : a < b ? "Side 2 Win" : "Draw";
  }
  const k = upper_(r).replace(/[^A-Z0-9]/g, "");
  if (!r && status === "Pending") return "";
  if (["SIDE1WIN","PLAYER1WIN","TEAM1WIN","1"].includes(k)) return "Side 1 Win";
  if (["SIDE2WIN","PLAYER2WIN","TEAM2WIN","2"].includes(k)) return "Side 2 Win";
  if (["DRAW","TIE"].includes(k)) return "Draw";
  throw new Error('Result must be "Side 1 Win", "Side 2 Win" or "Draw".');
}
function normaliseMatch_(ss, sport, input, players, existing) {
  const m = input || {};
  const id = text_(m["Match ID"] || m.matchId || (existing && existing["Match ID"]));
  const format = normalFormat_(m.Format || m.format || (existing && existing.Format));
  const status = normalStatus_(m.Status || m.status || (existing && existing.Status) || "Completed");
  const date = dateIso_(m["Match Date"] || m.matchDate || m.date || (existing && existing["Match Date"]));
  const p1 = validatePlayerId_(players, m["Player 1 ID"] || m.player1Id || (existing && existing["Player 1 ID"]), "Player 1");
  const p2 = validatePlayerId_(players, m["Player 2 ID"] || m.player2Id || (existing && existing["Player 2 ID"]), "Player 2");
  let p3 = null, p4 = null;
  const id3 = text_(m["Player 3 ID"] || m.player3Id || (existing && existing["Player 3 ID"]));
  const id4 = text_(m["Player 4 ID"] || m.player4Id || (existing && existing["Player 4 ID"]));
  if (format === "Doubles") {
    p3 = validatePlayerId_(players, id3, "Player 3");
    p4 = validatePlayerId_(players, id4, "Player 4");
  } else if (id3 || id4) {
    throw new Error("Singles matches must leave Player 3 ID and Player 4 ID blank.");
  }
  const ids = [p1.id,p2.id].concat(format === "Doubles" ? [p3.id,p4.id] : []);
  if (new Set(ids).size !== ids.length) throw new Error("The same player cannot appear twice in one match.");
  const score1 = text_(m["Score 1"] != null ? m["Score 1"] : m.score1);
  const score2 = text_(m["Score 2"] != null ? m["Score 2"] : m.score2);
  if ((score1 !== "" && !Number.isFinite(Number(score1))) || (score2 !== "" && !Number.isFinite(Number(score2)))) {
    throw new Error("Scores must be numeric.");
  }
  const result = normalResult_(m.Result || m.result, score1, score2, status);
  if (status === "Completed" && !result) throw new Error("Completed matches require a result.");
  return [
    id, date, format,
    p1.id,p1.name,p2.id,p2.name,
    p3 ? p3.id : "",p3 ? p3.name : "",p4 ? p4.id : "",p4 ? p4.name : "",
    score1,score2,result,status,text_(m.Notes || m.notes || (existing && existing.Notes) || ""),
    (existing && existing["Created At"]) || new Date(), new Date()
  ];
}
function matchObject_(headers, row) {
  const o = {}; headers.forEach((h,i) => { if (h) o[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
  return o;
}

/**
 * Existing public event-directory endpoint plus read-only ranking APIs.
 * Examples: ?action=players, ?action=rankings, ?action=matches&sport=TT
 */
function doGet(e) {
  try {
    const action = String(e && e.parameter && e.parameter.action || "events").toLowerCase();
    const ss = getDirectory_();
    if (action === "ping") return json_({ok:true, service:"SRGF Sports Event Directory and Rankings", version:SPORTS_VERSION});
    if (action === "events") {
      const sheet = ss.getSheetByName("EVENTS");
      if (!sheet) throw new Error("EVENTS tab not found.");
      const values = sheet.getDataRange().getDisplayValues();
      if (values.length < 2) return json_({ok:true, events:[]});
      const headers = values[0].map(h => text_(h));
      const events = values.slice(1).filter(r => r.some(c => text_(c) !== ""))
        .map(row => { const item={}; headers.forEach((h,i)=>{if(h)item[h]=row[i]||"";}); return item; })
        .filter(x => text_(x["Event ID"]));
      return json_({ok:true,events});
    }
    if (action === "players") {
      return json_({ok:true,players:getPlayers_(ss,false).map(p=>({
        "Player ID":p.id, "Player Name":p.name, Active:true,
        Gender:p.Gender, "Date of Birth":p["Date of Birth"], Age:p.Age, Photo:p.Photo, "Git Photo URL":p["Git Photo URL"]
      }))});
    }
    if (action === "photo") {
      const fileId = text_(e && e.parameter && (e.parameter.id || e.parameter.fileId));
      if (!/^[A-Za-z0-9_-]{5,200}$/.test(fileId)) throw new Error("A valid Google Drive photo file ID is required.");
      const file = DriveApp.getFileById(fileId);
      const blob = file.getBlob();
      const mimeType = String(blob.getContentType() || "");
      if (!/^image\//i.test(mimeType)) throw new Error("The selected Photo file is not an image.");
      return json_({ok:true,mimeType,base64:Utilities.base64Encode(blob.getBytes())});
    }
    if (action === "rankings") {
      const sports = [];
      Object.keys(SPORT_MAP_).forEach(code => {
        const sport = SPORT_MAP_[code];
        const sh = ss.getSheetByName(ratingSheetName_(sport));
        if (!sh) return;
        const vals = sh.getDataRange().getDisplayValues();
        const headers = vals.length ? vals[0] : [];
        const rows = vals.slice(1).filter(r=>r.some(c=>text_(c)!==""));
        // Keep the homepage's existing {sports:[{name,sheetName,headers,rows}]} contract.
        sports.push({name:sport.name, code:code, sheetName:ratingSheetName_(sport), headers, rows});
      });
      return json_({ok:true,sports});
    }
    if (action === "matches" || action === "matchhistory") {
      const sport = sportInfo_(e && e.parameter && e.parameter.sport);
      ensureSchema_(ss,sport);
      const rows = readMatchRows_(ss,sport).map(r=>{
        const o={}; MATCH_HEADERS_.forEach(h=>{let v=r[h]; if(v instanceof Date)v=Utilities.formatDate(v,Session.getScriptTimeZone()||"Asia/Kolkata","yyyy-MM-dd"); o[h]=v==null?"":v;});
        return o;
      }).sort((a,b)=>String(b["Match Date"]).localeCompare(String(a["Match Date"])));
      return json_({ok:true,sport:sport.name,matches:rows});
    }
    if (action === "ratinghistory") {
      // Public, read-only history feed for the Player View chart.
      // An optional sport filter limits the response; otherwise all four
      // sports are returned so the UI can compare ratings on one timeline.
      const requestedSport = text_(e && e.parameter && e.parameter.sport);
      const requestedFormat = upper_(e && e.parameter && e.parameter.format);
      const selected = requestedSport && upper_(requestedSport) !== "ALL"
        ? [{code: upper_(requestedSport), sport: sportInfo_(requestedSport)}]
        : Object.keys(SPORT_MAP_).map(code => ({code, sport: SPORT_MAP_[code]}));
      const history = [];
      selected.forEach(item => {
        const sheet = ss.getSheetByName(historySheetName_(item.sport));
        if (!sheet) return;
        const values = sheet.getDataRange().getDisplayValues();
        if (!values.length) return;
        const headers = values[0].map(h => text_(h));
        const missing = HISTORY_HEADERS_.filter(h => !headers.includes(h));
        if (missing.length) throw new Error('Tab "' + historySheetName_(item.sport) + '" is missing required header(s): ' + missing.join(", "));
        values.slice(1).filter(r => r.some(v => text_(v) !== "")).forEach(row => {
          const itemRow = {};
          headers.forEach((header, i) => { if (header) itemRow[header] = row[i] || ""; });
          if (requestedFormat && requestedFormat !== "ALL" && upper_(itemRow.Format) !== requestedFormat) return;
          itemRow["Sport Code"] = item.code;
          itemRow.Sport = item.sport.name;
          history.push(itemRow);
        });
      });
      history.sort((a,b) => String(a["Match Date"]).localeCompare(String(b["Match Date"])) ||
        String(a["Recorded At"]).localeCompare(String(b["Recorded At"])));
      return json_({ok:true,history});
    }
    if (action === "playerhistory") {
      const sport = sportInfo_(e && e.parameter && e.parameter.sport);
      const playerId = upper_(e && e.parameter && e.parameter.playerId);
      if (!playerId) throw new Error("playerId is required.");
      const sheet = requireSheet_(ss,historySheetName_(sport),HISTORY_HEADERS_);
      const vals = sheet.getDataRange().getDisplayValues();
      const headers = vals[0].map(h=>text_(h));
      const rows = vals.slice(1).filter(r=>upper_(r[headers.indexOf("Player ID")])===playerId)
        .map(r=>{const o={};headers.forEach((h,i)=>o[h]=r[i]||"");return o;});
      return json_({ok:true,sport:sport.name,playerId,history:rows});
    }
    throw new Error("Unknown action.");
  } catch(err) {
    return json_({ok:false,error:String(err.message||err)});
  }
}

/** Validates the Google ID token and independent SPORTS_ADMINS allowlist. */
function verifySportsAdmin_(token) {
  if (!token) throw new Error("Google sign-in is required.");
  const clientId = PropertiesService.getScriptProperties().getProperty("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientId) throw new Error("Google OAuth client ID is not configured.");
  const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token="+encodeURIComponent(token),{muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw new Error("Google sign-in token is invalid or expired.");
  const identity = JSON.parse(response.getContentText());
  if (identity.aud !== clientId) throw new Error("Google sign-in audience does not match.");
  if (String(identity.email_verified).toLowerCase() !== "true") throw new Error("A verified Google email is required.");
  const email = text_(identity.email).toLowerCase();
  if (!email) throw new Error("Google account email was not provided.");
  const sheet = getDirectory_().getSheetByName("SPORTS_ADMINS");
  if (!sheet) throw new Error("SPORTS_ADMINS tab not found.");
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) throw new Error("No administrators configured.");
  const headers = data[0].map(h=>text_(h).toLowerCase());
  const emailCol=headers.indexOf("email"), roleCol=headers.indexOf("role"), activeCol=headers.indexOf("active");
  if(emailCol<0||roleCol<0||activeCol<0) throw new Error("Admin sheet must contain Email, Role and Active.");
  const allowed=data.slice(1).some(r=>text_(r[emailCol]).toLowerCase()===email && upper_(r[roleCol])==="ADMIN" && upper_(r[activeCol])==="TRUE");
  if(!allowed) throw new Error("You are not an SRGF Sports admin.");
  return email;
}
function writeMatch_(ss,sport,input,players) {
  const sheet=requireSheet_(ss,matchSheetName_(sport),MATCH_HEADERS_);
  const rows=readMatchRows_(ss,sport);
  let id=text_(input["Match ID"]||input.matchId);
  let existing=null;
  if(id) {
    const idx=findMatchIndex_(rows,id);
    if(idx>=0) existing=rows[idx];
  }
  if(!id) id=nextMatchId_(ss,sport);
  const dup=findMatchIndex_(rows,id);
  if(dup>=0) existing=rows[dup];
  const inputWithId=Object.assign({},input,{"Match ID":id});
  const values=normaliseMatch_(ss,sport,inputWithId,players,existing);
  const rowIndex=existing ? existing.__row : 0;
  if(rowIndex) sheet.getRange(rowIndex,1,1,MATCH_HEADERS_.length).setValues([values]);
  else sheet.appendRow(values);
  return {matchId:id,updated:!!rowIndex};
}
function eloExpected_(ratingA,ratingB) { return 1/(1+Math.pow(10,(ratingB-ratingA)/400)); }
function rankMap_(state,format) {
  const entries=Object.keys(state).map(id=>({id,elo:state[id][format].elo, name:state[id].name}));
  entries.sort((a,b)=>b.elo-a.elo || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const out={}; entries.forEach((e,i)=>out[e.id]=i+1); return out;
}
function freshState_(players) {
  const state={};
  Object.keys(players).forEach(id=>state[id]={id,name:players[id].name,
    Singles:{elo:1000,matches:0,wins:0,losses:0,draws:0},
    Doubles:{elo:1000,matches:0,wins:0,losses:0,draws:0}});
  return state;
}
function replaySport_(ss,sport) {
  ensureSchema_(ss,sport);
  const players=playerMap_(ss,true);
  const allMatches=readMatchRows_(ss,sport).map(m=>{
    const date = m["Match Date"] instanceof Date ? m["Match Date"] : dateValue_(m["Match Date"]);
    return Object.assign({},m,{__date:date});
  }).sort((a,b)=>a.__date.getTime()-b.__date.getTime() ||
    new Date(a["Created At"]||0).getTime()-new Date(b["Created At"]||0).getTime() ||
    String(a["Match ID"]).localeCompare(String(b["Match ID"])));
  const state=freshState_(players), history=[];
  allMatches.forEach(match=>{
    if(upper_(match.Status)!=="COMPLETED") return;
    const format=normalFormat_(match.Format);
    const ids=format==="Singles" ? [upper_(match["Player 1 ID"]),upper_(match["Player 2 ID"])] :
      [upper_(match["Player 1 ID"]),upper_(match["Player 2 ID"]),upper_(match["Player 3 ID"]),upper_(match["Player 4 ID"])];
    ids.forEach(id=>{if(!state[id]) throw new Error('Match '+match["Match ID"]+' references unknown Player ID "'+id+'".');});
    if(new Set(ids).size!==ids.length) throw new Error('Match '+match["Match ID"]+' has duplicate player IDs.');
    const team1=format==="Singles"?[ids[0]]:[ids[0],ids[1]];
    const team2=format==="Singles"?[ids[1]]:[ids[2],ids[3]];
    const beforeRanks=rankMap_(state,format);
    const before={}; ids.forEach(id=>before[id]=state[id][format].elo);
    const avg1=team1.reduce((s,id)=>s+state[id][format].elo,0)/team1.length;
    const avg2=team2.reduce((s,id)=>s+state[id][format].elo,0)/team2.length;
    const expected1=eloExpected_(avg1,avg2);
    const result=normalResult_(match.Result,match["Score 1"],match["Score 2"],"Completed");
    const actual1=result==="Side 1 Win"?1:result==="Side 2 Win"?0:0.5;
    const actual2=1-actual1;
    // K is calculated individually: 40 for each player's first 10 completed
    // matches in this format, then 20. Doubles partners can have different K values.
    team1.forEach(id=>{
      const playerState=state[id][format];
      const k=playerState.matches<10?40:20;
      playerState.elo+=k*(actual1-expected1);
      playerState.matches++;
      if(actual1===1)playerState.wins++;else if(actual1===0)playerState.losses++;else playerState.draws++;
    });
    team2.forEach(id=>{
      const playerState=state[id][format];
      const k=playerState.matches<10?40:20;
      playerState.elo+=k*(actual2-eloExpected_(avg2,avg1));
      playerState.matches++;
      if(actual2===1)playerState.wins++;else if(actual2===0)playerState.losses++;else playerState.draws++;
    });
    const afterRanks=rankMap_(state,format);
    const namesById={}; ids.forEach(id=>namesById[id]=state[id].name);
    ids.forEach(id=>{
      const myTeam=team1.includes(id)?team1:team2;
      const oppTeam=team1.includes(id)?team2:team1;
      const playerResult=(team1.includes(id)?actual1:actual2)===1?"Win":(team1.includes(id)?actual1:actual2)===0?"Loss":"Draw";
      history.push([
        text_(match["Match ID"])+"-"+id, text_(match["Match ID"]), dateIso_(match.__date),
        id,state[id].name,format,oppTeam.map(x=>namesById[x]).join(" + "),playerResult,
        round2_(before[id]),round2_(state[id][format].elo-before[id]),round2_(state[id][format].elo),
        beforeRanks[id]||"",afterRanks[id]||"",new Date()
      ]);
    });
  });
  const now=new Date();
  const ratingRows=Object.keys(state).map(id=>{
    const p=state[id], s=p.Singles, d=p.Doubles;
    return [id,p.name,round2_(s.elo),s.matches,s.wins,s.losses,s.draws,
      round2_(d.elo),d.matches,d.wins,d.losses,d.draws,now];
  }).sort((a,b)=>Number(b[2])-Number(a[2]) || String(a[1]).localeCompare(String(b[1])));
  const ratingSheet=requireSheet_(ss,ratingSheetName_(sport),RATING_HEADERS_);
  replaceBody_(ratingSheet,RATING_HEADERS_.length,ratingRows);
  const historySheet=requireSheet_(ss,historySheetName_(sport),HISTORY_HEADERS_);
  replaceBody_(historySheet,HISTORY_HEADERS_.length,history);
  return {sport:sport.name,players:ratingRows.length,completedMatches:allMatches.filter(m=>upper_(m.Status)==="COMPLETED").length,historyRows:history.length};
}
function round2_(n) { return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function replaceBody_(sheet,width,rows) {
  const last=sheet.getLastRow();
  if(last>1) sheet.getRange(2,1,last-1,Math.max(width,sheet.getLastColumn())).clearContent();
  if(rows.length) sheet.getRange(2,1,rows.length,width).setValues(rows);
}
function saveOneMatch_(ss,body) {
  const sport=sportInfo_(body.sport || body.Sport);
  ensureSchema_(ss,sport);
  const players=playerMap_(ss,false);
  const match=body.match || body;
  const saved=writeMatch_(ss,sport,match,players);
  const recalculation=replaySport_(ss,sport);
  return {ok:true,message:saved.updated?"Match updated and ratings recalculated.":"Match saved and ratings recalculated.",sport:sport.name,matchId:saved.matchId,updated:saved.updated,recalculation};
}
function bulkImport_(ss,body) {
  const rows=Array.isArray(body.rows)?body.rows:[];
  if(!rows.length) throw new Error("Upload contains no match rows.");
  if(rows.length>500) throw new Error("Upload a maximum of 500 match rows at a time.");
  const players=playerMap_(ss,false), prepared=[], errors=[], seen={};
  rows.forEach((raw,i)=>{
    const line=Number(raw.__rowNumber||raw.rowNumber||i+2);
    try {
      const row=raw || {};
      const sport=sportInfo_(row.Sport||row.sport);
      ensureSchema_(ss,sport);
      const id=text_(row["Match ID"]||row.matchId);
      if(!id) throw new Error("Match ID is required for bulk uploads so repeating the same file cannot create duplicate matches.");
      const key=sport.prefix+"|"+upper_(id);
      if(seen[key]) throw new Error('Duplicate Match ID "'+id+'" in this upload.');
      seen[key]=true;
      const existingRows=readMatchRows_(ss,sport);
      const ix=findMatchIndex_(existingRows,id);
      const existing=ix>=0?existingRows[ix]:null;
      const values=normaliseMatch_(ss,sport,row,players,existing);
      prepared.push({sport,id,values,existing});
    } catch(err) { errors.push({row:line,error:String(err.message||err)}); }
  });
  if(errors.length) return {ok:false,error:"No rows were imported because validation found errors.",imported:0,errors};
  // All rows validate before any sheet is changed.
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const changedSports={}, counts={inserted:0,updated:0};
    prepared.forEach(item=>{
      const sheet=requireSheet_(ss,matchSheetName_(item.sport),MATCH_HEADERS_);
      if(item.existing) {
        sheet.getRange(item.existing.__row,1,1,MATCH_HEADERS_.length).setValues([item.values]);
        counts.updated++;
      } else {
        sheet.appendRow(item.values);
        counts.inserted++;
      }
      changedSports[item.sport.prefix]=item.sport;
    });
    const recalculations=Object.keys(changedSports).map(k=>replaySport_(ss,changedSports[k]));
    return {ok:true,message:"Bulk results imported successfully.",imported:prepared.length,inserted:counts.inserted,updated:counts.updated,recalculations};
  } finally { lock.releaseLock(); }
}


function syncPlayerPhotosToGit_(ss) {
  const props = PropertiesService.getScriptProperties();
  const token = text_(props.getProperty("SRGF_GITHUB_TOKEN"));
  if (!token) throw new Error("GitHub sync is not configured. Add SRGF_GITHUB_TOKEN in Apps Script Project Settings → Script properties. Use a fine-grained token limited to SRGF-Sports with Contents read/write.");
  const repo = "srgf-sports-committee/SRGF-Sports";
  const branch = text_(props.getProperty("SRGF_GITHUB_BRANCH")) || "main";
  const sheet = requireSheet_(ss, "SPORTS_PLAYERS", ["Player ID","Player Name","Active","Created At"]);
  let values = sheet.getDataRange().getDisplayValues();
  let rich = sheet.getDataRange().getRichTextValues();
  let headers = values[0].map(h => text_(h));
  const col = name => headers.findIndex(h => upper_(h) === upper_(name));
  const idCol = col("Player ID");
  let sourceCol = col("Photo");
  if (sourceCol < 0) sourceCol = col("Image");
  if (sourceCol < 0) sourceCol = col("Player Photo");
  if (sourceCol < 0) throw new Error('SPORTS_PLAYERS needs a "Photo" column containing each source Google Drive link.');
  let gitCol = col("Git Photo URL");
  if (gitCol < 0) {
    gitCol = headers.length;
    sheet.getRange(1, gitCol + 1).setValue("Git Photo URL");
    headers.push("Git Photo URL");
    values = sheet.getDataRange().getDisplayValues();
    rich = sheet.getDataRange().getRichTextValues();
  }
  const extractDriveId = value => {
    const s = text_(value);
    const match = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*?&)?id=)([A-Za-z0-9_-]+)/i) || s.match(/[?&]id=([A-Za-z0-9_-]+)/i);
    if (match) return match[1];
    return /^[A-Za-z0-9_-]{15,200}$/.test(s) ? s : "";
  };
  const githubRequest = (url, method, payload) => {
    const options = {
      method: method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      muteHttpExceptions: true
    };
    if (payload) {
      options.contentType = "application/json";
      options.payload = JSON.stringify(payload);
    }
    return UrlFetchApp.fetch(url, options);
  };
  const summary = {synced:0, unchanged:0, skipped:0, errors:[]};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {ok:true,message:"No player rows found.",summary};
  if (lastRow - 1 > 250) throw new Error("Safety limit: sync up to 250 player photos per run. Split a larger library into batches.");
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const playerId = text_(row[idCol]);
    if (!playerId) continue;
    const cell = rich[r] && rich[r][sourceCol];
    let source = text_(row[sourceCol]);
    if ((!/^https?:\/\//i.test(source) || /^(photo|view photo|image)$/i.test(source)) && cell) {
      try { source = text_(cell.getLinkUrl()) || source; } catch (_) {}
    }
    const fileId = extractDriveId(source);
    if (!fileId) {
      summary.skipped++;
      if (source) summary.errors.push(playerId + ": Photo cell is not a Google Drive file link.");
      continue;
    }
    try {
      const file = DriveApp.getFileById(fileId);
      const blob = file.getBlob();
      const mime = String(blob.getContentType() || "").toLowerCase();
      const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : mime === "image/avif" ? "avif" : "";
      if (!ext) throw new Error("Unsupported photo type " + (mime || "(unknown)") + "; use JPEG, PNG, WEBP, GIF or AVIF.");
      const safeId = playerId.replace(/[^A-Za-z0-9_-]/g, "_");
      const path = "assets/player-photos/" + safeId + "." + ext;
      const apiUrl = "https://api.github.com/repos/" + repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(branch);
      const imageBase64 = Utilities.base64Encode(blob.getBytes());
      const existingResponse = githubRequest(apiUrl, "get");
      let existingSha = "";
      if (existingResponse.getResponseCode() === 200) {
        const existing = JSON.parse(existingResponse.getContentText());
        existingSha = text_(existing.sha);
        const oldContent = text_(existing.content).replace(/\s/g, "");
        if (oldContent && oldContent === imageBase64) {
          const publicUrl = "https://srgf-sports-committee.github.io/SRGF-Sports/" + path;
          sheet.getRange(r + 1, gitCol + 1).setValue(publicUrl);
          summary.unchanged++;
          continue;
        }
      } else if (existingResponse.getResponseCode() !== 404) {
        throw new Error("GitHub check failed (" + existingResponse.getResponseCode() + "): " + existingResponse.getContentText().slice(0, 240));
      }
      const payload = {
        message: "Sync player photo " + playerId + " from Google Drive",
        content: imageBase64,
        branch: branch
      };
      if (existingSha) payload.sha = existingSha;
      const upload = githubRequest("https://api.github.com/repos/" + repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/"), "put", payload);
      if (upload.getResponseCode() < 200 || upload.getResponseCode() >= 300) {
        throw new Error("GitHub upload failed (" + upload.getResponseCode() + "): " + upload.getContentText().slice(0, 240));
      }
      const publicUrl = "https://srgf-sports-committee.github.io/SRGF-Sports/" + path;
      sheet.getRange(r + 1, gitCol + 1).setValue(publicUrl);
      summary.synced++;
    } catch (err) {
      summary.errors.push(playerId + ": " + String(err.message || err));
    }
  }
  const message = "Photo sync complete: " + summary.synced + " uploaded, " + summary.unchanged + " already up to date, " + summary.skipped + " skipped, " + summary.errors.length + " error(s).";
  return {ok:true,message,summary};
}

function doPost(e) {
  try {
    const body=JSON.parse(e && e.postData && e.postData.contents || "{}");
    const action=text_(body.action).toLowerCase();
    const adminEmail=verifySportsAdmin_(body.idToken);
    if(action==="adminauth") return json_({ok:true,authorized:true,role:"ADMIN",email:adminEmail});
    const ss=getDirectory_();
    if(action==="syncplayerphotos") return json_(syncPlayerPhotosToGit_(ss));
    if(action==="setfeaturedevent") {
      const eventId=text_(body.eventId);
      if(!eventId) throw new Error("Choose an event to feature.");
      const sheet=ss.getSheetByName("EVENTS");
      if(!sheet) throw new Error("EVENTS tab not found.");
      const values=sheet.getDataRange().getDisplayValues();
      if(!values.length) throw new Error("EVENTS sheet has no header row.");
      const headers=values[0].map(h=>text_(h));
      const idCol=headers.indexOf("Event ID");
      if(idCol<0) throw new Error("Event ID column not found.");
      const selectedIndex=values.slice(1).findIndex(row=>text_(row[idCol])===eventId);
      if(selectedIndex<0) throw new Error("The selected event was not found. Refresh the Admin tab and try again.");
      let featuredCol=headers.indexOf("Featured");
      if(featuredCol<0) {
        featuredCol=sheet.getLastColumn();
        sheet.getRange(1,featuredCol+1).setValue("Featured");
      }
      const lastRow=sheet.getLastRow();
      if(lastRow>1) sheet.getRange(2,featuredCol+1,lastRow-1,1).setValue(false);
      sheet.getRange(selectedIndex+2,featuredCol+1).setValue(true);
      const updatedCol=headers.indexOf("Last Updated");
      if(updatedCol>=0) sheet.getRange(selectedIndex+2,updatedCol+1).setValue(new Date().toISOString());
      return json_({ok:true,message:"Featured Event saved. The Home page will now show the selected event."});
    }
    if(action==="saveevent") {
      const sheet=ss.getSheetByName("EVENTS");
      if(!sheet) throw new Error("EVENTS tab not found.");
      const event=body.event||{}, eventId=text_(event["Event ID"]), eventName=text_(event["Event Name"]);
      if(!eventId||!eventName) throw new Error("Event ID and Event Name are required.");
      const status=upper_(event.Status||"UPCOMING");
      if(!["UPCOMING","ARCHIVED"].includes(status)) throw new Error("Status must be UPCOMING or ARCHIVED.");
      const values=sheet.getDataRange().getDisplayValues(), headers=values[0].map(h=>text_(h)), idCol=headers.indexOf("Event ID");
      if(idCol<0) throw new Error("Event ID column not found.");
      const rowValues=headers.map(h=>h==="Created By"?adminEmail:h==="Last Updated"?new Date().toISOString():h==="Status"?status:(event[h]==null?"":event[h]));
      const existingIndex=values.slice(1).findIndex(r=>text_(r[idCol])===eventId);
      if(existingIndex>=0) {
        const targetRow=existingIndex+2, createdCol=headers.indexOf("Created By");
        if(createdCol>=0&&!rowValues[createdCol]) rowValues[createdCol]=values[targetRow-1][createdCol];
        sheet.getRange(targetRow,1,1,headers.length).setValues([rowValues]);
      } else sheet.appendRow(rowValues);
      return json_({ok:true,message:"Event saved."});
    }
    if(action==="archiveevent") {
      const eventId=text_(body.eventId);
      if(!eventId) throw new Error("Event ID is required.");
      const sheet=ss.getSheetByName("EVENTS");
      if(!sheet) throw new Error("EVENTS tab not found.");
      const values=sheet.getDataRange().getDisplayValues(), headers=values[0].map(h=>text_(h));
      const idCol=headers.indexOf("Event ID"), statusCol=headers.indexOf("Status"), updatedCol=headers.indexOf("Last Updated");
      if(idCol<0||statusCol<0) throw new Error("Event ID or Status column not found.");
      const index=values.slice(1).findIndex(r=>text_(r[idCol])===eventId);
      if(index<0) throw new Error("Event not found.");
      const target=index+2; sheet.getRange(target,statusCol+1).setValue("ARCHIVED");
      if(updatedCol>=0) sheet.getRange(target,updatedCol+1).setValue(new Date().toISOString());
      return json_({ok:true,message:"Event archived."});
    }
    if(action==="savematch") {
      const lock=LockService.getScriptLock(); lock.waitLock(30000);
      try { return json_(saveOneMatch_(ss,body)); } finally { lock.releaseLock(); }
    }
    if(action==="loadsampledata") return json_(loadSampleData_(ss));
    if(action==="removesampledata") return json_(removeSampleData_(ss));
    if(action==="bulkimport" || action==="bulkresults") return json_(bulkImport_(ss,body));
    if(action==="recalculaterankings") {
      const sport=sportInfo_(body.sport);
      const result=replaySport_(ss,sport);
      return json_({ok:true,message:"Ratings and history recalculated.",result});
    }
    if(action==="saverankings") {
      // The old homepage ranking editor is retained for non-system custom tabs only.
      // Automated rating and match tabs are protected from manual overwrites.
      const name=text_(body.sheetName);
      if(/^(TT|PB|Bad|LT)-(Match|Rating|RatingHistory)$/i.test(name) || ["SPORTS_PLAYERS","SPORTS_ADMINS","EVENTS"].includes(name.toUpperCase())) {
        throw new Error("This is a system-managed tab. Enter results through match entry or bulk upload; ratings are recalculated automatically.");
      }
      if(!/^[A-Za-z0-9 _-]{1,80}$/.test(name)) throw new Error("Invalid sheet name.");
      const sheet=ss.getSheetByName(name);
      if(!sheet) throw new Error('Sheet "'+name+'" not found.');
      const headers=Array.isArray(body.headers)?body.headers.map(text_):[];
      const rows=Array.isArray(body.rows)?body.rows:[];
      if(!headers.length) throw new Error("At least one column header is required.");
      if(headers.length>30||rows.length>1000) throw new Error("Ranking sheet update is too large.");
      sheet.clearContents();
      sheet.getRange(1,1,1,headers.length).setValues([headers]);
      if(rows.length) sheet.getRange(2,1,rows.length,headers.length).setValues(rows.map(r=>headers.map((_,i)=>r[i]==null?"":r[i])));
      return json_({ok:true,message:"Custom rankings saved."});
    }
    throw new Error("Unknown or unsupported admin action.");
  } catch(err) {
    return json_({ok:false,error:String(err.message||err)});
  }
}


function loadSampleData_(ss) {
  // Fictional profiles intentionally cover different age bands and both genders.
  // Some players appear in all four sports; others only appear in one or two.
  const demoPlayers = [
    {id:"SAMPLE-DEMO-001",name:"Demo Player One",gender:"Male",dob:"2014-05-12",sports:["TT","PB","BAD","LT"]},
    {id:"SAMPLE-DEMO-002",name:"Demo Player Two",gender:"Female",dob:"2011-09-24",sports:["TT","PB","BAD","LT"]},
    {id:"SAMPLE-DEMO-003",name:"Demo Player Three",gender:"Male",dob:"2006-02-18",sports:["TT","PB","BAD"]},
    {id:"SAMPLE-DEMO-004",name:"Demo Player Four",gender:"Female",dob:"2000-11-03",sports:["TT","PB","BAD","LT"]},
    {id:"SAMPLE-DEMO-005",name:"Demo Player Five",gender:"Male",dob:"1988-07-16",sports:["TT","LT"]},
    {id:"SAMPLE-DEMO-006",name:"Demo Player Six",gender:"Female",dob:"1972-01-29",sports:["TT","PB","LT"]},
    {id:"SAMPLE-DEMO-007",name:"Demo Player Seven",gender:"Male",dob:"1960-04-08",sports:["PB","BAD","LT"]},
    {id:"SAMPLE-DEMO-008",name:"Demo Player Eight",gender:"Female",dob:"1954-12-21",sports:["TT","BAD"]},
    {id:"SAMPLE-DEMO-009",name:"Demo Player Nine",gender:"Male",dob:"1994-06-02",sports:["TT","PB","BAD","LT"]},
    {id:"SAMPLE-DEMO-010",name:"Demo Player Ten",gender:"Female",dob:"1981-03-14",sports:["PB","BAD"]},
    {id:"SAMPLE-DEMO-011",name:"Demo Player Eleven",gender:"Male",dob:"2009-08-30",sports:["TT","BAD"]},
    {id:"SAMPLE-DEMO-012",name:"Demo Player Twelve",gender:"Female",dob:"1965-10-05",sports:["PB","LT"]}
  ];
  const ps = requireSheet_(ss,"SPORTS_PLAYERS",["Player ID","Player Name","Active","Created At"]);
  const playerTable = rowObjects_(ps);
  const playerHeaders = playerTable.headers;
  const known = playerMap_(ss,true);
  demoPlayers.forEach(p => {
    if (known[p.id] && known[p.id].name !== p.name) throw new Error("Demo ID conflict: "+p.id);
  });
  if (Object.keys(SPORT_MAP_).some(code => readMatchRows_(ss,SPORT_MAP_[code]).some(m => upper_(m["Match ID"]).indexOf("SAMPLE-")===0))) {
    throw new Error("Sample matches already exist. Remove them before loading again.");
  }
  const today = new Date();
  function ageFromDob_(iso) {
    const parts = iso.split("-").map(Number);
    let age = today.getFullYear() - parts[0];
    if (today.getMonth()+1 < parts[1] || (today.getMonth()+1 === parts[1] && today.getDate() < parts[2])) age--;
    return age;
  }
  demoPlayers.forEach(p => {
    if (known[p.id]) return;
    const values = playerHeaders.map(header => {
      const h = upper_(header);
      if (h === "PLAYER ID") return p.id;
      if (h === "PLAYER NAME") return p.name;
      if (h === "ACTIVE") return true;
      if (h === "CREATED AT") return new Date();
      if (h === "GENDER" || h === "SEX") return p.gender;
      if (h === "DATE OF BIRTH" || h === "DOB" || h === "BIRTH DATE" || h === "BIRTHDATE") return p.dob;
      if (h === "AGE") return ageFromDob_(p.dob);
      return "";
    });
    ps.appendRow(values);
  });

  const matchData = [
    {sport:"TT",date:"2026-10-01",format:"Singles",p1:1,p2:2,s1:11,s2:7,result:"Side 1 Win",note:"Sample TT singles win"},
    {sport:"TT",date:"2026-10-02",format:"Singles",p1:3,p2:4,s1:8,s2:11,result:"Side 2 Win",note:"Sample TT singles win for side 2"},
    {sport:"TT",date:"2026-10-03",format:"Doubles",p1:1,p2:5,p3:2,p4:6,s1:21,s2:18,result:"Side 1 Win",note:"Sample TT doubles"},
    {sport:"TT",date:"2026-10-04",format:"Singles",p1:9,p2:11,s1:10,s2:10,result:"Draw",note:"Sample TT draw"},
    {sport:"TT",date:"2026-10-05",format:"Doubles",p1:3,p2:8,p3:4,p4:9,s1:16,s2:21,result:"Side 2 Win",note:"Sample TT doubles loss"},
    {sport:"TT",date:"2026-10-06",format:"Singles",p1:1,p2:9,s1:11,s2:9,result:"Side 1 Win",note:"Sample TT singles"},
    {sport:"PB",date:"2026-10-01",format:"Singles",p1:2,p2:3,s1:15,s2:11,result:"Side 1 Win",note:"Sample pickleball singles"},
    {sport:"PB",date:"2026-10-02",format:"Doubles",p1:1,p2:4,p3:6,p4:7,s1:21,s2:19,result:"Side 1 Win",note:"Sample pickleball doubles"},
    {sport:"PB",date:"2026-10-03",format:"Singles",p1:7,p2:10,s1:8,s2:11,result:"Side 2 Win",note:"Sample pickleball singles"},
    {sport:"PB",date:"2026-10-04",format:"Doubles",p1:2,p2:12,p3:3,p4:9,s1:20,s2:20,result:"Draw",note:"Sample pickleball doubles draw"},
    {sport:"PB",date:"2026-10-05",format:"Singles",p1:6,p2:12,s1:11,s2:6,result:"Side 1 Win",note:"Sample pickleball singles"},
    {sport:"BAD",date:"2026-10-01",format:"Singles",p1:1,p2:3,s1:21,s2:17,result:"Side 1 Win",note:"Sample badminton singles"},
    {sport:"BAD",date:"2026-10-02",format:"Doubles",p1:2,p2:4,p3:9,p4:10,s1:18,s2:21,result:"Side 2 Win",note:"Sample badminton doubles"},
    {sport:"BAD",date:"2026-10-03",format:"Singles",p1:8,p2:11,s1:21,s2:21,result:"Draw",note:"Sample badminton draw"},
    {sport:"BAD",date:"2026-10-04",format:"Doubles",p1:3,p2:11,p3:4,p4:8,s1:21,s2:14,result:"Side 1 Win",note:"Sample badminton doubles"},
    {sport:"BAD",date:"2026-10-05",format:"Singles",p1:10,p2:2,s1:16,s2:21,result:"Side 2 Win",note:"Sample badminton singles"},
    {sport:"LT",date:"2026-10-01",format:"Singles",p1:5,p2:6,s1:6,s2:4,result:"Side 1 Win",note:"Sample lawn tennis singles"},
    {sport:"LT",date:"2026-10-02",format:"Doubles",p1:1,p2:4,p3:7,p4:12,s1:6,s2:6,result:"Draw",note:"Sample lawn tennis doubles draw"},
    {sport:"LT",date:"2026-10-03",format:"Singles",p1:9,p2:2,s1:3,s2:6,result:"Side 2 Win",note:"Sample lawn tennis singles"},
    {sport:"LT",date:"2026-10-04",format:"Doubles",p1:5,p2:6,p3:4,p4:9,s1:7,s2:5,result:"Side 1 Win",note:"Sample lawn tennis doubles"}
  ];

  const players = playerMap_(ss,false);
  let total = 0;
  const counts = {};
  Object.keys(SPORT_MAP_).forEach(code => {
    const sport = SPORT_MAP_[code];
    ensureSchema_(ss,sport);
    const fixtures = matchData.filter(m => sportInfo_(m.sport).prefix === sport.prefix);
    fixtures.forEach((m,index) => {
      const input = {
        "Match ID":"SAMPLE-"+sport.prefix+"-"+String(index+1).padStart(3,"0"),
        "Match Date":m.date, Format:m.format,
        "Player 1 ID":demoPlayers[m.p1-1].id, "Player 2 ID":demoPlayers[m.p2-1].id,
        "Player 3 ID":m.p3 ? demoPlayers[m.p3-1].id : "",
        "Player 4 ID":m.p4 ? demoPlayers[m.p4-1].id : "",
        "Score 1":m.s1, "Score 2":m.s2, Result:m.result,
        Status:"Completed", Notes:"SAMPLE DATA — "+m.note
      };
      writeMatch_(ss,sport,input,players);
      total++;
    });
    counts[sport.prefix] = fixtures.length;
  });
  const summaries = Object.keys(SPORT_MAP_).map(code => replaySport_(ss,SPORT_MAP_[code]));
  return {
    ok:true,
    message:"20 fictional sample matches loaded across four sports, with varied singles/doubles results, wins/losses/draws, age/gender profiles, and shared plus sport-specific players.",
    playersAdded:demoPlayers.filter(p=>!known[p.id]).length,
    demoProfiles:demoPlayers.length,
    matchesAdded:total,
    matchesBySport:counts,
    sports:summaries
  };
}
function removeSampleData_(ss) {
  let removed=0;
  Object.keys(SPORT_MAP_).forEach(code=>{
    const s=SPORT_MAP_[code],sh=requireSheet_(ss,matchSheetName_(s),MATCH_HEADERS_);
    readMatchRows_(ss,s).filter(m=>upper_(m["Match ID"]).indexOf("SAMPLE-")===0).sort((a,b)=>b.__row-a.__row).forEach(m=>{sh.deleteRow(m.__row);removed++;});
  });
  const ps=requireSheet_(ss,"SPORTS_PLAYERS",["Player ID","Player Name","Active","Created At"]),v=ps.getDataRange().getDisplayValues();
  for(let i=v.length-1;i>=1;i--)if(/^SAMPLE-DEMO-[0-9]+$/.test(upper_(v[i][0])))ps.deleteRow(i+1);
  const summaries=[];Object.keys(SPORT_MAP_).forEach(code=>summaries.push(replaySport_(ss,SPORT_MAP_[code])));
  return {ok:true,message:"Sample matches and demo players removed; ratings recalculated.",matchesRemoved:removed,sports:summaries};
}

/** Optional manual smoke test: run from Apps Script editor after setup. */
function testSportsSchema_() {
  const ss=getDirectory_();
  const results = [];
  Object.keys(SPORT_MAP_).forEach(code => {
    const sport = SPORT_MAP_[code];
    ensureSchema_(ss, sport);
    // Populate each rating tab with every registered player at 1000 Elo,
    // even before the first completed match is recorded.
    results.push(replaySport_(ss, sport));
  });
  return "All sports tabs validated and ratings initialized: " +
    results.map(r => r.sport + " (" + r.players + " players)").join(", ");
}