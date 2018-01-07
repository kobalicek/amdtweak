"use strict";

const fs = require("fs");

const binlib = require("../lib/binlib.js");
const iofs = require("../lib/iofs.js");
const vbios = require("../lib/vbios.js");

var ok = true;
var files = fs.readdirSync(__dirname);

files.forEach(function(fileName) {
  if (fileName.endsWith(".bin")) {
    console.log(`PPTable '${fileName}'`);
    const input = fs.readFileSync(__dirname + "/" + fileName);
    const object = vbios.$readObject({ buffer: input, type: vbios.PowerPlayTable, log: function(msg) {
      console.log("  " + msg);
    }});

    const output = Buffer.from(input);
    vbios.$updateObject({ buffer: output, object: object });

    const cmp = Buffer.compare(input, output);
    if (cmp !== 0) {
      ok = false;
      console.log(`  Read/Write FAILED!`);
    }
  }
});

if (!ok)
  console.log("\nFAILED! THE LIBRARY IS UNSTABLE!");
