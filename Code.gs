// ═══════════════════════════════════════════════════════════════
//  Player Analytics — Google Apps Script  v3.0
//  Extensions → Apps Script → Code.gs
// ═══════════════════════════════════════════════════════════════

const SHEET_NAME          = "Players";
const GROUPS_SHEET_NAME   = "Groups";
const COMMENTS_SHEET_NAME = "Comments";

// ── Players: порядок колонок совпадает с таблицей на сайте ────
const HEADERS = [
  "user_id",            // Пользователь
  "status",             // Статус
  "payment_method",     // Метод депозита
  "total_deposit",      // Сумма депа
  "total_withdrawal",   // Сумма вывода
  "net_balance",        // Net
  "currency",           // Валюта
  "country",            // Страна
  "asn",                // ASN
  "device",             // Устройство
  "retention_type",     // Удержание
  "group_id",           // Группа
  "created_at",         // Дата создания
  "limit",              // Limit
  // ── скрытые поля (хранятся, но не видны в основной таблице) ──
  "deposit_wallet",
  "withdrawal_wallet",
  "retention_date",
  "retention_amount",
  "added_by",
  "added_at"
];

const GROUP_HEADERS = [
  "group_id", "name", "status", "member_ids", "tags", "notes", "telegram_link", "created_by", "created_at"
];

const COMMENT_HEADERS = [
  "comment_id", "user_id", "type", "text", "contact_method", "author", "created_at"
];


const CACHE_KEY = "pa_all_data";
const CACHE_TTL = 300; // секунд (5 минут)

function _invalidateCache() {
  try { CacheService.getScriptCache().remove(CACHE_KEY); } catch(e) {}
}

// ── GET-запросы ───────────────────────────────────────────────
function doGet(e) {
  try {
    const action  = e?.parameter?.action;
    const userId  = e?.parameter?.user_id;

    // ── Получить всё за один запрос (с кэшем) ──
    if (action === "getAll") {
      const cache    = CacheService.getScriptCache();
      const cached   = cache.get(CACHE_KEY);
      if (cached) return jsonResponse(JSON.parse(cached));

      const result = _readAll();
      try { cache.put(CACHE_KEY, JSON.stringify(result), CACHE_TTL); } catch(e) {}
      return jsonResponse(result);
    }

    // ── Получить игроков ──
    if (action === "get") {
      const sheet = getOrCreateSheet(SHEET_NAME, HEADERS);
      const data  = sheet.getDataRange().getValues();
      if (data.length <= 1) return jsonResponse({ players: [] });

      const hdrs    = data[0];
      const players = data.slice(1).map(row => {
        const obj = {};
        hdrs.forEach((h, i) => {
          let val = row[i];
          if (["total_deposit","total_withdrawal","net_balance","retention_amount"].includes(h)) val = parseFloat(val) || 0;
          if (["created_at","retention_date","added_at"].includes(h) && val instanceof Date)
            val = val.toISOString().split("T")[0];
          obj[h] = val ?? "";
        });
        return obj;
      });
      return jsonResponse({ players });
    }

    // ── Получить группы ──
    if (action === "getGroups") {
      const sheet = getOrCreateSheet(GROUPS_SHEET_NAME, GROUP_HEADERS);
      const data  = sheet.getDataRange().getValues();
      if (data.length <= 1) return jsonResponse({ groups: [] });

      const hdrs   = data[0];
      const groups = data.slice(1).map(row => {
        const obj = {};
        hdrs.forEach((h, i) => { obj[h] = row[i] ?? ""; });
        return obj;
      });
      return jsonResponse({ groups });
    }

    // ── Получить комментарии (опционально по user_id) ──
    if (action === "getComments") {
      const sheet = getOrCreateSheet(COMMENTS_SHEET_NAME, COMMENT_HEADERS);
      const data  = sheet.getDataRange().getValues();
      if (data.length <= 1) return jsonResponse({ comments: [] });

      const hdrs     = data[0];
      let comments   = data.slice(1).map(row => {
        const obj = {};
        hdrs.forEach((h, i) => { obj[h] = row[i] ?? ""; });
        return obj;
      });
      if (userId) comments = comments.filter(c => String(c.user_id) === String(userId));
      return jsonResponse({ comments });
    }

    return jsonResponse({ error: "Unknown action" });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── POST-запросы ──────────────────────────────────────────────
function doPost(e) {
  try {
    const raw    = e.postData.contents;
    const body   = JSON.parse(raw);
    const action = body.action;

    // Сбрасываем кэш при любом изменении данных
    if (["save","updatePlayer","saveGroup","deleteGroup","saveComment","updateComment","deleteComment"].includes(action)) {
      _invalidateCache();
    }

    // ── Сохранить игроков ──
    if (action === "save") {
      const players = body.players;
      if (!Array.isArray(players) || !players.length) return jsonResponse({ ok: true, saved: 0 });

      const sheet      = getOrCreateSheet(SHEET_NAME, HEADERS);
      const existing   = sheet.getDataRange().getValues();
      const hdrs       = existing[0];
      const uidCol     = hdrs.indexOf("user_id");
      const depCol     = hdrs.indexOf("total_deposit");
      const idToRow    = {};
      for (let i = 1; i < existing.length; i++) idToRow[String(existing[i][uidCol])] = i + 1;

      let added = 0, updated = 0;
      players.forEach(p => {
        const row = hdrs.map(h => p[h] ?? "");
        const uid = String(p.user_id);
        if (idToRow[uid]) {
          const existingDep = parseFloat(existing[idToRow[uid]-1][depCol]) || 0;
          if ((parseFloat(p.total_deposit)||0) >= existingDep) {
            sheet.getRange(idToRow[uid], 1, 1, row.length).setValues([row]);
            updated++;
          }
        } else {
          sheet.appendRow(row);
          idToRow[uid] = existing.length + added + 1;
          added++;
        }
      });
      return jsonResponse({ ok: true, added, updated });
    }

    // ── Обновить отдельные поля игрока ──
    if (action === "updatePlayer") {
      const p     = body.player;
      const sheet = getOrCreateSheet(SHEET_NAME, HEADERS);
      const data  = sheet.getDataRange().getValues();
      const hdrs  = data[0];
      const uidCol = hdrs.indexOf("user_id");

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][uidCol]) === String(p.user_id)) {
          const row = hdrs.map((h, idx) => p[h] !== undefined ? p[h] : (data[i][idx] ?? ""));
          sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
          return jsonResponse({ ok: true });
        }
      }
      return jsonResponse({ ok: false, error: "Player not found" });
    }

    // ── Сохранить / обновить группу ──
    if (action === "saveGroup") {
      const group = body.group;
      const sheet = getOrCreateSheet(GROUPS_SHEET_NAME, GROUP_HEADERS);
      const data  = sheet.getDataRange().getValues();
      const row   = GROUP_HEADERS.map(h => group[h] ?? "");
      let found   = false;

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(group.group_id)) {
          sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
          found = true; break;
        }
      }
      if (!found) sheet.appendRow(row);
      return jsonResponse({ ok: true });
    }

    // ── Удалить группу ──
    if (action === "deleteGroup") {
      const gid   = body.group_id;
      const sheet = getOrCreateSheet(GROUPS_SHEET_NAME, GROUP_HEADERS);
      const data  = sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(gid)) {
          sheet.deleteRow(i + 1);
          return jsonResponse({ ok: true });
        }
      }
      return jsonResponse({ ok: false, error: "Group not found" });
    }

    // ── Сохранить комментарий / событие ──
    if (action === "saveComment") {
      const c     = body.comment;
      const sheet = getOrCreateSheet(COMMENTS_SHEET_NAME, COMMENT_HEADERS);
      sheet.appendRow(COMMENT_HEADERS.map(h => c[h] ?? ""));
      return jsonResponse({ ok: true });
    }

    // ── Обновить комментарий ──
    if (action === "updateComment") {
      const c     = body.comment;
      const sheet = getOrCreateSheet(COMMENTS_SHEET_NAME, COMMENT_HEADERS);
      const data  = sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(c.comment_id)) {
          const row = COMMENT_HEADERS.map((h, idx) => c[h] !== undefined ? c[h] : (data[i][idx] ?? ""));
          sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
          return jsonResponse({ ok: true });
        }
      }
      return jsonResponse({ ok: false, error: "Comment not found" });
    }

    // ── Удалить комментарий ──
    if (action === "deleteComment") {
      const cid   = body.comment_id;
      const sheet = getOrCreateSheet(COMMENTS_SHEET_NAME, COMMENT_HEADERS);
      const data  = sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(cid)) {
          sheet.deleteRow(i + 1);
          return jsonResponse({ ok: true });
        }
      }
      return jsonResponse({ ok: false, error: "Comment not found" });
    }

    // ── Экспорт группы в отдельный лист ──
    if (action === "exportGroupSheet") {
      const { group, members } = body;
      const ss        = SpreadsheetApp.getActiveSpreadsheet();
      const sheetName = `${group.group_id}_${group.name}`.substring(0, 40).replace(/[\\\/\?\*\[\]]/g, "_");

      // Удалить старый лист если есть
      const old = ss.getSheetByName(sheetName);
      if (old) ss.deleteSheet(old);

      const sh = ss.insertSheet(sheetName);

      // ── Строка 1: Информация о группе ──
      sh.getRange(1, 1).setValue(`Группа: ${group.name} (${group.group_id})`);
      sh.getRange(1, 2).setValue(`Статус: ${group.status}`);
      sh.getRange(1, 3).setValue(`Создана: ${group.created_at}`);
      sh.getRange(1, 4).setValue(`Автор: ${group.created_by}`);
      if (group.notes) sh.getRange(1, 5).setValue(`Примечание: ${group.notes}`);

      sh.getRange(1, 1, 1, 5).setBackground("#1a1a2e").setFontColor("#06b6d4").setFontWeight("bold");

      // ── Строка 3: Заголовки таблицы ──
      const cols = ["user_id","status","retention_type","total_deposit","total_withdrawal",
                    "net_balance","withdrawal_rate","currency","country","asn","device",
                    "payment_method","deposit_wallet","withdrawal_wallet","limit","created_at","group_id","added_by"];
      sh.getRange(3, 1, 1, cols.length).setValues([cols]);
      sh.getRange(3, 1, 1, cols.length).setBackground("#111827").setFontColor("#94a3b8").setFontWeight("bold");

      // ── Строки 4+: Данные участников ──
      if (members.length) {
        const rows = members.map(m => cols.map(c => {
          if (c === "net_balance")      return (parseFloat(m.total_deposit)||0) - (parseFloat(m.total_withdrawal)||0);
          if (c === "withdrawal_rate")  return m.total_deposit > 0 ? ((m.total_withdrawal/m.total_deposit)*100).toFixed(1)+"%" : "0%";
          return m[c] ?? "";
        }));
        sh.getRange(4, 1, rows.length, cols.length).setValues(rows);
      }

      // ── Итоговая строка ──
      const sumRow = members.length + 4;
      const totDep = members.reduce((s,m) => s+(parseFloat(m.total_deposit)||0), 0);
      const totWit = members.reduce((s,m) => s+(parseFloat(m.total_withdrawal)||0), 0);
      sh.getRange(sumRow, 1).setValue("ИТОГО");
      sh.getRange(sumRow, 4).setValue(totDep);
      sh.getRange(sumRow, 5).setValue(totWit);
      sh.getRange(sumRow, 6).setValue(totDep - totWit);
      sh.getRange(sumRow, 1, 1, cols.length).setFontWeight("bold");

      sh.setFrozenRows(3);
      sh.autoResizeColumns(1, cols.length);

      return jsonResponse({ ok: true, sheetName });
    }

    return jsonResponse({ error: "Unknown action" });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── Читает все три листа за один вызов ───────────────────────
function _readAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Players
  let players = [];
  const ps = ss.getSheetByName(SHEET_NAME);
  if (ps) {
    const data = ps.getDataRange().getValues();
    if (data.length > 1) {
      const hdrs = data[0];
      players = data.slice(1).map(row => {
        const obj = {};
        hdrs.forEach((h, i) => {
          let val = row[i];
          if (["total_deposit","total_withdrawal","net_balance","retention_amount"].includes(h)) val = parseFloat(val) || 0;
          if (["created_at","retention_date","added_at"].includes(h) && val instanceof Date)
            val = val.toISOString().split("T")[0];
          obj[h] = val ?? "";
        });
        return obj;
      });
    }
  }

  // Groups
  let groups = [];
  const gs = ss.getSheetByName(GROUPS_SHEET_NAME);
  if (gs) {
    const data = gs.getDataRange().getValues();
    if (data.length > 1) {
      const hdrs = data[0];
      groups = data.slice(1).map(row => {
        const obj = {};
        hdrs.forEach((h, i) => { obj[h] = row[i] ?? ""; });
        return obj;
      });
    }
  }

  // Comments
  let comments = [];
  const cs = ss.getSheetByName(COMMENTS_SHEET_NAME);
  if (cs) {
    const data = cs.getDataRange().getValues();
    if (data.length > 1) {
      const hdrs = data[0];
      comments = data.slice(1).map(row => {
        const obj = {};
        hdrs.forEach((h, i) => { obj[h] = row[i] ?? ""; });
        return obj;
      });
    }
  }

  return { players, groups, comments };
}

// ── Вспомогательные функции ───────────────────────────────────
function getOrCreateSheet(name, headers) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground("#1a1a2e").setFontColor("#06b6d4").setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    // Проверить и обновить заголовки если изменились
    const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (currentHeaders.length !== headers.length || !headers.every((h, i) => currentHeaders[i] === h)) {
      // Заголовки изменились — обновить строку заголовков
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground("#1a1a2e").setFontColor("#06b6d4").setFontWeight("bold");
    }
  }
  return sheet;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
