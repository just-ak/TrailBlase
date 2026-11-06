/**
 * Phase 1, task 2: prove the native SQLite module loads inside Electron, not
 * merely under host Node.
 *
 * better-sqlite3 13 is N-API based (node-addon-api 8, no gyp file, prebuilt
 * binaries), which should make it ABI-stable across Node and Electron. "Should"
 * is not evidence, so this runs under the real Electron runtime and reports
 * what it finds. Run with: npx electron scripts/verify-native.mjs
 */
import { app } from 'electron';
import Database from 'better-sqlite3';

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  app.exit(1);
};

app.whenReady().then(() => {
  try {
    console.log(`electron       ${process.versions.electron}`);
    console.log(`chrome         ${process.versions.chrome}`);
    console.log(`node (bundled) ${process.versions.node}`);
    console.log(`modules ABI    ${process.versions.modules}`);

    const db = new Database(':memory:');
    const { v } = db.prepare('select sqlite_version() as v').get();
    console.log(`sqlite         ${v}`);

    // Exercise the pragmas the real client will set, so a surprise shows up
    // here rather than at task 5.
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const fk = db.pragma('foreign_keys', { simple: true });
    console.log(`foreign_keys   ${fk}`);

    db.exec('create table t (id integer primary key, name text not null)');
    db.prepare('insert into t (name) values (?)').run('verified');
    const row = db.prepare('select name from t where id = 1').get();
    console.log(`round-trip     ${row.name}`);
    db.close();

    if (row.name !== 'verified' || fk !== 1) {
      fail('database round-trip or pragma assertion did not hold');
      return;
    }
    console.log('\nOK: better-sqlite3 loads and works under Electron.');
    app.exit(0);
  } catch (err) {
    fail(err.stack ?? String(err));
  }
});
