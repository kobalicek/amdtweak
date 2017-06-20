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
//   * Allow to decompose a struct into a JS object (including substructs).
//   * Allow to merge data back from JS object to a Buffer.
//
// The following built-in types are provided:
//
//   * I8/U8   - Signed/Unsigned 8-bit integer.
//   * I16/U16 - Signed/Unsigned 16-bit integer.
//   * I24/U24 - Signed/Unsigned 24-bit integer.
//   * I32/U32 - Signed/Unsigned 32-bit integer.
//   * Str     - String of fixed size, decomposed to a string as ASCII.
//   * Hex     - String of fixed size, decomposed to a string as HEX.
//   * Arr     - Array of fixed or variable size.
// ============================================================================

(function($export, $as) {
"use strict";

const binlib = Object.create(null);
const hasOwn = Object.prototype.hasOwnProperty;

$export[$as] = binlib;

const Flags = {
  None           : 0x00000000,
  Primitive      : 0x00000001,
  String         : 0x00000002,
  Struct         : 0x00000004,
  Array          : 0x00000008,
  SInt           : 0x00000010,
  UInt           : 0x00000020,
  Hex            : 0x00000040
};
binlib.Flags = Flags;

function makeBits32(x) { return x >= 32 ? 0xFFFFFFFF : (1 << x) - 1; }
function clz32(x) { return Math.clz32(x); }
function ctz32(x) { return 31 - Math.clz32(x ^ (x - 1)); }

function hasVersion(name) {
  return name.indexOf('$') !== -1;
}

function combineNameAndVersion(name, version) {
  if (version && version.length)
    return name + "$" + version.join(".");
  else
    return name;
}

function asHex(x) {
  return String.fromCharCode(x + (x <= 9 ? 48 : 65));
}

class Type {
  constructor(opt) {
    this.$name = "";
    this.$size = 0;
    this.$flags = 0;

    if (opt)
      this.$init(opt);
  }

  get $fullName() { return this.$name; }

  $init(opt) {
    if (hasOwn.call(opt, "$name")) this.$name = opt.$name;
    if (hasOwn.call(opt, "$size")) this.$size = opt.$size;
    if (hasOwn.call(opt, "$flags")) this.$flags |= opt.$flags;
  }

  $readValue(ctx, buf, offset) {
    throw Error(`Cannot read value of type '${this.$name}' at [${offset}]`);
  }

  $readMember(ctx, buf, offset, m) {
    return this.$readValue(ctx, buf, offset + m.$offset);
  }

  $writeValue(ctx, buf, offset, value) {
    throw Error(`Cannot write value of type '${this.$name}' at [${offset}]`);
  }

  $writeMember(ctx, buf, offset, m, value) {
    return this.$writeValue(ctx, buf, offset + m.$offset, value);
  }
}
binlib.Type = Type;

class PrimitiveType extends Type {
  constructor(opt) {
    super(null);
    this.$flags |= Flags.Primitive;

    if (opt)
      this.$init(opt);
  }

  $readValue(ctx, buf, offset) {
    const size = this.$size;
    if (this.$flags & Flags.SInt) {
      switch (size) {
        case 1: return buf.readInt8(offset);
        case 2: return buf.readInt16LE(offset);
        case 3: return buf.readUInt16LE(offset) | (buf.readInt8(offset + 2) << 16);
        case 4: return buf.readInt32LE(offset);
      }
    }
    else {
      switch (size) {
        case 1: return buf.readUInt8(offset);
        case 2: return buf.readUInt16LE(offset);
        case 3: return buf.readUInt16LE(offset) | (buf.readUInt8(offset + 2) << 16);
        case 4: return buf.readUInt32LE(offset);
      }
    }

    throw Error(`Cannot read value of type '${this.$type}' that has invalid size '${size}'`);
  }

  $readMember(ctx, buf, offset, m) {
    const moff = offset + m.$offset;
    const value = this.$readValue(ctx, buf, moff);

    const bitMask = m.$bitMask;
    if (bitMask === 0) return value;

    const shl = clz32(bitMask);
    const shr = shl + m.$bitOffset;

    const x = value << shl;
    return (m.$flags & Flags.SInt) ? x >> shr : x >>> shr;
  }

  $writeValue(ctx, buf, offset, value) {
    const size = this.$size;
    switch (size) {
      case 1:
        buf.writeUInt8(value & 0xFF, offset);
        return;
      case 2:
        buf.writeUInt16LE(value & 0xFFFF, offset);
        return;
      case 3:
        buf.writeUInt16LE(value & 0xFFFF, offset);
        buf.writeUInt8((value >> 16) & 0xFF, offset + 2);
        return;
      case 4:
        buf.writeUInt32LE(value & 0xFFFFFFFF, offset);
        return;
    }

    throw Error(`Cannot write value of type '${this.$type}' that has invalid size '${size}'`);
  }

  $writeMember(ctx, buf, offset, m, value) {
    const moff = offset + m.$offset;
    const bitMask = m.$bitMask;

    if (bitMask !== 0) {
      const prev = this.$readValue(ctx, buf, offset);
      value <<= m.$bitOffset;
      value = (value & bitMask) |
              (prev & ~bitMask) ;

    }

    return this.$writeValue(ctx, buf, moff, value);
  }
}
binlib.PrimitiveType = PrimitiveType;

class StringType extends Type {
  constructor(opt) {
    super(null);
    this.$flags |= Flags.String;

    if (opt)
      this.$init(opt);
  }

  $readMember(ctx, buf, offset, m) {
    const moff = m.$offset + offset;
    const size = m.$size;
    const flags = m.$flags;

    if (flags & Flags.Hex) {
      return buf.toString("hex", moff, moff + size);
    }
    else {
      var str = buf.toString("ascii", moff, moff + size);
      var len = str.length;

      // Remove trailing NULLs.
      while (len && str.charCodeAt(len - 1) === 0)
        len--;

      return str.substr(0, len);
    }
  }

  $writeMember(ctx, buf, offset, m, value) {
    const size = m.$size;
    const moff = m.$offset + offset;
    const flags = m.$flags;

    var nBytes = 0;
    if (flags & Flags.Hex) {
      buf.write(value, moff, size, "hex");
      nBytes = Math.floor(value.length / 2);
    }
    else {
      buf.write(value, moff, size, "ascii");
      nBytes = value.length;
    }

    const remain = size - Math.min(nBytes, size);
    if (remain)
      buf.fill(0, moff + nBytes, moff + nBytes + remain);
  }
}
binlib.StringType = StringType;

class ArrayType extends Type {
  constructor(opt) {
    super(null);
    this.$flags |= Flags.Array;

    if (opt)
      this.$init(opt);
  }
}
binlib.ArrayType = ArrayType;

class Member {
  constructor(opt) {
    this.$name   = "";         // Member name.
    this.$type   = null;       // Member type, references a `Type` instance.
    this.$size   = 0;          // Member size, in bytes.
    this.$flags  = 0;          // Member flags, see `Flags`.

    this.$offset = 0;          // Member offset relative to the struct (bytes).
    this.$unit   = null;       // Member's value unit.
    this.$ref    = null;       // Reference to another `Type` or `Struct`.
    this.$length = null;

    this.$bitMask   = 0;       // Member bit-mask, in case this is a BitField.
    this.$bitOffset = 0;       // Member shift, in case this is a BitField.

    if (opt)
      this.$init(opt);
  }

  $init(opt) {
    for (var k in opt) {
      const v = opt[k];
      switch (k) {
        case "$type":
          this.$type = v;
          this.$size = v.$size;
          this.$flags |= v.$flags;
          break;

        case "$flags":
          this.$flags |= v;
          break;

        case "$bitSize":
          // Must be handled by `Struct.$add`.
          break;

        case "$ref":
          if (v === undefined)
            throw Error(`Reference $ref of member '${this.$name}' cannot be undefined, use null instead`);

          this.$ref = v;
          break;

        default:
          this[k] = v;
          break;
      }
    }

    // Handle fixed strings.
    if (this.$flags & Flags.String) {
      this.$size = this.$length;
    }
  }

  $read(ctx, buf, offset) {
    return this.$type.$readMember(ctx, buf, offset, this);
  }

  $write(ctx, buf, offset, value) {
    return this.$type.$writeMember(ctx, buf, offset, this, value);
  }
}
binlib.Member = Member;

class StructType extends Type {
  constructor(opt) {
    super(null);

    this.$flags |= Flags.Struct;
    this.$verInfo = null; // Version info, like ["RevisionID"].
    this.$version = null; // Version data, like [0].
    this.$members = [];

    if (opt)
      this.$init(opt);
  }

  get $fullName() {
    const name = this.$name;
    const version = this.$version;

    if (!version)
      return name;

    var fullName = name;
    for (var i = 0; i < version.length; i++)
      fullName += (i === 0 ? "$" : ".") + String(version[i]);
    return fullName;
  }

  $init(opt) {
    super.$init(opt);

    const ext = opt.$extend;
    if (ext) {
      if (!this.$name && ext.$name)
        this.$name = ext.$name;

      if (ext.$verInfo)
        this.$verInfo = ext.$verInfo;

      this.$add(ext.$members);
    }

    for (var k in opt) {
      if (k === "$extend" || k === "$members")
        continue;
      this[k] = opt[k];
    }

    if (opt.$members)
      this.$add(opt.$members);
  }

  $add(opt) {
    if (Array.isArray(opt)) {
      const arr = opt;
      for (var i = 0; i < arr.length; i++)
        this.$add(arr[i]);
      return this;
    }

    const k = opt.$name;
    if (hasOwn.call(this, k))
      throw Error(`'${this.$name}.${k}' already exists`);

    const members = this.$members;
    const m = new Member(opt);

    members.push(m);
    this[k] = m;

    var size = m.$size;
    const flags = m.$flags;

    if (flags & Flags.Primitive) {
      const bitSize = opt.$bitSize;
      if (bitSize != null) {
        if (bitSize <= 0)
          throw Error(`The '$bitSize' attribute '${bitSize}' cannot be zero or less`);

        const nativeBitSize = size * 8;
        if (bitSize > nativeBitSize)
          throw Error(`The '$bitSize' attribute '${bitSize}' cannot be greater than a native type size '${nativeBitSize}'`);

        const prev = members.length > 1 ? members[members.length - 2] : null;
        if (prev && (prev.$flags & Flags.Primitive) && prev.$size === size) {
          const prevMask = prev.$bitMask;
          if (prevMask) {
            const nLeadingZeros = clz32(prevMask);
            const nRemainingBits = nLeadingZeros - (32 - nativeBitSize);

            if (nRemainingBits) {
              if (nRemainingBits < bitSize)
                throw Error(`Invalid bit-field, member '${m.$name}' of bit-size '${bitSize}' cannot be packed to '${nRemainingBits}' bits`);

              const bitOffset = 32 - nLeadingZeros;
              m.$offset = prev.$offset;
              m.$bitMask = (makeBits32(bitSize) << bitOffset) | 0;
              m.$bitOffset = bitOffset;
              return this;
            }
          }
        }

        m.$bitMask = makeBits32(bitSize) | 0;
        m.$bitOffset = 0;
      }
    }
    else if (flags & Flags.Array) {
      // Fixed length array.
      const itemType = m.$ref;
      const length = m.$length;

      if (typeof length === "number") {
        const fixedLength = length;
        size = itemType.$size * fixedLength;

        m.$size = size;
      }
    }

    m.$offset = this.$size;
    this.$size += size;

    return this;
  }
}
binlib.StructType = StructType;

const I8  = binlib.I8  = new PrimitiveType({ $name: "I8" , $size: 1, $flags: Flags.SInt });
const U8  = binlib.U8  = new PrimitiveType({ $name: "U8" , $size: 1, $flags: Flags.UInt });
const I16 = binlib.I16 = new PrimitiveType({ $name: "I16", $size: 2, $flags: Flags.SInt });
const U16 = binlib.U16 = new PrimitiveType({ $name: "U16", $size: 2, $flags: Flags.UInt });
const I24 = binlib.I24 = new PrimitiveType({ $name: "I24", $size: 3, $flags: Flags.SInt });
const U24 = binlib.U24 = new PrimitiveType({ $name: "U24", $size: 3, $flags: Flags.UInt });
const I32 = binlib.I32 = new PrimitiveType({ $name: "I32", $size: 4, $flags: Flags.SInt });
const U32 = binlib.U32 = new PrimitiveType({ $name: "U32", $size: 4, $flags: Flags.UInt });
const Str = binlib.Str = new StringType({ $name: "Str", $size:-1 });
const Hex = binlib.Hex = new StringType({ $name: "Hex", $size:-1, $flags: Flags.Hex });
const Arr = binlib.Array = new ArrayType({ $name: "Array", $size: 0 });

const BuiltInTypes = [I8, U8, I16, U16, I24, U24, I32, U32, Str, Hex, Arr];

class Context {
  constructor(opt) {
    this.$verbose = true;
    this.$addType(BuiltInTypes);

    if (opt)
      this.$addStruct(opt);
  }

  $log(s) {
    if (this.$verbose)
      console.log(s);
  }

  $hasType(name) { return this[name] != null; }
  $getType(name) { return this[name] || null; }

  $getStruct(name) {
    const type = this[name];
    return (type && (type.$flags & Flags.Struct)) ? type : null;
  }

  $getStructFromData(name, obj) {
    var type = this.$getStruct(name);
    if (!type) return null;

    if (type.$version)
      return type;

    if (!type.$verInfo)
      return null;

    for (var i = 0; i < verInfo.length; i++)
      name += (i === 0 ? "$" : ".") + obj[verInfo[i]];
    return this.$getStruct(name);
  }

  $addType(type) {
    if (Array.isArray(type)) {
      const arr = type;
      for (var i = 0; i < arr.length; i++)
        this.$addType(arr[i]);
      return this;
    }
    else {
      const fullName = combineNameAndVersion(type.$name, type.$version);
      if (hasOwn.call(this, fullName))
        throw Error(`Context error, '${fullName}' is already defined`);

      this[fullName] = type;
      return this;
    }
  }

  $addStruct(opt) {
    if (Array.isArray(opt)) {
      const arr = opt;
      for (var i = 0; i < arr.length; i++)
        this.$addStruct(arr[i]);
      return this;
    }
    else {
      return this.$addType(new StructType(opt));
    }
  }

  $readValue(buf, offset, type) {
    return type.$readValue(this, buf, offset);
  }

  $readMember(buf, offset, m) {
    return m ? m.$read(this, buf, offset) : undefined;
  }

  $writeValue(buf, offset, type, value) {
    return type.$writeValue(this, buf, offset, value);
  }

  $writeMember(buf, offset, m, value) {
    if (!m)
      throw Error(`Cannot write to a non-existing member`);

    return m.$write(this, buf, offset, value);
  }

  $getStructAt(buf, offset, baseType) {
    const verInfo = baseType.$verInfo;
    if (!verInfo)
      return baseType;

    var fullName = baseType.$name;
    for (var i = 0; i < verInfo.length; i++)
      fullName += (i === 0 ? "$" : ".") + this.$readMember(buf, offset, baseType[verInfo[i]]);

    const versionedType = this.$getStruct(fullName);
    if (!versionedType)
      this.$log(`Couldn't find struct '${fullName}'`);
    return versionedType;
  }

  $decomposeData(buf, offset, type) {
    // Maybe this is a base structure only...
    var version = type.$version;
    if (version == null && type.$verInfo)
      type = this.$getStructAt(buf, offset, type) || type;
    return this.$decomposeStruct(buf, offset, type);
  }

  $decomposeStruct(buf, offset, type) {
    const obj = Object.create(null);

    Object.defineProperty(obj, "$TYPE"  , { value: type.$fullName, enumerable: false });
    Object.defineProperty(obj, "$OFFSET", { value: offset        , enumerable: false });

    const members = type.$members;
    for (var i = 0; i < members.length; i++) {
      const m = members[i];
      const k = m.$name;

      const flags = m.$flags;

      if (flags & Flags.Primitive) {
        const value = this.$readMember(buf, offset, m);
        obj[m.$name] = value;

        if (m.$ref && value !== 0) {
          const subOffset = m.$refType === "absolute" ? value : offset + value;
          const subStruct = this.$getStructAt(buf, subOffset, m.$ref);

          if (subStruct) {
            const as = m.$as || (m.$name + "@");
            obj[as] = this.$decomposeStruct(buf, subOffset, subStruct);
          }
        }
      }
      else if (flags & Flags.String) {
        const value = this.$readMember(buf, offset, m);
        obj[m.$name] = value;
      }
      else if (flags & Flags.Array) {
        const array = [];
        obj[m.$name] = array;

        const subType = m.$ref;
        const count = (typeof m.$length === "number") ? m.$length :
                      (typeof m.$length === "string") ? obj[m.$length] || 0 : 0;

        var subOffset = offset + m.$offset;
        for (var j = 0; j < count; j++) {
          if (subType.$flags & Flags.Primitive)
            array.push(this.$readValue(buf, subOffset, subType));
          else
            array.push(this.$decomposeStruct(buf, subOffset, subType));
          subOffset += subType.$size;
        }
      }
      else if (flags & Flags.Struct) {
        obj[k] = this.$decomposeStruct(buf, offset + m.$offset, m.$type);
      }
      else {
        this.$log(`Unhandled '${m.$name}'`);
      }
    }

    return obj;
  }

  $mergeData(buf, offset, type, obj) {
    if (!type) {
      type = this.$getStruct(obj.$TYPE);
      if (!type)
        throw Error(`Couldn't find struct '${obj.$TYPE}'`);
    }

    this.$mergeStruct(buf, offset, type, obj);
  }

  $mergeStruct(buf, offset, type, obj) {
    const members = type.$members;
    for (var i = 0; i < members.length; i++) {
      const m = members[i];
      const k = m.$name;

      if (!hasOwn.call(obj, k))
        continue;

      const value = obj[k];
      const flags = m.$flags;

      if (flags & Flags.Primitive) {
        this.$writeMember(buf, offset, m, value);
        if (m.$ref && value !== 0) {
          const as = m.$as || (k + "@");

          if (hasOwn.call(obj, as)) {
            const subData = obj[as];
            const subOffset = m.$refType === "absolute" ? value : offset + value;
            const subStruct = subData.$TYPE ? this.$getStruct(subData.$TYPE)
                                            : this.$getStructFromData(m.$ref, obj);

            if (subStruct) {
              this.$mergeStruct(buf, offset + value, subStruct, subData);
            }
            else {
              this.$log(`Couldn't merge '${m.$ref}' struct, not found`);
            }
          }
          else {
            this.$log(`Couldn't find '${m.$ref}' struct`);
          }
        }
      }
      else if (flags & Flags.String) {
        this.$writeMember(buf, offset, m, value);
      }
      else if (flags & Flags.Array) {
        if (!Array.isArray(value)) {
          this.$log(`'${k}' should be array`);
          continue;
        }

        const subType = m.$ref;
        const count = (typeof m.$length === "number") ? m.$length :
                      (typeof m.$length === "string") ? obj[m.$length] || 0 : 0;

        const array = value;
        if (array.length !== count) {
          this.$log(`Number of array entrties of '${k}' mismatch: ${array.length} != ${numStoredEntries}`);
          continue;
        }

        var subOffset = offset + m.$offset;
        for (var j = 0; j < count; j++) {
          if (subType.$flags & Flags.Primitive)
            this.$writeValue(buf, subOffset, subType, array[j]);
          else
            this.$mergeStruct(buf, subOffset, subType, array[j]);
          subOffset += subType.$size;
        }
      }
      else if (flags & Flags.Struct) {
        this.$mergeStruct(buf, offset + m.$offset, m.$type, value);
      }
      else {
        this.$log(`Unhandled '${m.$name}'`);
      }
    }
  }
}
binlib.Context = Context;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this, "binlib"]);
