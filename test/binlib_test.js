"use strict";

const assert = require("assert");
const binlib = require("../lib/binlib.js");

const FLAGS = binlib.FLAGS;
const I8 = binlib.I8;
const U8 = binlib.U8;
const I16 = binlib.I16LE;
const U16 = binlib.U16LE;
const U24 = binlib.U24LE;
const I32 = binlib.I32LE;
const U32 = binlib.U32LE;
const Str = binlib.Str;
const Hex = binlib.Hex;
const Arr = binlib.Array;

const ctx = new binlib.Context();
const hasOwn = Object.prototype.hasOwnProperty;

// ============================================================================
// [Utilities]
// ============================================================================

function assertSizeOf(struct, size) {
  assert(struct.$size === size,
    `${struct.$name}: should be ${size} bytes long, not ${struct.$size}`);
}

function assertObject(obj, struct, meta) {
  assert(obj != null && typeof obj === "object",
    `${struct.$name}: failed to read object, instead got '${typeof obj}'`);

  assert(typeof obj.$meta === "object",
    `${struct.$name}: failed to read object with $meta, which is '${obj.$meta}'`);

  if (meta && hasOwn.call(meta, "rawOffset"))
    assert(obj.$meta.absOffset === meta.absOffset, `${struct.$name}.$meta.rawOffset: Value '${obj.$meta.rawOffset}' doesn't match expected '${meta.rawOffset}'`);

  if (meta && hasOwn.call(meta, "absOffset"))
    assert(obj.$meta.absOffset === meta.absOffset, `${struct.$name}.$meta.absOffset: Value '${obj.$meta.absOffset}' doesn't match expected '${meta.absOffset}'`);
}

function assertMember(obj, member, value) {
  assert(hasOwn.call(obj, member), `${obj.$meta.type.$name}.${member.$name}: not found in object`);

  const v = obj[member];
  assert(v === value, `${obj.$meta.type.$name}.${member.$name}: must equal to ${value}, ${v} is invalid`);
}

// ============================================================================
// [Struct Definitions]
// ============================================================================

ctx.$define({
  $name: "Header",
  $members: [
    { $name: "Size"         , $type: U16 },
    { $name: "VersionMajor" , $type: U8  },
    { $name: "VersionMinor" , $type: U8  }
  ]
});
assertSizeOf(ctx.Header, 4);

ctx.$define({
  $name: "StructA",
  $extend: ctx.Header,
  $members: [
    { $name: "SomeField"    , $type: U32 },
    { $name: "OtherField"   , $type: U8  }
  ]
});
assertSizeOf(ctx.StructA, 9);

ctx.$define({
  $name: "StructB",
  $members: [
    { $name: "Flag"         , $type: U32, $bitSize: 1  },
    { $name: "TheRest"      , $type: U32, $bitSize: 31 },
    { $name: "X2Bits"       , $type: U32, $bitSize: 2  },
    { $name: "Y30Bits"      , $type: U32, $bitSize: 30 }
  ]
});
assertSizeOf(ctx.StructB, 8);
assert(ctx.StructB.$members[0].$bitMask === (0x00000001|0), "Invalid BitMask of 'Flag    : 1'");
assert(ctx.StructB.$members[1].$bitMask === (0xFFFFFFFE|0), "Invalid BitMask of 'TheRest : 2'");
assert(ctx.StructB.$members[2].$bitMask === (0x00000003|0), "Invalid BitMask of 'X2Bits  : 2'");
assert(ctx.StructB.$members[3].$bitMask === (0xFFFFFFFC|0), "Invalid BitMask of 'Y30Bits : 30'");

ctx.$define({
  $name: "StructC",
  $flags: FLAGS.ISOLATE,
  $members: [
    { $name: "Size"         , $type: U32 },
    { $name: "StructB"      , $type: U16, $ref: ctx.StructB }
  ]
});
assertSizeOf(ctx.StructC, 6);

ctx.$define({
  $name: "StructD",
  $members: [
    { $name: "StructC"      , $type: U16, $ref: ctx.StructC }
  ]
});
assertSizeOf(ctx.StructD, 2);

ctx.$define({
  $name: "StructE",
  $members: [
    { $name: "FixedArray"   , $type: Arr, $ref: U32, $length: 10  }
  ]
});
assertSizeOf(ctx.StructE, 4 * 10);

ctx.$define({
  $name: "StructF",
  $members: [
    { $name: "A"            , $type: U8 },
    { $name: "Text"         , $type: Str, $length: 8 },
    { $name: "B"            , $type: U32 }
  ]
});
assertSizeOf(ctx.StructF, 13);

ctx.$define({
  $name: "StructG",
  $members: [
    { $name: "StructF"      , $type: ctx.StructF }
  ]
});
assertSizeOf(ctx.StructG, 13);

ctx.$define({
  $name: "StructVer",
  $verInfo: ["Version"],
  $members: [
    { $name: "Version"      , $type: U8  },
    { $name: "Something"    , $type: U32 }
  ]
});
assertSizeOf(ctx.StructVer, 5);

ctx.$define({
  $extend: ctx.StructVer,
  $version: [1],
  $members: [
    { $name: "FieldA"       , $type: U8  },
    { $name: "FieldB"       , $type: U16 },
  ]
});
assertSizeOf(ctx.StructVer$1, 8);

ctx.$define({
  $extend: ctx.StructVer,
  $version: [2],
  $members: [
    { $name: "FieldA"       , $type: U32 },
    { $name: "FieldB"       , $type: U8  },
    { $name: "FieldC"       , $type: U8  },
  ]
});
assertSizeOf(ctx.StructVer$2, 11);

// ============================================================================
// [Read / Write]
// ============================================================================

(function() {
  console.log("Testing basic operations");

  const buf = new Buffer([
    // ---- StructD ----
    0x04, 0x00,             // StructD.StructC (Offset to StructC)
    0x00, 0x00,             // Unused

    // ---- StructC - Isolated (all offsets relative from here) ----
    0x10, 0x00, 0x00, 0x00, // StructC.Size
    0x08, 0x00,             // StructC.StructB (Offset to StructB)
    0x00, 0x00,             // Unused

    // ---- StructB - Non-isolated (all offsets relative to StructC) ----
    0x03, 0x00, 0x00, 0x00, // StructB.U32[0]
    0x05, 0x00, 0x00, 0x00  // StructB.U32[1]
  ]);

  // Read.
  const obj = ctx.$readObject({ buffer: buf, type: ctx.StructD });

  const d = obj;
  assertObject(d, ctx.StructD, { absOffset: 0, rawOffset: -1 });

  const c = d.StructC;
  assertObject(c, ctx.StructC, { absOffset: 4, rawOffset: 4 });
  assertMember(c, "Size", 0x0010);

  const b = c.StructB;
  assertObject(b, ctx.StructB, { absOffset: 12, rawOffset: 8 });
  assertMember(b, "Flag", 1);
  assertMember(b, "TheRest", 1);
  assertMember(b, "X2Bits", 1);
  assertMember(b, "Y30Bits", 1);

  // Read only the root structure.
  const obj0 = ctx.$readObject({ buffer: buf, type: ctx.StructD, maxDepth: 0 });
  assertObject(obj0, ctx.StructD);
  assertObject(obj0.StructC, ctx.StructC, { absOffset: 4, rawOffset: 4 });
  assert(obj0.StructC.Size === undefined, "Failed to read with maxDepth=0");

  // Update.
  c.Size = 0xFF;
  c.StructB.Flag = 0;
  c.StructB.TheRest = 0xFFFF;
  ctx.$updateObject({ buffer: buf, object: obj });

  assert(buf.readUInt32LE(4 ) === 0xFF, "StructC.Size - failed to update");
  assert(buf.readUInt16LE(8 ) === 0x08, "StructC.StructBAddr - Corrupted data that wasn't changed");
  assert(buf.readUInt16LE(10) === 0x00, "Updater cannot change bytes not used by any structure");
  assert(buf.readUInt32LE(12) === 0xFFFF << 1, "StructC.StructB[0] - failed to update bit-field");
})();

(function() {
  console.log("Testing array operations");

  const buf = new Buffer([
    0x00, 0x00, 0x00, 0x00, // FixedArray[0]
    0x01, 0x00, 0x00, 0x00, // FixedArray[1]
    0x02, 0x00, 0x00, 0x00, // FixedArray[2]
    0x03, 0x00, 0x00, 0x00, // FixedArray[3]
    0x04, 0x00, 0x00, 0x00, // FixedArray[4]
    0x05, 0x00, 0x00, 0x00, // FixedArray[5]
    0x06, 0x00, 0x00, 0x00, // FixedArray[6]
    0x07, 0x00, 0x00, 0x00, // FixedArray[7]
    0x08, 0x00, 0x00, 0x00, // FixedArray[8]
    0x09, 0x00, 0x00, 0x00  // FixedArray[9]
  ]);

  // Read.
  const obj = ctx.$readObject({ buffer: buf, type: ctx.StructE });
  assertObject(obj, ctx.StructE);

  assert(Array.isArray(obj.FixedArray), `Decomposed object must have FixedArray member of Array type, not '${typeof obj.FixedArray}'`);
  for (var i = 0; i < 10; i++)
    assert(obj.FixedArray[i] === i, `FixedArray[${i}] must be equal to '${i}', not '${obj.FixedArray[i]}'`);

  // Update
  obj.FixedArray[0] = 0xAA;
  obj.FixedArray[9] = 0xFF;
  ctx.$updateObject({ buffer: buf, object: obj });

  assert(buf.readUInt32LE(0 * 4) === 0xAA, `Updated FixedArray[0] doesn't match 0xAA, got '${buf.readUInt32LE(0 * 4)}'`);
  assert(buf.readUInt32LE(9 * 4) === 0xFF, `Updated FixedArray[9] doesn't match 0xFF, got '${buf.readUInt32LE(9 * 4)}'`);
})();

(function() {
  console.log("Testing string operations");

  const buf = new Buffer([
    0xFF, 0x41, 0x6E, 0x79, 0x74, 0x68, 0x69, 0x6E, 0x67, 0xFF, 0x00, 0x00, 0x00
  ]);

  // Read.
  const obj = ctx.$readObject({ buffer: buf, type: ctx.StructG });
  assertObject(obj, ctx.StructG, { absOffset: 0, rawOffset: -1 });
  assertObject(obj.StructF, { absOffset: 0, rawOffset: -1 });
  assertMember(obj.StructF, "A", 0xFF);
  assertMember(obj.StructF, "Text", "Anything");
  assertMember(obj.StructF, "B", 0xFF);

  // Update.
  obj.StructF.A = 42;
  obj.StructF.Text = "Short";
  obj.StructF.B = 43;
  ctx.$updateObject({ buffer: buf, object: obj });

  assert(buf.readUInt8(0) === 42);
  assert(buf.readUInt32LE(9) === 43);

  assert(buf.readUInt8(1) === "S".charCodeAt(0));
  assert(buf.readUInt8(2) === "h".charCodeAt(0));
  assert(buf.readUInt8(3) === "o".charCodeAt(0));
  assert(buf.readUInt8(4) === "r".charCodeAt(0));
  assert(buf.readUInt8(5) === "t".charCodeAt(0));
  assert(buf.readUInt8(6) === 0);
  assert(buf.readUInt8(7) === 0);
  assert(buf.readUInt8(8) === 0);
})();

(function() {
  console.log("Testing struct versioning");

  const buf1 = new Buffer([
    0x01,                   // Version
    0xFF, 0x00, 0x00, 0x00, // Something
    0x02,                   // FieldA
    0x03, 0x00              // FieldB
  ]);

  const buf2 = new Buffer([
    0x02,                   // Version
    0xFF, 0x00, 0x00, 0x00, // Something
    0x02, 0x00, 0x00, 0x00, // FieldA
    0x03,                   // FieldB
    0x04                    // FieldC
  ]);

  // Read.
  const obj1 = ctx.$readObject({ buffer: buf1, type: ctx.StructVer });
  assertObject(obj1, ctx.StructVer$1, { absOffset: 0, rawOffset: - 1});
  assertMember(obj1, "Version", 1);
  assertMember(obj1, "Something", 0xFF);
  assertMember(obj1, "FieldA", 2);
  assertMember(obj1, "FieldB", 3);

  const obj2 = ctx.$readObject({ buffer: buf2, type: ctx.StructVer });
  assertObject(obj2, ctx.StructVer$2);
  assertMember(obj2, "Version", 2);
  assertMember(obj2, "Something", 0xFF);
  assertMember(obj2, "FieldA", 2);
  assertMember(obj2, "FieldB", 3);
  assertMember(obj2, "FieldC", 4);
})();

// ============================================================================
// [Finish]
// ============================================================================

// If we reached here it means everything has passed.
console.log("All tests OK");
