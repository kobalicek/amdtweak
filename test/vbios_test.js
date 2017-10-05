"use strict";

const fs = require("fs");

const binlib = require("../lib/binlib.js");
const iofs = require("../lib/iofs.js");
const vbios = require("../lib/vbios.js");

function log(msg) { console.log(msg); }

const input = fs.readFileSync(__dirname + "/pp_table_xfx.bin");
const object = vbios.$readObject({ buffer: input, type: vbios.PowerPlayTable, log: log });

const output = Buffer.from(input);
vbios.$updateObject({ buffer: output, object: object });

const cmp = Buffer.compare(input, output);
if (cmp !== 0) {
  console.log("Failed");
}
