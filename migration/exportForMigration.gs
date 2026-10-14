/**
 * Paste this function at the bottom of your existing Code.gs, then run it once
 * from the Apps Script editor (select exportForMigration → Run).
 *
 * It writes every tab (except Sessions) to one JSON file in your Google Drive and
 * logs the file link. Download that file and feed it to scripts/import-sheet-export.js.
 *
 * The file contains password hashes — delete it from Drive and your computer
 * once the import is done.
 */
function exportForMigration() {
  var out = { exportedAt: nowIso_() };
  Object.keys(SCHEMA_).forEach(function(tab) {
    if (tab !== 'Sessions') out[tab] = readTable_(tab);
  });
  var file = DriveApp.createFile(
    'client-suite-export-' + todayStr_() + '.json',
    JSON.stringify(out),
    'application/json'
  );
  Logger.log('Export saved: ' + file.getUrl());
  Object.keys(out).forEach(function(tab) {
    if (Array.isArray(out[tab])) Logger.log(tab + ': ' + out[tab].length + ' rows');
  });
}
