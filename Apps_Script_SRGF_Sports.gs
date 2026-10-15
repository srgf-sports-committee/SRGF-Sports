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

const SPORTS_VERSION = "1.1.0";
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
  const {rows} = rowObjects_(sheet);
  const byId = {};
  rows.forEach(p => {
    const id = upper_(p["Player ID"]);
    if (!id) return;
    const activeText = upper_(p.Active);
    const active = activeText !== "FALSE" && activeText !== "NO" && activeText !== "INACTIVE";
    byId[id] = { id, name: text_(p["Player Name"]), active };
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
      return json_({ok:true,players:getPlayers_(ss,false).map(p=>({ "Player ID":p.id,"Player Name":p.name,Active:true }))});
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

function doPost(e) {
  try {
    const body=JSON.parse(e && e.postData && e.postData.contents || "{}");
    const action=text_(body.action).toLowerCase();
    const adminEmail=verifySportsAdmin_(body.idToken);
    if(action==="adminauth") return json_({ok:true,authorized:true,role:"ADMIN",email:adminEmail});
    const ss=getDirectory_();
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

/** Optional manual smoke test: run from Apps Script editor after setup. */
function testSportsSchema_() {
  const ss=getDirectory_();
  Object.keys(SPORT_MAP_).forEach(code=>ensureSchema_(ss,SPORT_MAP_[code]));
  return "All sports ranking tabs and headers validated.";
}