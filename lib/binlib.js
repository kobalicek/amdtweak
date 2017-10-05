// ============================================================================
// [binlib.js]
// Binary structures in JS.
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

// ============================================================================
// This is a small library that allows to define C-like structures that are
// used in binary data. It has the following goals:
//
//   * Allow to define a C-like structs.
//   * Allow to define links between structs (absolute vs relative offsets).
//   * Allow to read a struct into a JS object (including substructs).
//   * Allow to update data back from JS object to the original Buffer/DataView.
//
// The following built-in types are provided:
//
//   * I8/U8   - Signed/Unsigned 8-bit integer.
//   * I16/U16 - Signed/Unsigned 16-bit integer.
//   * I24/U24 - Signed/Unsigned 24-bit integer.
//   * I32/U32 - Signed/Unsigned 32-bit integer.
//   * Str     - String of fixed size, read as ASCII string.
//   * Hex     - String of fixed size, read as HEX string.
//   * Arr     - Array of fixed or variable size.
// ============================================================================

(function($export, $as) {
"use strict";

// ============================================================================
// [Import]
// ============================================================================

const freeze = Object.freeze;
const hasOwn = Object.prototype.hasOwnProperty;
const isArray = Array.isArray;

const NoObject = freeze(Object.create(null));

// ============================================================================
// [Export]
// ============================================================================

const binlib = Object.create(null);
$export[$as] = binlib;

// ============================================================================
// binlib.FLAGS]
// ============================================================================

const FLAGS = freeze({
  NONE           : 0x00000000, // No flags (just for convenience).

  PRIMITIVE      : 0x00000001, // Primitive type (integer / float).
  STRING         : 0x00000002, // String type (null terminated or fixed).
  ARRAY          : 0x00000004, // Array type, must have $ref pointing to type.
  STRUCT         : 0x00000008, // Struct type

  LITTLE_ENDIAN  : 0x00000010, // Always little endian (regardless of reader/writer mode).
  BIG_ENDIAN     : 0x00000020, // Always big endian (regardless of reader/writer mode).

  FLOAT          : 0x00000040, // Floating point       (always combined with PRIMITIVE).
  SIGNED         : 0x00000100, // Signed integer       (always combined with PRIMITIVE).
  UNSIGNED       : 0x00000200, // Unsigned integer     (always combined with PRIMITIVE).

  ASCII          : 0x00000400, // String data as ASCII (always combined with STRING).
  HEX            : 0x00000800, // String data as HEX   (always combined with STRING).

  ISOLATE        : 0x00010000, // Used by `Struct` to isolate all offsets within it (starts a new absolute positioning from here).
  ABSOLUTE_OFFSET: 0x00040000, // This is an absolute offset that points to a struct (must be used with `$ref`).
  RELATIVE_OFFSET: 0x00080000  // This is a relative offset that points to a struct (must be used with `$ref`).
});
binlib.FLAGS = FLAGS;

const FLAGS_PRIMITIVE_LE  = FLAGS.PRIMITIVE    | FLAGS.LITTLE_ENDIAN;
const FLAGS_PRIMITIVE_BE  = FLAGS.PRIMITIVE    | FLAGS.BIG_ENDIAN;
const FLAGS_PRIMITIVE_ALL = FLAGS_PRIMITIVE_LE |
                            FLAGS_PRIMITIVE_BE |
                            FLAGS.FLOAT        |
                            FLAGS.SIGNED       |
                            FLAGS.UNSIGNED     ;

function updateFlags(existing, add) {
  const SIGN     = FLAGS.SIGNED            | FLAGS.UNSIGNED;
  const ENDIAN   = FLAGS.LITTLE_ENDIAN     | FLAGS.BIG_ENDIAN;
  const OFFSET   = FLAGS.ABSOLUTE_OFFSET   | FLAGS.RELATIVE_OFFSET;
  const ENCODING = FLAGS.ASCII | FLAGS.HEX;

  const clear = ((add & SIGN    ) ? SIGN     : 0) |
                ((add & ENDIAN  ) ? ENDIAN   : 0) |
                ((add & OFFSET  ) ? OFFSET   : 0) |
                ((add & ENCODING) ? ENCODING : 0) ;

  return (existing & ~clear) | add;
}

// ============================================================================
// [Globals]
// ============================================================================

function isObject(obj) { return typeof obj === "object" && obj != null; }

function dummy() {}
function returnTrue() { return true; }

function fail(msg) { throw Error(msg); }

function clz32(x) { return Math.clz32(x); }
function ctz32(x) { return 31 - clz32(x ^ (x - 1)); }

function bitSizeOf(x) { return 32 - clz32(x); }
function bitMaskOf(x) { return x >= 32 ? 0xFFFFFFFF : (1 << x) - 1; }

function hasVersion(name) { return name.indexOf('$') !== -1; }
function fullNameOf(name, version) { return (!version || !version.length) ? name : name + "$" + version.join("."); }

function fullNameFromPartialObject(object, type) {
  var fullName = type.$name;
  var verInfo = type.$verInfo;

  if (!verInfo || !verInfo.length)
    return fullName;

  for (var i = 0; i < verInfo.length; i++) {
    fullName += i === 0 ? "$" : ".";
    fullName += String(object[verInfo[i]]);
  }
  return fullName;
}

function hexToAscii(x) {
  return x + (x <= 9 ? 48 : 65);
}

function asciiToHex(x) {
  if (x >= 48 && x <=  57) return x - 48;
  if (x >= 65 && x <=  90) return x - 55;
  if (x >= 97 && x <= 122) return x - 87;

  throw TypeError(`Invalid HEX CharCode '${x}'`);
}

function encodingFromFlags(flags) {
  return (flags & FLAGS.HEX) ? "hex"  : "ascii";
}

function dataViewOf(any) {
  if (any instanceof DataView)
    return any;

  var arrayBuffer = null;
  var byteOffset = 0;
  var byteLength = -1;

  if (any instanceof ArrayBuffer) {
    // The given object is an ArrayBuffer, easy...
    arrayBuffer = any;
  }
  else if (typeof any === "object" && any.buffer instanceof ArrayBuffer) {
    // The given object is a TypedArray view or node's Buffer.
    arrayBuffer = any.buffer;

    // If this is a node's Buffer then we must use the offset as well
    // as node would normally reuse single `ArrayBuffer` instance for
    // multiple `Buffer` instances.
    if (typeof any.offset === "number") byteOffset = any.offset;
    if (typeof any.length === "number") byteLength = any.length;
  }

  if (arrayBuffer === null || !(arrayBuffer instanceof ArrayBuffer))
    throw TypeError(`Couldn't recognize the input buffer type`);

  if (byteLength === -1)
    byteLength = arrayBuffer.byteLength - byteOffset;
  return new DataView(arrayBuffer, byteOffset, byteLength);
}

function dumpFlags(flags) {
  var s = "";
  var none = "";

  for (var k in Flags) {
    const mask = Flags[k];
    if (!mask)
      none = k;
    else if (flags & mask)
      s += (s ? "|" : "") + k;
  }

  return s || none;
}

function newObject(meta) {
  const object = Object.create(null);
  Object.defineProperty(object, "$meta", { value: meta, enumerable: false });
  return object;
}

// ============================================================================
// binlib.utils]
// ============================================================================

binlib.utils = Object.create(null);

function getKeyInternal(obj, path, key) {
  if (!key)
    throw new TypeError(`Key '${path}' is invalid`);

  const prefix = path ? path + "." : "";
  const m = key.match(/[\.\[]/);

  if (m) {
    // Object or array access.
    const what = m[0];
    const index = m.index;

    const thisKey = key.substring(0, index);
    if (!hasOwn.call(obj, thisKey))
      throw Error(`Key '${prefix + thisKey}' doesn't exist`);

    const thisObj = obj[thisKey];
    if (what === ".") {
      // Object access.
      if (thisObj == null || typeof thisObj !== "object" || isArray(thisObj))
        throw TypeError(`Key '${prefix + thisKey}' doesn't point to an Object`);

      const subKey = key.substring(index + 1);
      return getKeyInternal(thisObj, prefix + thisKey, subKey);
    }
    else {
      // Array access.
      const endIndex = key.indexOf("]", index);
      if (endIndex === -1 )
        throw TypeError(`Key '${prefix + key}' is invalid`);

      const indexValue = key.substring(index + 1, endIndex);
      if (!/^\d+$/.test(indexValue))
        throw TypeError(`Key '${prefix + key}' is invalid`);

      if (!isArray(thisObj))
        throw TypeError(`Key '${prefix + thisKey}' doesn't point to an Array`);

      const i = parseInt(indexValue);
      if (i >= thisObj.length)
        throw TypeError(`Key '${prefix + thisKey}' index '${i}' out of range [0, ${thisObj.length})`);

      const subKey = key.substring(endIndex + 1);
      if (subKey) {
        if (!subKey.startsWith("."))
          throw TypeError(`Key '${prefix + thisKey}' is invalid`);
        return getKeyInternal(thisObj[i], prefix + thisKey + `[${i}]`, subKey.substring(1));
      }
      else {
        // TODO:
        throw new Error("NOT IMPLEMENTED");
      }
    }
  }
  else {
    if (!hasOwn.call(obj, key))
      throw TypeError(`Key '${prefix + key}' doesn't exist`);
    return obj[key];
  }
}

function getKey(root, path) {
  return getKeyInternal(root, "", path);
}
binlib.utils.getKey = getKey;

function setKeyInternal(obj, path, key, value) {
  if (!key)
    throw new TypeError(`Key '${path}' is invalid`);

  const prefix = path ? path + "." : "";
  const m = key.match(/[\.\[]/);

  if (m) {
    // Object or array access.
    const what = m[0];
    const index = m.index;

    const thisKey = key.substring(0, index);
    if (!hasOwn.call(obj, thisKey))
      throw Error(`Key '${prefix + thisKey}' doesn't exist`);

    const thisObj = obj[thisKey];
    if (what === ".") {
      // Object access.
      if (thisObj == null || typeof thisObj !== "object" || isArray(thisObj))
        throw TypeError(`Key '${prefix + thisKey}' doesn't point to an Object`);

      const subKey = key.substring(index + 1);
      return setKeyInternal(thisObj, prefix + thisKey, subKey, value);
    }
    else {
      // Array access.
      const endIndex = key.indexOf("]", index);
      if (endIndex === -1 )
        throw TypeError(`Key '${prefix + key}' is invalid`);

      const indexValue = key.substring(index + 1, endIndex);
      if (!/^\d+$/.test(indexValue))
        throw TypeError(`Key '${prefix + key}' is invalid`);

      if (!isArray(thisObj))
        throw TypeError(`Key '${prefix + thisKey}' doesn't point to an Array`);

      const i = parseInt(indexValue);
      if (i >= thisObj.length)
        throw TypeError(`Key '${prefix + thisKey}' index '${i}' out of range [0, ${thisObj.length})`);

      const subKey = key.substring(endIndex + 1);
      if (subKey) {
        if (!subKey.startsWith("."))
          throw TypeError(`Key '${prefix + thisKey}' is invalid`);
        return setKeyInternal(thisObj[i], prefix + thisKey + `[${i}]`, subKey.substring(1), value);
      }
      else {
        // TODO:
        throw new Error("NOT IMPLEMENTED");
      }
    }
  }
  else {
    if (!hasOwn.call(obj, key))
      throw TypeError(`Key '${prefix + key}' doesn't exist`);

    const prev = obj[key];
    if (prev == null || typeof prev === "object")
      throw TypeError(`Key '${prefix + key}' is an object, it cannot be set to '${value}'`);

    if (typeof prev === "number") {
      if (typeof value === "string") {
        if (!/^-?\d+$/.test(value))
          throw TypeError(`Key '${prefix + key}' cannot be set to '${value}'`);
        value = parseInt(value);
      }
      else if (typeof value === "boolean") {
        value = Number(value);
      }
      else if (typeof value !== "number") {
        throw TypeError(`Key '${prefix + key}' cannot be set to '${value}'`);
      }

      obj[key] = value;
      return;
    }

    if (typeof prev === "string") {
      obj[key] = value;
      return;
    }

    throw TypeError(`Key '${prefix + key}' exists, but couldn't find a right setter`);
  }
}

function setKey(root, key, value) {
  return setKeyInternal(root, "", key, value);
}
binlib.utils.setKey = setKey;

// ============================================================================
// binlib.Type]
// ============================================================================

class Type {
  constructor(opt) {
    this.$name = "";           // Type name.
    this.$fullName = "";       // Full typename containing also the version.
    this.$size = 0;            // Type size in bytes.
    this.$flags = 0;           // Flags, see `binlib.Flags`.

    if (opt)
      this.$init(opt);
  }

  $init(opt) {
    if (hasOwn.call(opt, "$name")) {
      this.$name = opt.$name;
      this.$fullName = opt.$name;
    }

    if (hasOwn.call(opt, "$size"))
      this.$size = opt.$size;

    if (hasOwn.call(opt, "$flags"))
      this.$flags = updateFlags(this.$flags, opt.$flags);
  }
}
binlib.Type = Type;

// ============================================================================
// binlib.Struct]
// ============================================================================

class Struct extends Type {
  constructor(opt) {
    super(null);

    this.$flags |= FLAGS.STRUCT; // Mark this type as STRUCT.
    this.$verInfo = null;        // Version info like `["Major", "Minor"]`.
    this.$version = null;        // Version data like `[1, 0]`.
    this.$members = [];          // Members, always in definition order.

    if (opt)
      this.$init(opt);
  }

  $init(opt) {
    const extend = opt.$extend;

    if (extend) {
      if (!this.$name && extend.$name)
        this.$name = extend.$name;

      if (extend.$flags)
        this.$flags = updateFlags(this.$flags, extend.$flags);

      if (extend.$verInfo)
        this.$verInfo = extend.$verInfo;

      this.$addMembers(extend.$members);
    }

    for (var k in opt) {
      switch (k) {
        // Already handled.
        case "$extend":
        case "$members":
          break;

        case "$flags":
          this.$flags = updateFlags(this.$flags, opt.$flags);
          break;

        default:
          this[k] = opt[k];
          break;
      }
    }

    this.$fullName = fullNameOf(this.$name, this.$version);

    if (opt.$members)
      this.$addMembers(opt.$members);
  }

  $addMember(opt) {
    const name = opt.$name;
    if (!name)
      fail(`'${this.$name}': Cannot add member without a name`);

    if (hasOwn.call(this, name))
      fail(`'${this.$name}['${name}']': Already exists`);

    const type = opt.$type;
    if (!type)
      fail(`'${this.$name}['${name}']': Doesn't provide member '$type'`);

    var size = opt.$size ? opt.$size : type.$size;
    var flags = updateFlags(type.$flags, (opt.$flags || 0));

    const members = this.$members;
    const member = Object.create(null);

    member.$name      = name;  // Member name.
    member.$type      = type;  // Member type, references a `Type` instance.
    member.$size      = size;  // Member size, in bytes, based on Type.$size.
    member.$flags     = flags; // Member flags, based on Type.$flags.

    member.$bitMask   = 0;     // Bit mask in case this is a bit-field.
    member.$bitShift  = 0;     // Bit shift in case this is a bit-field.
    member.$offset    = 0;     // Offset [bytes] relative to the beginning of the struct.
    member.$unit      = null;  // Describes a unit if this is a value, can be null.
    member.$ref       = null;  // Reference to another `Type` or `Struct`.
    member.$length    = -1;    // Only used by String and Array types.

    var bitSize = 0;

    // Handle all extra attributes.
    for (var k in opt) {
      if (k === "$type"    ||  // Already handled.
          k === "$name"    ||  // Already handled.
          k === "$size"    ||  // Already handled.
          k === "$flags"   ||  // Already handled.
          k === "$bitMask" ||  // Deduced automatically (can be part of an existing member from a base struct).
          k === "$bitShift")   // Deduced automatically (can be part of an existing member from a base struct).
        continue;

      const v = opt[k];
      switch (k) {
        case "$bitSize":
          if (v <= 0)
            fail(`'${this.$name}.${name}': The '$bitSize' attribute '${v}' cannot be zero or less`);
          bitSize = v;
          break;

        case "$ref":
          if (v === undefined)
            fail(`'${this.$name}.${name}]': Reference $ref cannot be undefined, use null instead`);

          if (v === undefined)
            fail(`'${this.$name}.${name}]': Reference $ref cannot be undefined, use null instead`);

          member.$ref = v;
          break;

        default:
          member[k] = v;
          break;
      }
    }

    // Handle fixed strings.
    if (flags & FLAGS.STRING) {
      size = member.$length;
      member.$size = size;
    }

    // This is an existing bit-field added to this struct, compute `$bitSize` from `$bitMask` and `$bitShift`.
    if (opt.$bitMask != null && opt.$bitShift != null) {
      if (bitSize)
        fail(`'${this.$name}.${name}': Something got wrong, $bitSize '${bitSize}' defined together with $bitMask '${opt.$bitMask}' and $bitShift '${opt.$bitShift}'`);
      bitSize = bitSizeOf(opt.$bitMask >>> opt.$bitShift);
    }

    if (bitSize) {
      if (flags & (FLAGS.STRING | FLAGS.ARRAY | FLAGS.STRUCT))
        fail(`'${this.$name}.${name}': Something got wrong, $bitSize '${bitSize}' defined for non-primitive type`);

      if (bitSize > size * 8)
        fail(`'${this.$name}.${name}': Bit size '${bitSize} cannot be greater than a native type size '${size * 8}'`);
    }

    // Check the previous member if it's an unclosed bit-array. If true we must
    // continue it or fail immediately as holes in structs are not allowed.
    const prev = members.length ? members[members.length - 1] : null;
    var advance = true;

    var remainingBitShift = 0;
    var remainingBitCount = 0;

    if (prev && prev.$bitMask) {
      const prevBitShift = prev.$bitShift;
      const prevMaskSize = bitSizeOf(prev.$bitMask >>> prevBitShift);

      remainingBitShift = prevBitShift + prevMaskSize;
      remainingBitCount = prev.$size * 8 - remainingBitShift;

      if (remainingBitCount < 0)
        fail(`'${this.$name}.${name}': Something got wrong when calculating the remaining bit-count '${remainingBitCount}' of previous member '${prev.$name}'`);
    }

    if (remainingBitCount) {
      if (!(flags & FLAGS.PRIMITIVE))
        fail(`'${this.$name}.${name}': Detected an unclosed bit-field, member '${prev.$name}' still has '${remainingBitCount}' remaining bits left`);

      if (prev.$size !== size)
        fail(`'${this.$name}.${name}': Bit-field size mismatch, member '${prev.$name}' has size '${prev.$size}' while '${name}' has size '${size}'`);

      if (bitSize > remainingBitCount)
        fail(`'${this.$name}.${name}': Bit-field size mismatch, cannot fit '${bitSize}' bits in '${remainingBitCount}' remaining bits`);
    }

    if (flags & FLAGS.PRIMITIVE) {
      // Handle bit-field specified by `$bitSize` ($bitShift and $bitMask are always deduced).
      if (bitSize) {
        if (remainingBitCount) {
          const bitMask = bitMaskOf(bitSize) << remainingBitShift;

          member.$offset = prev.$offset;
          member.$bitMask = bitMask;
          member.$bitShift = remainingBitShift;

          advance = false;
        }
        else {
          member.$bitMask = bitMaskOf(bitSize) | 0;
          member.$bitShift = 0;
        }
      }
    }
    else if (flags & FLAGS.ARRAY) {
      // Handle array.
      const ref = member.$ref;
      const length = member.$length;

      // Handle a fixed-length array.
      if (typeof length === "number") {
        const fixedLength = length;

        size = ref.$size * fixedLength;
        member.$size = size;
      }
    }

    // Now add the newly created member to members array and the struct itself.
    members.push(member);
    this[name] = member;

    // Only advance when necessary.
    if (advance) {
      member.$offset = this.$size;
      this.$size += size;
    }

    return this;
  }

  $addMembers(arr) {
    for (var i = 0; i < arr.length; i++)
      this.$addMember(arr[i]);
    return this;
  }
}
binlib.Struct = Struct;

// ============================================================================
// binlib.BuiltInTypes]
// ============================================================================

const I8    = binlib.I8    = freeze(new Type({ $name: "I8"   , $size: 1, $flags: FLAGS.PRIMITIVE    | FLAGS.SIGNED   }));
const U8    = binlib.U8    = freeze(new Type({ $name: "U8"   , $size: 1, $flags: FLAGS.PRIMITIVE    | FLAGS.UNSIGNED }));
const I16LE = binlib.I16LE = freeze(new Type({ $name: "I16LE", $size: 2, $flags: FLAGS_PRIMITIVE_LE | FLAGS.SIGNED   }));
const I16BE = binlib.I16BE = freeze(new Type({ $name: "I16BE", $size: 2, $flags: FLAGS_PRIMITIVE_BE | FLAGS.SIGNED   }));
const U16LE = binlib.U16LE = freeze(new Type({ $name: "U16LE", $size: 2, $flags: FLAGS_PRIMITIVE_LE | FLAGS.UNSIGNED }));
const U16BE = binlib.U16BE = freeze(new Type({ $name: "U16BE", $size: 2, $flags: FLAGS_PRIMITIVE_BE | FLAGS.UNSIGNED }));
const I24LE = binlib.I24LE = freeze(new Type({ $name: "I24LE", $size: 3, $flags: FLAGS_PRIMITIVE_LE | FLAGS.SIGNED   }));
const I24BE = binlib.I24BE = freeze(new Type({ $name: "I24BE", $size: 3, $flags: FLAGS_PRIMITIVE_BE | FLAGS.SIGNED   }));
const U24LE = binlib.U24LE = freeze(new Type({ $name: "U24LE", $size: 3, $flags: FLAGS_PRIMITIVE_LE | FLAGS.UNSIGNED }));
const U24BE = binlib.U24BE = freeze(new Type({ $name: "U24BE", $size: 3, $flags: FLAGS_PRIMITIVE_BE | FLAGS.UNSIGNED }));
const I32LE = binlib.I32LE = freeze(new Type({ $name: "I32LE", $size: 4, $flags: FLAGS_PRIMITIVE_LE | FLAGS.SIGNED   }));
const I32BE = binlib.I32BE = freeze(new Type({ $name: "I32BE", $size: 4, $flags: FLAGS_PRIMITIVE_BE | FLAGS.SIGNED   }));
const U32LE = binlib.U32LE = freeze(new Type({ $name: "U32LE", $size: 4, $flags: FLAGS_PRIMITIVE_LE | FLAGS.UNSIGNED }));
const U32BE = binlib.U32BE = freeze(new Type({ $name: "U32BE", $size: 4, $flags: FLAGS_PRIMITIVE_BE | FLAGS.UNSIGNED }));
const F32LE = binlib.F32LE = freeze(new Type({ $name: "F32LE", $size: 4, $flags: FLAGS_PRIMITIVE_LE | FLAGS.FLOAT    }));
const F32BE = binlib.F32BE = freeze(new Type({ $name: "F32BE", $size: 4, $flags: FLAGS_PRIMITIVE_BE | FLAGS.FLOAT    }));
const F64LE = binlib.F64LE = freeze(new Type({ $name: "F64LE", $size: 8, $flags: FLAGS_PRIMITIVE_LE | FLAGS.FLOAT    }));
const F64BE = binlib.F64BE = freeze(new Type({ $name: "F64BE", $size: 8, $flags: FLAGS_PRIMITIVE_BE | FLAGS.FLOAT    }));

const Str   = binlib.Str   = freeze(new Type({ $name: "Str"  , $size: 0, $flags: FLAGS.STRING       | FLAGS.ASCII    }));
const Hex   = binlib.Hex   = freeze(new Type({ $name: "Hex"  , $size: 0, $flags: FLAGS.STRING       | FLAGS.HEX      }));
const Arr   = binlib.Array = freeze(new Type({ $name: "Array", $size: 0, $flags: FLAGS.ARRAY                         }));

const BuiltInTypes = freeze([
  I8,
  U8,
  I16LE, I16BE,
  U16LE, U16BE,
  I24LE, I24BE,
  U24LE, U24BE,
  I32LE, I32BE,
  U32LE, U32BE,
  F32LE, F32BE,
  F64LE, F64BE,
  Str,
  Hex,
  Arr
]);

// ============================================================================
// binlib.DataIO]
// ============================================================================

function readPrimitiveValue(buffer, offset, size, flags) {
  // console.log(`READ [${offset}] of size '${size}'`);

  switch (flags & FLAGS_PRIMITIVE_ALL) {
    case FLAGS.PRIMITIVE | FLAGS.SIGNED:
      if (size === 1)
        return buffer.getInt8(offset);
      break;

    case FLAGS_PRIMITIVE_LE | FLAGS.SIGNED:
      switch (size) {
        case 1: return buffer.getInt8(offset);
        case 2: return buffer.getInt16(offset, true);
        case 4: return buffer.getInt32(offset, true);

        case 3: return (buffer.getUint8(offset + 0)      ) +
                       (buffer.getUint8(offset + 1) <<  8) +
                       (buffer.getInt8 (offset + 2) << 16) ;
      }
      break;

    case FLAGS_PRIMITIVE_BE | FLAGS.SIGNED:
      switch (size) {
        case 1: return buffer.getInt8(offset);
        case 2: return buffer.getInt16(offset, false);
        case 4: return buffer.getInt32(offset, false);

        case 3: return (buffer.getInt8 (offset + 0) << 16) +
                       (buffer.getUint8(offset + 1) <<  8) +
                       (buffer.getUint8(offset + 2)      ) ;

      }
      break;

    case FLAGS.PRIMITIVE | FLAGS.UNSIGNED:
      if (size === 1)
        return buffer.getUint8(offset);
      break;

    case FLAGS_PRIMITIVE_LE | FLAGS.UNSIGNED:
      switch (size) {
        case 1: return buffer.getUint8(offset);
        case 2: return buffer.getUint16(offset, true);
        case 4: return buffer.getUint32(offset, true);

        case 3: return (buffer.getUint8(offset + 0)      ) +
                       (buffer.getUint8(offset + 1) <<  8) +
                       (buffer.getUint8(offset + 2) << 16) ;
      }
      break;

    case FLAGS_PRIMITIVE_BE | FLAGS.UNSIGNED:
      switch (size) {
        case 1: return buffer.getUint8(offset);
        case 2: return buffer.getUint16(offset, false);
        case 4: return buffer.getUint32(offset, false);

        case 3: return (buffer.getUint8(offset + 0) << 16) +
                       (buffer.getUint8(offset + 1) <<  8) +
                       (buffer.getUint8(offset + 2)      ) ;
      }
      break;

    case FLAGS_PRIMITIVE_LE | FLAGS.FLOAT:
      switch (size) {
        case 4: return buffer.getFloat32(offset, true);
        case 8: return buffer.getFloat64(offset, true);
      }
      break;

    case FLAGS_PRIMITIVE_BE | FLAGS.FLOAT:
      switch (size) {
        case 4: return buffer.getFloat32(offset, false);
        case 8: return buffer.getFloat64(offset, false);
      }
      break;
  }

  fail(`Cannot read a primitive value of [size=${size} flags=${dumpFlags(flags)}]`);
}

function readStringValue(buffer, offset, size, flags) {
  const encoding = encodingFromFlags(flags);
  var str = "";

  const end = offset + size;
  if (encoding === "hex") {
    for (var i = offset; i < end; i++) {
      const octet = buffer.getUint8(i);
      const hi = octet >>> 4;
      const lo = octet & 0xF;

      str += String.fromCharCode(hexToAscii(hi),
                                 hexToAscii(lo));
    }
  }
  else {
    for (var i = offset; i < end; i++) {
      const octet = buffer.getUint8(i);
      str += String.fromCharCode(octet);
    }

    // Remove trailing NULLs.
    var len = str.length;
    while (len && str.charCodeAt(len - 1) === 0)
      len--;

    return str.substr(0, len);
  }
}

function writePrimitiveValue(buffer, offset, size, flags, value) {
  // const oldValue = readPrimitiveValue(buffer, offset, size, flags);
  // if (oldValue !== value) {
  //   console.log(`WRITE [${offset}] of size '${size}' from '${oldValue}' to '${value}'`);
  // }

  switch (flags & FLAGS_PRIMITIVE_ALL) {
    case FLAGS.PRIMITIVE | FLAGS.SIGNED:
    case FLAGS.PRIMITIVE | FLAGS.UNSIGNED:
      switch (size) {
        case 1:
          buffer.setUint8(offset, value & 0xFF);
          return;
      }
      break;

    case FLAGS_PRIMITIVE_LE | FLAGS.SIGNED:
    case FLAGS_PRIMITIVE_LE | FLAGS.UNSIGNED:
      switch (size) {
        case 1:
          buffer.setUint8(offset, value & 0xFF);
          return;

        case 2:
          buffer.setUint16(offset, value & 0xFFFF, true);
          return;

        case 4:
          buffer.setUint32(offset, value & 0xFFFFFFFF, true);
          return;

        case 3:
          buffer.setUint8(offset + 0, (value      ) & 0xFF);
          buffer.setUint8(offset + 1, (value >>  8) & 0xFF);
          buffer.setUint8(offset + 2, (value >> 16) & 0xFF);
          return;
      }
      break;

    case FLAGS_PRIMITIVE_BE | FLAGS.SIGNED:
    case FLAGS_PRIMITIVE_BE | FLAGS.UNSIGNED:
      switch (size) {
        case 1:
          buffer.setUint8(offset, value & 0xFF);
          return;

        case 2:
          buffer.setUint16(offset, value & 0xFFFF, false);
          return;

        case 4:
          buffer.setUint32(offset, value & 0xFFFFFFFF, false);
          return;

        case 3:
          buffer.setUint8(offset + 0, (value >> 16) & 0xFF);
          buffer.setUint8(offset + 1, (value >>  8) & 0xFF);
          buffer.setUint8(offset + 2, (value      ) & 0xFF);
          return;
      }
      break;

    case FLAGS_PRIMITIVE_LE | FLAGS.FLOAT:
      switch (size) {
        case 4:
          buffer.setFloat32(offset, value, true);
          return;

        case 8:
          buffer.setFloat64(offset, value, true);
          return;
      }
      break;

    case FLAGS_PRIMITIVE_BE | FLAGS.FLOAT:
      switch (size) {
        case 4:
          buffer.setFloat32(offset, value, false);
          return;

        case 8:
          buffer.setFloat64(offset, value, false);
          return;
      }
      break;
  }

  fail(`Cannot write a primitive value of [size=${size} flags=${dumpFlags(flags)}]`);
}

function writeStringValue(buffer, offset, size, flags, value) {
  const encoding = encodingFromFlags(flags);
  var i = 0;

  if (encoding === "hex") {
    const nBytes = Math.floor(Math.min(value.length * 2, size) / 2);
    for (i = 0; i < nBytes; i++) {
      const hi = asciiToHex(value.charCodeAt(i * 2 + 0));
      const lo = asciiToHex(value.charCodeAt(i * 2 + 1));
      buffer.setUint8(offset + i, (hi << 4) | lo);
    }
  }
  else {
    const nBytes = Math.min(value.length, size);
    for (i = 0; i < nBytes; i++)
      buffer.setUint8(offset + i, value.charCodeAt(i));
  }

  // Zero pad.
  while (i < size) {
    buffer.setUint8(offset + i, 0);
    i++
  }
}

// ============================================================================
// binlib.DataAccess]
// ============================================================================

class DataAccess {
  constructor(context, opt) {
    const buffer    = dataViewOf(opt.buffer);
    const log       = typeof opt.log      === "function" ? opt.log      : dummy;

    const path      = typeof opt.path     === "string"   ? opt.path     : "";
    const maxDepth  = typeof opt.maxDepth === "number"   ? opt.maxDepth : Infinity;
    const filter    = typeof opt.filter   === "function" ? opt.filter   : returnTrue;

    const length    = typeof opt.length   === "number"   ? opt.length   : buffer.byteLength;
    const start     = typeof opt.start    === "number"   ? opt.start    : 0;
    const end       = typeof opt.end      === "number"   ? opt.end      : length;
    const absFrom   = typeof opt.absFrom  === "number"   ? opt.absFrom  : start;
    const offset    = typeof opt.offset   === "number"   ? opt.offset   : start;

    this.context    = context; // Context.
    this.log        = log;     // Logger callback.

    this.path       = path;    // Current JSON path.
    this.filter     = filter;  // Filter.
    this.depth      = 0;       // Current Depth.
    this.maxDepth   = maxDepth;// Maximum depth.

    // If buffer window is [0, buffer.length) then there is no window.
    // It's optional to load from views without creating sub-views.
    //
    // NOTE: It shouldn't happen that the offset is less or greater
    // than the window, it should always define the `buffer`.
    this.buffer     = buffer;  // DataView instance we work with.
    this.start      = start;   // DataView window (start position).
    this.end        = end;     // DataView window (end position).

    this.absFrom    = absFrom; // Base address added to all absolute offsets to calculate the final one.
    this.offset     = offset;  // Current offset in `buffer`.
  }

  get length() {
    return this.end - this.start;
  }

  _nestPath(path) {
    return this.path ? `${this.path}.${path}` : path;
  }
}
binlib.DataAccess = DataAccess;

// ============================================================================
// binlib.DataReader]
// ============================================================================

class DataReader extends DataAccess {
  constructor(context, opt) {
    super(context, opt);
  }

  readRoot(type) {
    if (!(type.$flags & FLAGS.STRUCT))
      fail(`'${type.$name}': Cannot be used as root type`);

    return this.readObject(type, newObject({
      type: type,
      rawOffset: -1,
      absOffset: this.offset
    }));
  }

  readObject(type, object) {
    const meta = object.$meta;
    const absOffset = meta.absOffset;

    this.offset = absOffset;
    if (type.$flags & FLAGS.ISOLATE)
      this.absFrom = absOffset;

    var members = type.$members;
    if (members.length) {
      var i = 0;
      for (;;) {
        const member = members[i];
        const value = this.readMember(type, object, member);

        if (value !== undefined)
          object[member.$name] = value;

        if (++i >= members.length) {
          if (!type.$version && type.$verInfo) {
            // After we read all members it's time to recheck the struct version.
            const updatedName = fullNameFromPartialObject(object, type);
            const updatedType = this.context.$getStruct(updatedName);

            if (updatedType) {
              type = updatedType;
              members = type.$members;
              object.$meta.type = updatedType;
            }
            else {
              this.log(`'${this.path || "[root]"}': Couldn't find versioned type '${updatedName}'`);
            }

            // Terminate if the specific version doesn't provide new members.
            if (i < members.length)
              continue;
          }
          break;
        }
      }
    }

    this.offset = absOffset + type.$size;
    return object;
  }

  readNested(type, path, start, rawOffset, absOffset) {
    const oldPath = this.path;
    const oldStart = this.start;
    const oldOffset = this.offset;
    const oldAbsFrom = this.absFrom;

    this.path = path;
    this.start = start;
    this.offset = absOffset;

    const object = newObject({
      type: type,
      rawOffset: rawOffset,
      absOffset: absOffset
    });

    this.depth++;
    this.readObject(type, object);
    this.depth--;

    this.path = oldPath;
    this.start = oldStart;
    this.offset = oldOffset;
    this.absFrom = oldAbsFrom;

    return object;
  }

  readMember(type, object, member) {
    const name = member.$name;
    const size = member.$size;
    const flags = member.$flags;

    var offset = member.$offset;
    // console.log(`READING ${type.$name}.${member.$name} at ${offset}`);

    if (flags & FLAGS.PRIMITIVE) {
      var value = readPrimitiveValue(this.buffer, this.offset + offset, size, flags);

      // Handle bit-field.
      if (member.$bitMask) {
        const shl = clz32(member.$bitMask);
        const shr = shl + member.$bitShift;

        value <<= shl;
        value = (flags & FLAGS.SIGNED) ? value >> shr : value >>> shr;
      }

      const ref = member.$ref;
      if (!ref) return value;

      // Handle sub-structures referenced by absolute or relative offset.
      const rawOffset = value;
      const absOffset = (member.$flags & FLAGS.ABSOLUTE_OFFSET) ? this.absFrom + value
                                                                : this.offset + value;
      // The object if reference doesn't exist.
      if (rawOffset === 0)
        return null;

      const path = this._nestPath(name);
      if (this.depth >= this.maxDepth || !this.filter(path))
        return newObject({ type: ref, rawOffset: rawOffset, absOffset: absOffset });
      else
        return this.readNested(ref, path, this.start, rawOffset, absOffset);
    }
    else if (flags & FLAGS.STRING) {
      return readStringValue(this.buffer, this.offset + offset, size, flags);
    }
    else if (flags & FLAGS.ARRAY) {
      var ref = member.$ref;
      var count = (typeof member.$length === "number") ? member.$length :
                  (typeof member.$length === "string") ? object[member.$length] || 0 : 0;

      if (member.$version) {
        // TODO: Should be a bit better.
        const fullType = ref.$name + "$" + object[member.$version];
        ref = this.context.$getType(fullType);
        if (!ref) {
          this.log(`${type.$name}.${member.$name}: Couldn't get a versioned array entry type '${fullType}'`);
          return undefined;
        }
      }

      var array = [];
      var subOffset = this.offset + offset;

      for (var j = 0; j < count; j++) {
        const path = this._nestPath(`${name}[${j}]`);
        if (ref.$flags & FLAGS.PRIMITIVE)
          array.push(readPrimitiveValue(this.buffer, subOffset, ref.$size, ref.$flags));
        else
          array.push(this.readNested(ref, path, this.start, -1, subOffset));
        subOffset += ref.$size;
      }

      return array;
    }
    else if (flags & FLAGS.STRUCT) {
      const ref = member.$type;
      const path = this._nestPath(name);
      return this.readNested(ref, path, this.start, -1, this.offset + offset);
    }
    else {
      fail(`'${type.$name}.${member.$name}': Unhandled type '${member.$type.$name}'`);
    }
  }
}
binlib.DataReader = DataReader;

// ============================================================================
// binlib.DataUpdater]
// ============================================================================

class DataUpdater extends DataAccess {
  constructor(context, params) {
    super(context, params);
  }

  updateRoot(root) {
    const meta = root.$meta;
    const type = meta.type;

    if (!type)
      fail(`Cannot update object without type information at [${meta.absOffset}]`);

    this.updateObject(root, type);
  }

  updateObject(object, type) {
    const members = type.$members;
    for (var i = 0; i < members.length; i++) {
      const member = members[i];
      const k = member.$name;

      if (!hasOwn.call(object, k))
        continue;

      const size = member.$size;
      const flags = member.$flags;

      var offset = this.offset + member.$offset;
      var value = object[k];

      if (flags & FLAGS.PRIMITIVE) {
        var nestedObject = null;

        if (member.$ref) {
          if (typeof value !== "object")
            fail(`UPDATE: Invalid value type, expected object, got '${typeof value}'`);

          nestedObject = value;
          value = nestedObject != null ? nestedObject.$meta.rawOffset : 0;
        }

        // Handle bit-field.
        var primitiveValue = value;
        if (member.$bitMask) {
          const bitMask = member.$bitMask;
          primitiveValue = ((value << member.$bitShift) & bitMask) |
                           (readPrimitiveValue(this.buffer, offset, size, flags) & ~bitMask);
        }
        writePrimitiveValue(this.buffer, offset, size, flags, primitiveValue);

        if (member.$ref && nestedObject) {
          const nestedType = nestedObject.$meta.type;
          const nestedOffset = member.$flags & FLAGS.ABSOLUTE_OFFSET ? this.absFrom + value
                                                                     : this.offset + value;
          if (nestedType) {
            this.updateNested(nestedObject, nestedType, member.$name, nestedOffset);
          }
          else {
            this.log(`Couldn't merge '${member.$ref}' struct, not found`);
          }
        }
      }
      else if (flags & FLAGS.STRING) {
        writeStringValue(this.buffer, offset, member.$size, member.$flags, value);
      }
      else if (flags & FLAGS.ARRAY) {
        if (!isArray(value)) {
          this.log(`'${k}' should be array`);
          continue;
        }

        const ref = member.$ref;
        const count = (typeof member.$length === "number") ? member.$length :
                      (typeof member.$length === "string") ? object[member.$length] || 0 : 0;

        const array = value;
        if (array.length !== count) {
          this.log(`Number of array entrties of '${k}' mismatch: ${array.length} != ${numStoredEntries}`);
          continue;
        }

        var subOffset = offset;
        for (var j = 0; j < count; j++) {
          if (ref.$flags & FLAGS.PRIMITIVE)
            writePrimitiveValue(this.buffer, subOffset, ref.$size, ref.$flags, array[j]);
          else
            this.updateNested(array[j], ref, `${member.$name}[${j}]`, subOffset);
          subOffset += ref.$size;
        }
      }
      else if (flags & FLAGS.STRUCT) {
        if (typeof value !== "object")
          fail(`UPDATE: Invalid value type, expected object, got '${typeof value}'`);

        const nestedObject = value;
        this.updateNested(nestedObject, member.$type, member.$name, offset);
      }
      else {
        this.log(`Unhandled '${member.$name}'`);
      }
    }
  }

  updateNested(obj, type, path, offset) {
    const oldPath = this.path;
    const oldOffset = this.offset;
    const oldAbsFrom = this.absFrom;

    this.path = this.path ? `${this.path}.${path}` : path;
    this.offset = offset;

    this.updateObject(obj, type);

    this.path = oldPath;
    this.offset = oldOffset;
    this.absFrom = oldAbsFrom;
  }
}
binlib.DataUpdater = DataUpdater;

// ============================================================================
// binlib.Context]
// ============================================================================

class Context {
  constructor(opt) {
    // Some libraries don't use binlib directly, just the context. This
    // makes it easier to access binlib.js through the context at any time.
    this.$binlib = binlib;

    // Built-in types are always added to the context, but never recognized
    // by $hasStruct() and $getStruct().
    for (var i = 0; i < BuiltInTypes.length; i++) {
      const type = BuiltInTypes[i];
      this[type.$name] = type;
    }

    if (opt)
      this.$init(opt);
  }

  $init(opt) {
    // Unused...
  }

  $hasType(name) { return this.$getType(name) !== null; }
  $hasStruct(name) { return this.$getStruct(name) !== null; }

  $getType(name) {
    return this[name] || null;
  }

  $getStruct(name) {
    const type = this[name];
    return (type && (type.$flags & FLAGS.STRUCT)) ? type : null;
  }

  $define(opt) {
    if (isArray(opt)) {
      const arr = opt;
      for (var i = 0; i < arr.length; i++)
        this.$define(arr[i]);
      return this;
    }
    else {
      const type = new Struct(opt);
      const name = fullNameOf(type.$name, type.$version);

      if (hasOwn.call(this, name))
        fail(`Context error, '${name}' is already defined`);

      this[name] = type;
      return this;
    }
  }

  $readObject(params) {
    if (!isObject(params))
      fail("Invalid argument: 'params' must be Object");

    if (!isObject(params.type))
      fail("Invalid argument: 'params.type' must be Type");

    return (new DataReader(this, params)).readRoot(params.type);
  }

  $updateObject(params) {
    if (!isObject(params))
      fail("Invalid argument: 'params' must be object");

    if (!isObject(params.object))
      fail("Invalid argument: 'params.object' must be Object");

    return (new DataUpdater(this, params)).updateRoot(params.object);
  }
}
binlib.Context = Context;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this, "binlib"]);
