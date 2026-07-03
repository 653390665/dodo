'use strict';
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */

const Database = require('better-sqlite3/lib/database.js');
const nativeBindingPath = require.resolve('better-sqlite3/build/Release/better_sqlite3.node');

module.exports = {
  Database,
  nativeBindingPath,
};
