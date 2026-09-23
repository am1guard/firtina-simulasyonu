'use strict';
// Klasik (modül olmayan) proje scriptlerini ayrı bir VM bağlamında yükler ve FIRTINA ad alanını döndürür.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadFirtina(files) {
  const context = vm.createContext({ console, performance, setTimeout, clearTimeout });
  for (const file of files) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }
  return context.FIRTINA;
}

module.exports = { loadFirtina, ROOT };
