// ============================================================================
// [iofs.js]
// A minimalist interface for filesystem input/ouput designed mostly for sysfs..
//
// This is free and unencumbered software released into the public domain.
//
// Anyone is free to copy, modify, publish, use, compile, sell, or
// distribute this software, either in source code form or as a compiled
// binary, for any purpose, commercial or non-commercial, and by any
// means.
//
// In jurisdictions that recognize copyright laws, the author or authors
// of this software dedicate any and all copyright interest in the
// software to the public domain. We make this dedication for the benefit
// of the public at large and to the detriment of our heirs and
// successors. We intend this dedication to be an overt act of
// relinquishment in perpetuity of all present and future rights to this
// software under copyright law.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
// OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.
//
// For more information, please refer to <https://unlicense.org/>
// ============================================================================

module.exports = (function() {
"use strict";

const fs = require("fs");
const path = require("path");

const iofs = Object.create(null);
const hasOwn = Object.prototype.hasOwnProperty;

const ListRE = /(\d+)\:\s*(.+)(?:\n|$)/g;
const PropertyRE = /(.+)=(.+)(?:\n|$)/g;

function filterInPlace(arr, filter) {
  var i = 0;
  var j = 0;
  const len = arr.length;

  while (j < len) {
    const item = arr[j++];
    if (!filter.test(item))
      continue;
    arr[i++] = item;
  }

  arr.length = i;
  return arr;
}
iofs.filterInPlace = filterInPlace;

function readDir(path, filter) {
  try {
    const files = fs.readdirSync(path);
    if (filter)
      filterInPlace(files, filter);
    return files;
  }
  catch (ex) {
    return null;
  }
}
iofs.readDir = readDir;

function readFile(fileName, encoding) {
  try {
    return fs.readFileSync(fileName, encoding);
  }
  catch (ex) {
    return null;
  }
}
iofs.readFile = readFile;

function readString(fileName) {
  return readFile(fileName, "UTF-8") || "";
}
iofs.readString = readString;

function readInt(fileName) {
  const text = readString(fileName);
  if (!text) return NaN;

  if (text.startsWith("0x"))
    return parseInt(text, 16);
  else
    return parseInt(text, 10);
}
iofs.readInt = readInt;

function parseList(s, fromIndex) {
  const out = [];
  const re = ListRE;

  re.lastIndex = fromIndex || 0;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;

    const index = parseInt(m[1].trim());
    if (index !== out.length - 1)
      console.log(`devmon: Invalid list index ${index} occured in parseList()`);

    out.push(m[2].trim());
  }

  return out;
}
iofs.parseList = parseList;

function readList(fileName) {
  const text = readString(fileName);
  return text ? parseList(text, 0) : null;
}
iofs.readList = readList;

function parseProperties(s, fromIndex) {
  const out = Object.create(null);
  const re = PropertyRE;

  re.lastIndex = fromIndex || 0;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    out[m[1].trim()] = m[2].trim();
  }

  return out;
}
iofs.parseProperties = parseProperties;

function readProperties(fileName) {
  const text = readString(fileName);
  return text ? parseProperties(text, 0) : null;
}
iofs.readProperties = readProperties;

function writeFileBinary(fileName, value) {
  try {
    fs.writeFileSync(fileName, value, {mode: 0o644, flag: 'w'} );
    return true;
  }
  catch (ex) {
    return false;
  }
}
iofs.writeFileBinary = writeFileBinary;

function writeFile(fileName, value, encoding) {
  try {
    fs.writeFileSync(fileName, String(value), {encoding: encoding, mode: 0o644, flag: 'w'});
    return true;
  }
  catch (ex) {
    return false;
  }
}
iofs.writeFile = writeFile;

function writeString(fileName, value) {
  return writeFile(fileName, value, 'utf8');
}
iofs.writeString = writeString;

return iofs;

})();
