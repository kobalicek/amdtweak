"use strict";

// TODO:
//   [ ] More array tests.
//   [ ] Struct versioning.

const assert = require("assert");
const bin = require("./binlib.js");

const I8 = bin.I8;
const U8 = bin.U8;
const I16 = bin.I16;
const U16 = bin.U16;
const U24 = bin.U24;
const I32 = bin.I32;
const U32 = bin.U32;
const Str = bin.Str;
const Hex = bin.Hex;
const Arr = bin.Array;

const ctx = new bin.Context();

// ============================================================================
// [Struct Definitions]
// ============================================================================

ctx.$addStruct({
  $name: "Header",
  $members: [
    { $name: "Size"         , $type: U16 },
    { $name: "VersionMajor" , $type: U8  },
    { $name: "VersionMinor" , $type: U8  }
  ]
});
assert(ctx.Header.$size === 4, `Header should be 4 bytes long, not ${ctx.Header.$size}`);

ctx.$addStruct({
  $name: "StructA",
  $extend: ctx.Header,
  $members: [
    { $name: "SomeField"    , $type: U32 },
    { $name: "OtherField"   , $type: U8  }
  ]
});
assert(ctx.StructA.$size === 9, `StructA should be 9 bytes long, not ${ctx.StructA.$size}`);

ctx.$addStruct({
  $name: "BitField",
  $members: [
    { $name: "Flag"         , $type: U32, $bitSize: 1  },
    { $name: "TheRest"      , $type: U32, $bitSize: 31 },
    { $name: "X2Bits"       , $type: U32, $bitSize: 2  },
    { $name: "Y30Bits"      , $type: U32, $bitSize: 30 }
  ]
});
assert(ctx.BitField.$size === 8, `BitField that uses two bitfields of 32-bit size and must be '8' bytes long, not '${ctx.BitField.$size}'`);
assert(ctx.BitField.$members[0].$bitMask === (0x00000001|0), "Invalid BitMask of 'Flag    : 1'");
assert(ctx.BitField.$members[1].$bitMask === (0xFFFFFFFE|0), "Invalid BitMask of 'TheRest : 2'");
assert(ctx.BitField.$members[2].$bitMask === (0x00000003|0), "Invalid BitMask of 'X2Bits  : 2'");
assert(ctx.BitField.$members[3].$bitMask === (0xFFFFFFFC|0), "Invalid BitMask of 'Y30Bits : 30'");

ctx.$addStruct({
  $name: "StructFixed",
  $members: [
    { $name: "FixedArray"  , $type: Arr, $ref: U32, $length: 10  }
  ]
});
assert(ctx.StructFixed.$size == 4 * 10, `Struct with a fixed array 'U32[10]' must be 40 bytes long, not '${ctx.StructFixed.$size}'`);

ctx.$addStruct({
  $name: "StructOffset",
  $members: [
    { $name: "Size"        , $type: U32 },
    { $name: "BitFieldAddr", $type: U16, $ref: ctx.BitField, $as: "BitField" }
  ]
});
assert(ctx.StructOffset.$size === 6);

ctx.$addStruct({
  $name: "StructString",
  $members: [
    { $name: "A"           , $type: U8 },
    { $name: "Text"        , $type: Str, $length: 8 },
    { $name: "B"           , $type: U32 }
  ]
});
assert(ctx.StructString.$size === 13);

// ============================================================================
// [Serialization / Deserialization]
// ============================================================================

(function() {
  const buf = new Buffer([
    0x30, 0x00, 0x00, 0x00, // StructOffset.Size
    0x08, 0x00,             // StructOffset.BitFieldAddr
    0x00, 0x00,             // Unused
    0x03, 0x00, 0x00, 0x00, // BitField.U32[0]
    0x05, 0x00, 0x00, 0x00  // BitField.U32[1]
  ]);

  // Decompose.
  const obj = ctx.$decomposeData(buf, 0, ctx.StructOffset);
  assert(obj.Size             === 0x000030, "StructOffset.Size == 48");
  assert(obj.BitFieldAddr     === 0x000008, "StructOffset.BitFieldAddr == 8");
  assert(typeof obj.BitField  === "object", "StructOffset.BitField == {...} (invalid sub-struct decomposition)");
  assert(obj.BitField.Flag    === 0x000001, "StructOffset.BitField.Flag == 1 (invalid bit-field decomposition)");
  assert(obj.BitField.TheRest === 0x000001, "StructOffset.BitField.TheRest == 1 (invalid bit-field decomposition)");
  assert(obj.BitField.X2Bits  === 0x000001, "StructOffset.BitField.X2Bits == 1 (invalid bit-field decomposition)");
  assert(obj.BitField.Y30Bits === 0x000001, "StructOffset.BitField.Y30Bits == 1 (invalid bit-field decomposition)");

  // Merge
  obj.Size = 0xFF;
  obj.BitField.Flag = 0;
  obj.BitField.TheRest = 0xFFFF;
  ctx.$mergeData(buf, 0, null, obj);

  assert(buf.readUInt32LE(0) === 0xFF, "StructOffset.Size - failed to merge");
  assert(buf.readUInt16LE(4) === 0x08, "StructOffset.BitFieldAddr - Corrupted data that wasn't changed");
  assert(buf.readUInt32LE(8) === 0xFFFF << 1, "StructOffset.BitField[0] - failed to merge bit-field");
})();

(function() {
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

  // Decompose.
  const obj = ctx.$decomposeData(buf, 0, ctx.StructFixed);
  assert(Array.isArray(obj.FixedArray), `Decomposed object must have FixedArray member of Array type, not '${typeof obj.FixedArray}'`);
  for (var i = 0; i < 10; i++)
    assert(obj.FixedArray[i] === i, `FixedArray[${i}] must be equal to '${i}', not '${obj.FixedArray[i]}'`);

  // Merge
  obj.FixedArray[0] = 0xAA;
  obj.FixedArray[9] = 0xFF;
  ctx.$mergeData(buf, 0, null, obj);

  assert(buf.readUInt32LE(0 * 4) === 0xAA, `Merged FixedArray[0] doesn't match 0xAA, got '${buf.readUInt32LE(0 * 4)}'`);
  assert(buf.readUInt32LE(9 * 4) === 0xFF, `Merged FixedArray[9] doesn't match 0xFF, got '${buf.readUInt32LE(9 * 4)}'`);
})();

(function() {
  const buf = new Buffer([
    0xFF, 0x41, 0x6E, 0x79, 0x74, 0x68, 0x69, 0x6E, 0x67, 0xFF, 0x00, 0x00, 0x00
  ]);

  const obj = ctx.$decomposeData(buf, 0, ctx.StructString);
  assert(obj.A    === 0x000000FF);
  assert(obj.Text === "Anything");
  assert(obj.B    === 0x000000FF);

  // Merge
  obj.A = 42;
  obj.Text = "Short";
  obj.B = 42;
  ctx.$mergeData(buf, 0, null, obj);

  assert(buf.readUInt8(0) === 42);
  assert(buf.readUInt32LE(9) === 42);

  assert(buf.readUInt8(1) === "S".charCodeAt(0));
  assert(buf.readUInt8(2) === "h".charCodeAt(0));
  assert(buf.readUInt8(3) === "o".charCodeAt(0));
  assert(buf.readUInt8(4) === "r".charCodeAt(0));
  assert(buf.readUInt8(5) === "t".charCodeAt(0));
  assert(buf.readUInt8(6) === 0);
  assert(buf.readUInt8(7) === 0);
  assert(buf.readUInt8(8) === 0);
})();

// If we reached here it means everything has passed.
console.log("All tests OK");
