// ============================================================================
// [vbios.js]
// VBIOS structures used by AMDGPU's.
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
// USAGE:
//
//   * This is a library and can be used for any purpose (reading, patching, etc).
//
// IMPORTANT:
//
//   * Structure names are standardized to use CamelCase and normalized to use
//     the same schema across the whole file. However, when adding new ones,
//     always keep names of C structures as a comment that precedes their
//     definition to make them easier to find.
//
//   * Structure members don't use hungarian notation. The type of each member
//     is known and it's not needed by consumers of the library. However there
//     are some quirks like `MinPixelClockPLLOutput` vs `MinPixelClockPLLOutput32`.
//     These are special cases and you must handle them by yourself.
//
//   * Some member names were corrected (typos, archaic English, etc). For example
//     "Vender" was renamed to a more used "Vendor", etc...
//
//   * Structures that use $ref need an already defined structure as a reference,
//     this means that RomTable, MasterDataTable, etc should be defined at the
//     end of `vbios.js`.
//
// TODOS
//
//   * It's unfinished. There is still a lot of tables not described here.
//
//   * Some tables that use a complicated formula to calculate a number of
//     elements in an array cannot be interpreted yet. This must be fixed in
//     binlib first.
//
// NOTES:
//
//   * Vdd       - ?
//   * Mvdd      - ?
//   * VddcGfxO  - ?
//   * Mvddc     - Pure Memory Voltage (FIJI)
//   * Vddci     - Memory controller voltage (not POLARIS).
//   * Vddci/AUX - I/O bus voltage (between memory and GPU core) (POLARIS)
//
// POLARIS:
//
//   * Those stories about lowering "memory voltage" has no effect at all,
//     basically if you lower the voltage part under memory in polaris editor
//     you are doing nothing. It has no effect.
//
//     https://forum.ethereum.org/discussion/9400/boysies-rx480-ref-bios-29mh-low-pwr-eth-or-dual-mining/p4
// ============================================================================

(function($export, $as, binlib) {
"use strict";

const vbios = new binlib.Context();
$export[$as] = vbios;

// VBIOS is LITTLE ENDIAN, so use these.
const I8 = binlib.I8;
const U8 = binlib.U8;
const I16 = binlib.I16LE;
const U16 = binlib.U16LE;
const I24 = binlib.I24LE;
const U24 = binlib.U24LE;
const I32 = binlib.I32LE;
const U32 = binlib.U32LE;
const Str = binlib.Str;
const Hex = binlib.Hex;
const Arr = binlib.Array;

const FLAGS = binlib.FLAGS;
const ABS_OFF = FLAGS.ABSOLUTE_OFFSET;
const REL_OFF = FLAGS.RELATIVE_OFFSET;

const TODO_REVISION = -1;    // TODO: Revision of that table not known, O was not able to read it from AMD driver (it ignores it).
const TODO_UNDEFINED = null; // TODO: Points to a table that is not defined yet, mostly VEGA and old PowerPlay data.

// ============================================================================
// [Definitions & Utilities]
// ============================================================================

// Make a 32-bit signature from the given string `s` that must have 4 characters.
function makeSignature(s) {
  if (typeof s !== "string")
    throw Error(`vbios.makeSignature(): Signature must be a string, not '${typeof s}'`);

  if (s.length < 2 || s.length > 4)
    throw Error(`vbios.makeSignature(): Signature size must be between 2-4 characters, not '${s.length}'`);

  const a = s.charCodeAt(0);
  const b = s.charCodeAt(1);
  const c = s.charCodeAt(2) || 0;
  const d = s.charCodeAt(3) || 0;
  return (d << 24) | (c << 16) | (b << 8) | a;
}
vbios.makeSignature = makeSignature;

vbios.VBIOS_ROM_OFFSET = 0x48;
vbios.VBIOS_SIGNATURE = 0xAA55;
vbios.FIRMWARE_SIGNATURE = makeSignature("ATOM");

function loadVBIOSHeader(params) {
  try {
    const reader = new binlib.DataReader(vbios, params);
    const header = reader.readRoot(vbios.VBIOSTable);

    if (header.PCIRomSignature !== vbios.VBIOS_SIGNATURE)
      return null;

    if (header.IBMSignature !== "IBM")
      return null;

    if (header.RomTable && header.RomTable.$meta.absOffset < vbios.VBIOSTable.$size)
      return null;

    return header;
  }
  catch (ex) {
    return null;
  }
}

// Check whether the given buffer `buf` is a VBIOS header.
function isVBIOS(buf, offset) {
  return loadVBIOSHeader({
    buffer  : buf,
    start   : offset || 0,
    maxDepth: 0
  }) !== null;
}
vbios.isVBIOS = isVBIOS;

// Extract PowerPlay data (buffer) from a VBIOS data (buffer).
//
// Can return `null` if the given `buf` is not a VBIOS or doesn't point to a
// PowerPlay table.
function extractPowerPlayFromVBIOS(buf, offset) {
  const header = loadVBIOSHeader({
    buffer: buf,
    start: offset,
    filter: function(path) { return "RomTable.MasterDataTable.PowerPlayTable".startsWith(path); }
  });
  if (header === null) return null;

  const ppTable = header.RomTable.MasterDataTable.PowerPlayTable;
  const ppStart = ppTable.$meta.absOffset;
  const ppEnd   = ppStart + ppTable.StructureSize;

  if (ppEnd > buf.length)
    return null;

  return buf.slice(ppStart, ppEnd);
}
vbios.extractPowerPlayFromVBIOS = extractPowerPlayFromVBIOS;

// ============================================================================
// [Common]
// ============================================================================

// ATOM_COMMON_TABLE_HEADER
vbios.$define({
  $name: "CommonTableHeader",
  $verInfo: ["TableFormatRevision", "TableContentRevision"],
  $members: [
    { $name: "StructureSize"                  , $type: U16 },
    { $name: "TableFormatRevision"            , $type: U8  },
    { $name: "TableContentRevision"           , $type: U8  }
  ]
});

// Simple base structure for versioned structures that use `RevisionId`.
vbios.$define({
  $name: "CommonRevIdHeader",
  $verInfo: ["RevisionId"],
  $members: [
    { $name: "RevisionId"                     , $type: U8  }
  ]
});

// Doesn't really have a struct version in C, but we use it as a base for many
// C array structures that contain these two members followed by Entries[...].
vbios.$define({
  $name: "CommonArrayHeader",
  $extend: vbios.CommonRevIdHeader,
  $members: [
    { $name: "NumEntries"                     , $type: U8  }
  ]
});


// ============================================================================
// [Firmware Information]
// ============================================================================

// ATOM_FIRMWARE_CAPABILITY
// ATOM_FIRMWARE_CAPABILITY_ACCESS
vbios.$define({
  $name: "FirmwareCapability",
  $members: [
    { $name: "FirmwarePosted"                 , $type: U16, $bitSize: 1 },
    { $name: "DualCRTCSupport"                , $type: U16, $bitSize: 1 },
    { $name: "ExtendedDesktopSupport"         , $type: U16, $bitSize: 1 },
    { $name: "MemoryClockSSSupport"           , $type: U16, $bitSize: 1 },
    { $name: "EngineClockSSSupport"           , $type: U16, $bitSize: 1 },
    { $name: "GPUControlsBL"                  , $type: U16, $bitSize: 1 },
    { $name: "WMISUPPORT"                     , $type: U16, $bitSize: 1 },
    { $name: "PPModeAssigned"                 , $type: U16, $bitSize: 1 },
    { $name: "HyperMemorySupport"             , $type: U16, $bitSize: 1 },
    { $name: "HyperMemorySize"                , $type: U16, $bitSize: 4 },
    { $name: "PostWithoutModeSet"             , $type: U16, $bitSize: 1 },
    { $name: "SCL2Redefined"                  , $type: U16, $bitSize: 1 },
    { $name: "Reserved1"                      , $type: U16, $bitSize: 1 }
  ]
});

// PRODUCT_BRANDING
vbios.$define({
  $name: "ProductBranding",
  $members: [
    { $name: "EmbeddedCap"                    , $type: U8 , $bitSize: 2 },
    { $name: "Reserved1"                      , $type: U8 , $bitSize: 2 },
    { $name: "BrandingId"                     , $type: U8 , $bitSize: 4 }
  ]
});

// ATOM_FIRMWARE_INFO
vbios.$define({
  $name: "FirmwareInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.FirmwareInfo,
  $version: [1, 1],
  $members: [
    { $name: "FirmwareRevision"               , $type: U32 },
    { $name: "DefaultEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DefaultMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DriverTargetEngineClock"        , $type: U32 }, // In [10Khz] unit.
    { $name: "DriverTargetMemoryClock"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLOutput"         , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxTemperature"             , $type: U8  },
    { $name: "Padding"                        , $type: U24 },
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 },
    { $name: "Reserved3"                      , $type: U32 },
    { $name: "MinEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClock"                  , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLOutput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "FirmwareCapability"             , $type: vbios.FirmwareCapability },
    { $name: "ReferenceClock"                 , $type: U16 }, // In [10Khz] unit
    { $name: "PMRTSLocation"                  , $type: U16 }, // RTS PM4 starting location in ROM in 1Kb unit.
    { $name: "PMRTSStreamSize"                , $type: U8  }, // RTS PM4 packets in Kb unit.
    { $name: "DesignId"                       , $type: U8  }, // Indicates what is the board design.
    { $name: "MemoryModuleId"                 , $type: U8  }  // Indicates what is the board design.
  ]
});

// ATOM_FIRMWARE_INFO_V1_2
vbios.$define({
  $extend: vbios.FirmwareInfo,
  $version: [1, 2],
  $members: [
    { $name: "FirmwareRevision"               , $type: U32 },
    { $name: "DefaultEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DefaultMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DriverTargetEngineClock"        , $type: U32 }, // In [10Khz] unit.
    { $name: "DriverTargetMemoryClock"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLOutput"         , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxTemperature"             , $type: U8  },
    { $name: "MinAllowedBLLevel"              , $type: U8  },
    { $name: "Padding"                        , $type: U16 },
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 },
    { $name: "MinPixelClockPLLOutput32"       , $type: U32 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClock"                  , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLOutput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "FirmwareCapability"             , $type: vbios.FirmwareCapability },
    { $name: "ReferenceClock"                 , $type: U16 }, // In [10Khz] unit
    { $name: "PMRTSLocation"                  , $type: U16 }, // RTS PM4 starting location in ROM in 1Kb unit.
    { $name: "PMRTSStreamSize"                , $type: U8  }, // RTS PM4 packets in Kb unit.
    { $name: "DesignId"                       , $type: U8  }, // Indicates what is the board design.
    { $name: "MemoryModuleId"                 , $type: U8  }  // Indicates what is the board design.
  ]
});

// ATOM_FIRMWARE_INFO_V1_3
vbios.$define({
  $extend: vbios.FirmwareInfo,
  $version: [1, 3],
  $members: [
    { $name: "FirmwareRevision"               , $type: U32 },
    { $name: "DefaultEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DefaultMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DriverTargetEngineClock"        , $type: U32 }, // In [10Khz] unit.
    { $name: "DriverTargetMemoryClock"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLOutput"         , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxTemperature"             , $type: U8  },
    { $name: "MinAllowedBLLevel"              , $type: U8  },
    { $name: "Padding"                        , $type: U16 },
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "_3DAccelerationEngineClock"     , $type: U32 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLOutput32"       , $type: U32 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClock"                  , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLOutput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "FirmwareCapability"             , $type: vbios.FirmwareCapability },
    { $name: "ReferenceClock"                 , $type: U16 }, // In [10Khz] unit
    { $name: "PMRTSLocation"                  , $type: U16 }, // RTS PM4 starting location in ROM in 1Kb unit.
    { $name: "PMRTSStreamSize"                , $type: U8  }, // RTS PM4 packets in Kb unit.
    { $name: "DesignId"                       , $type: U8  }, // Indicates what is the board design.
    { $name: "MemoryModuleId"                 , $type: U8  }  // Indicates what is the board design.
  ]
});

// ATOM_FIRMWARE_INFO_V1_4
vbios.$define({
  $extend: vbios.FirmwareInfo,
  $version: [1, 4],
  $members: [
    { $name: "FirmwareRevision"               , $type: U32 },
    { $name: "DefaultEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DefaultMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DriverTargetEngineClock"        , $type: U32 }, // In [10Khz] unit.
    { $name: "DriverTargetMemoryClock"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLOutput"         , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "ASICMaxTemperature"             , $type: U8  },
    { $name: "MinAllowedBLLevel"              , $type: U8  },
    { $name: "BootUpVddcVoltage"              , $type: U16 }, // In [mV] unit.
    { $name: "LCDMinPixelClockPLLOutput"      , $type: U16 }, // In [Mhz] unit
    { $name: "LCDMaxPixelClockPLLOutput"      , $type: U16 }, // In [Mhz] unit
    { $name: "_3DAccelerationEngineClock"     , $type: U32 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLOutput32"       , $type: U32 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClock"                  , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLOutput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "FirmwareCapability"             , $type: vbios.FirmwareCapability },
    { $name: "ReferenceClock"                 , $type: U16 }, // In [10Khz] unit
    { $name: "PMRTSLocation"                  , $type: U16 }, // RTS PM4 starting location in ROM in 1Kb unit.
    { $name: "PMRTSStreamSize"                , $type: U8  }, // RTS PM4 packets in Kb unit.
    { $name: "DesignId"                       , $type: U8  }, // Indicates what is the board design.
    { $name: "MemoryModuleId"                 , $type: U8  }  // Indicates what is the board design.
  ]
});

// ATOM_FIRMWARE_INFO_V2_1
vbios.$define({
  $extend: vbios.FirmwareInfo,
  $version: [2, 1],
  $members: [
    { $name: "FirmwareRevision"               , $type: U32 },
    { $name: "DefaultEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DefaultMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 },
    { $name: "MaxEngineClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLOutput"        , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLOutput"         , $type: U32 }, // In [10Khz] unit.
    { $name: "BinaryAlteredInfo"              , $type: U32 },
    { $name: "DefaultDispEngineClock"         , $type: U32 }, // In [10Khz] unit.
    { $name: "Reserved3"                      , $type: U8  },
    { $name: "MinAllowedBLLevel"              , $type: U8  },
    { $name: "BootUpVddcVoltage"              , $type: U16 }, // In [mV] unit.
    { $name: "LCDMinPixelClockPLLOutput"      , $type: U16 }, // In [Mhz] unit
    { $name: "LCDMaxPixelClockPLLOutput"      , $type: U16 }, // In [Mhz] unit
    { $name: "Reserved4"                      , $type: U32 },
    { $name: "MinPixelClockPLLOutput32"       , $type: U32 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinEngineClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxMemoryClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MinMemoryClockPLLOutput"        , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClock"                  , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxPixelClockPLLInput"          , $type: U16 }, // In [10Khz] unit.
    { $name: "MinPixelClockPLLOutput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "FirmwareCapability"             , $type: vbios.FirmwareCapability },
    { $name: "CoreReferenceClock"             , $type: U16 }, // In [10Khz] unit
    { $name: "MemoryReferenceClock"           , $type: U16 }, // In [10Khz] unit
    { $name: "UniphyDPModeExtClockFreq"       , $type: U16 }, // In [10Khz] unit
    { $name: "MemoryModuleId"                 , $type: U8  },
    { $name: "Reserved5"                      , $type: U32 }
  ]
});

// ATOM_FIRMWARE_INFO_V2_2
vbios.$define({
  $extend: vbios.FirmwareInfo,
  $version: [2, 2],
  $members: [
    { $name: "FirmwareRevision"               , $type: U32 },
    { $name: "DefaultEngineClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "DefaultMemoryClock"             , $type: U32 }, // In [10Khz] unit.
    { $name: "SPLLOutputFreq"                 , $type: U32 }, // In [10Khz] unit.
    { $name: "GPUPLLOutputFreq"               , $type: U32 }, // In [10Khz] unit.
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 },
    { $name: "MaxPixelClockPLLOutput"         , $type: U32 }, // In [10Khz] unit.
    { $name: "BinaryAlteredInfo"              , $type: U32 },
    { $name: "DefaultDispEngineClockFreq"     , $type: U32 }, // In [10Khz] unit.
    { $name: "Reserved3"                      , $type: U8  },
    { $name: "MinAllowedBLLevel"              , $type: U8  },
    { $name: "BootUpVddcVoltage"              , $type: U16 }, // In [mV] unit.
    { $name: "LCDMinPixelClockPLLOutput"      , $type: U16 }, // In [Mhz] unit
    { $name: "LCDMaxPixelClockPLLOutput"      , $type: U16 }, // In [Mhz] unit
    { $name: "Reserved4"                      , $type: U32 },
    { $name: "MinPixelClockPLLOutput32"       , $type: U32 }, // In [10Khz] unit.
    { $name: "RemoteDisplayConfig"            , $type: U8  },
    { $name: "Reserved5"                      , $type: U24 },
    { $name: "Reserved6"                      , $type: U32 },
    { $name: "Reserved7"                      , $type: U32 },
    { $name: "Reserved8"                      , $type: U16 },
    { $name: "MinEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "MaxEngineClockPLLInput"         , $type: U16 }, // In [10Khz] unit.
    { $name: "BootUpVddciVoltage"             , $type: U16 }, // In [mV] unit.
    { $name: "FirmwareCapability"             , $type: vbios.FirmwareCapability },
    { $name: "CoreReferenceClock"             , $type: U16 }, // In [10Khz] unit
    { $name: "MemoryReferenceClock"           , $type: U16 }, // In [10Khz] unit
    { $name: "UniphyDPModeExtClockFreq"       , $type: U16 }, // In [10Khz] unit
    { $name: "MemoryModuleId"                 , $type: U8  },
    { $name: "CoolingSolutionId"              , $type: U8  },
    { $name: "ProductBranding"                , $type: vbios.ProductBranding },
    { $name: "Reserved9"                      , $type: U8  },
    { $name: "BootUpMvddcVoltage"             , $type: U16 }, // In [mV] unit.
    { $name: "BootUpVddGfxVoltage"            , $type: U16 }, // In [mV] unit.
    { $name: "Reserved10"                     , $type: U32 },
    { $name: "Reserved11"                     , $type: U32 },
    { $name: "Reserved12"                     , $type: U32 }
  ]
});

// ============================================================================
// [Multimedia Capability]
// ============================================================================

// ATOM_MULTIMEDIA_CAPABILITY_INFO
vbios.$define({
  $name: "MultimediaCapabilityInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.MultimediaCapabilityInfo,
  $version: [1, 1],
  $members: [
    { $name: "Signature"                      , $type: U32 }, // HW Info table signature string "$ATI".
    { $name: "I2CType"                        , $type: U8  }, // I2C type (normal GP_IO, ImpactTV GP_IO, Dedicated I2C pin, etc).
    { $name: "TVOutInfo"                      , $type: U8  }, // Type of TV out supported (3:0) and video out crystal frequency (6:4) and TV data port (7).
    { $name: "VideoPortInfo"                  , $type: U8  }, // Provides the video port capabilities.
    { $name: "HostPortInfo"                   , $type: U8  }  // Provides host port configuration information.
  ]
});

// ============================================================================
// [Multimedia Configuration]
// ============================================================================

// ATOM_MULTIMEDIA_CONFIG_INFO
vbios.$define({
  $name: "MultimediaConfigInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.MultimediaConfigInfo,
  $version: [1, 1],
  $members: [
    { $name: "Signature"                      , $type: U32 }, // MM info table signature string "$MMT"
    { $name: "TunerInfo"                      , $type: U8  }, // Type of tuner installed on the adapter (4:0) and video input for tuner (7:5)
    { $name: "AudioChipInfo"                  , $type: U8  }, // List the audio chip type (3:0) product type (4) and OEM revision (7:5)
    { $name: "ProductId"                      , $type: U8  }, // Defines as OEM ID or ATI board ID dependent on product type setting
    { $name: "MiscInfo1"                      , $type: U8  }, // Tuner voltage (1:0) HW teletext support (3:2) FM audio decoder (5:4) reserved (6) audio scrambling (7)
    { $name: "MiscInfo2"                      , $type: U8  }, // I2S input config (0) I2S output config (1) I2S Audio Chip (4:2) SPDIF Output Config (5) reserved (7:6)
    { $name: "MiscInfo3"                      , $type: U8  }, // Video Decoder Type (3:0) Video In Standard/Crystal (7:4)
    { $name: "MiscInfo4"                      , $type: U8  }, // Video Decoder Host Config (2:0) reserved (7:3)
    { $name: "VideoInput0Info"                , $type: U8  }, // Video Input 0 Type (1:0) F/B setting (2) physical connector ID (5:3) reserved (7:6)
    { $name: "VideoInput1Info"                , $type: U8  }, // Video Input 1 Type (1:0) F/B setting (2) physical connector ID (5:3) reserved (7:6)
    { $name: "VideoInput2Info"                , $type: U8  }, // Video Input 2 Type (1:0) F/B setting (2) physical connector ID (5:3) reserved (7:6)
    { $name: "VideoInput3Info"                , $type: U8  }, // Video Input 3 Type (1:0) F/B setting (2) physical connector ID (5:3) reserved (7:6)
    { $name: "VideoInput4Info"                , $type: U8  }  // Video Input 4 Type (1:0) F/B setting (2) physical connector ID (5:3) reserved (7:6)
  ]
});

// ============================================================================
// [Integrated System Information]
// ============================================================================

// ATOM_INTEGRATED_SYSTEM_INFO
vbios.$define({
  $name: "IntegratedSystemInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.IntegratedSystemInfo,
  $version: [1, 1],
  $members: [
    { $name: "BootUpEngineClock"              , $type: U32 },
    { $name: "BootUpMemoryClock"              , $type: U32 },
    { $name: "MaxSystemMemoryClock"           , $type: U32 },
    { $name: "MinSystemMemoryClock"           , $type: U32 },
    { $name: "NumberOfCyclesInPeriodHi"       , $type: U8  },
    { $name: "LCDTimingSel"                   , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "InterNBVoltageLow"              , $type: U16 },
    { $name: "InterNBVoltageHigh"             , $type: U16 },
    { $name: "Reserved2"                      , $type: U32 },
    { $name: "Reserved3"                      , $type: U32 },
    { $name: "FSBClock"                       , $type: U16 },
    { $name: "CapabilityFlag"                 , $type: U16 },
    { $name: "PCIENBCfgReg7"                  , $type: U16 },
    { $name: "K8MemoryClock"                  , $type: U16 },
    { $name: "K8SyncStartDelay"               , $type: U16 },
    { $name: "K8DataReturnTime"               , $type: U16 },
    { $name: "MaxNBVoltage"                   , $type: U8  },
    { $name: "MinNBVoltage"                   , $type: U8  },
    { $name: "MemoryType"                     , $type: U8  },
    { $name: "NumberOfCyclesInPeriod"         , $type: U8  },
    { $name: "StartingPWM_HighTime"           , $type: U8  },
    { $name: "HTLinkWidth"                    , $type: U8  },
    { $name: "MaxNBVoltageHigh"               , $type: U8  },
    { $name: "MinNBVoltageHigh"               , $type: U8  }
  ]
});

// ATOM_INTEGRATED_SYSTEM_INFO_V2
vbios.$define({
  $extend: vbios.IntegratedSystemInfo,
  $version: [1, 4],
  $members: [
    { $name: "BootUpEngineClock"              , $type: U32 }, // In [10Khz] unit.
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 }, // In [10Khz] unit.
    { $name: "BootUpUMAClock"                 , $type: U32 }, // In [10Khz] unit.
    { $name: "BootUpSidePortClock"            , $type: U32 }, // In [10Khz] unit.
    { $name: "MinSidePortClock"               , $type: U32 },
    { $name: "Reserved3"                      , $type: U32 },
    { $name: "Reserved4"                      , $type: U32 },
    { $name: "Reserved5"                      , $type: U32 },
    { $name: "Reserved6"                      , $type: U32 },
    { $name: "Reserved7"                      , $type: U32 },
    { $name: "Reserved8"                      , $type: U32 },
    { $name: "SystemConfig"                   , $type: U32 },

    { $name: "BootUpReqDisplayVector"         , $type: U32 },
    { $name: "OtherDisplayMisc"               , $type: U32 },
    { $name: "DDISlot1Config"                 , $type: U32 },
    { $name: "DDISlot2Config"                 , $type: U32 },
    { $name: "MemoryType"                     , $type: U8  }, // [3:0]=1:DDR1;=2:DDR2;=3:DDR3.[7:4] is reserved
    { $name: "UMAChannelNumber"               , $type: U8  },
    { $name: "DockingPinBit"                  , $type: U8  },
    { $name: "DockingPinPolarity"             , $type: U8  },
    { $name: "DockingPinCFGInfo"              , $type: U32 },
    { $name: "CPUCapInfo"                     , $type: U32 },
    { $name: "NumberOfCyclesInPeriod"         , $type: U16 },
    { $name: "MaxNBVoltage"                   , $type: U16 },
    { $name: "MinNBVoltage"                   , $type: U16 },
    { $name: "BootUpNBVoltage"                , $type: U16 },
    { $name: "HTLinkFreq"                     , $type: U32 }, // In [10Khz] unit.
    { $name: "MinHTLinkWidth"                 , $type: U16 },
    { $name: "MaxHTLinkWidth"                 , $type: U16 },
    { $name: "UMASyncStartDelay"              , $type: U16 },
    { $name: "UMADataReturnTime"              , $type: U16 },
    { $name: "LinkStatusZeroTime"             , $type: U16 },
    { $name: "DACEfuse"                       , $type: U16 }, // For storing badgap value (for RS880 only).
    { $name: "HighVoltageHTLinkFreq"          , $type: U32 }, // In [10Khz] unit.
    { $name: "LowVoltageHTLinkFreq"           , $type: U32 }, // In [10Khz] unit.
    { $name: "MaxUpStreamHTLinkWidth"         , $type: U16 },
    { $name: "MaxDownStreamHTLinkWidth"       , $type: U16 },
    { $name: "MinUpStreamHTLinkWidth"         , $type: U16 },
    { $name: "MinDownStreamHTLinkWidth"       , $type: U16 },
    { $name: "FirmwareVersion"                , $type: U16 },
    { $name: "FullT0Time"                     , $type: U16 },
    { $name: "Padding"                        , $type: Arr, $ref: U32, $length: 96 }
  ]
});

// ATOM_INTEGRATED_SYSTEM_INFO_V5
vbios.$define({
  $extend: vbios.IntegratedSystemInfo,
  $version: [1, 5],
  $members: [
    { $name: "BootUpEngineClock"              , $type: U32 }, // In [10Khz] unit.
    { $name: "DentistVCOFreq"                 , $type: U32 }, // In [10Khz] unit, Dentist VCO clock, the source of GPU SCLK, LCLK, UCLK and VCLK.
    { $name: "LClockFreq"                     , $type: U32 }, // In [10Khz] unit, GPU LCLK freq, have relationship with NCLK in NorthBridge.
    { $name: "BootUpUMAClock"                 , $type: U32 }, // In [10Khz] unit.
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 },
    { $name: "Reserved3"                      , $type: U32 },
    { $name: "Reserved4"                      , $type: U32 },
    { $name: "Reserved5"                      , $type: U32 },
    { $name: "Reserved6"                      , $type: U32 },
    { $name: "Reserved7"                      , $type: U32 },
    { $name: "Reserved8"                      , $type: U32 },
    { $name: "BootUpReqDisplayVector"         , $type: U32 },
    { $name: "OtherDisplayMisc"               , $type: U32 },
    { $name: "Reserved9"                      , $type: U32 },
    { $name: "Reserved10"                     , $type: U32 },
    { $name: "Reserved11"                     , $type: U32 },
    { $name: "Reserved12"                     , $type: U32 },
    { $name: "SystemConfig"                   , $type: U32 },
    { $name: "CPUCapInfo"                     , $type: U32 },
    { $name: "MaxNBVoltage"                   , $type: U16 }, // High NB voltage, calculated using current VDDNB (D24F2xDC) and VDDNB offset fuse.
    { $name: "MinNBVoltage"                   , $type: U16 }, // Low NB voltage, calculated using current VDDNB (D24F2xDC) and VDDNB offset fuse.
    { $name: "BootUpNBVoltage"                , $type: U16 }, // Boot up NB voltage.
    { $name: "HtcTmpLmt"                      , $type: U8  },
    { $name: "TjOffset"                       , $type: U8  },
    { $name: "Reserved13"                     , $type: U32 },
    { $name: "Reserved14"                     , $type: U32 },
    { $name: "Reserved15"                     , $type: U32 },
    { $name: "Reserved16"                     , $type: U32 },
    { $name: "DDISlot1Config"                 , $type: U32 },
    { $name: "DDISlot2Config"                 , $type: U32 },
    { $name: "DDISlot3Config"                 , $type: U32 },
    { $name: "DDISlot4Config"                 , $type: U32 },
    { $name: "Reserved17"                     , $type: U32 },
    { $name: "Reserved18"                     , $type: U32 },
    { $name: "Reserved19"                     , $type: U32 },
    { $name: "Reserved20"                     , $type: U32 },
    { $name: "MemoryType"                     , $type: U8  },
    { $name: "UMAChannelNumber"               , $type: U8  },
    { $name: "Reserved21"                     , $type: U16 },
    { $name: "Reserved22"                     , $type: U32 },
    { $name: "Reserved23"                     , $type: U32 },
    { $name: "Reserved24"                     , $type: U32 },
    { $name: "Reserved25"                     , $type: U32 },
    { $name: "CSR_M3_ARB_CNTL_DEFAULT"        , $type: Arr, $ref: U32, $length: 10 },
    { $name: "CSR_M3_ARB_CNTL_UVD"            , $type: Arr, $ref: U32, $length: 10 },
    { $name: "CSR_M3_ARB_CNTL_FS3D"           , $type: Arr, $ref: U32, $length: 10 },
    { $name: "Padding"                        , $type: Arr, $ref: U32, $length: 61 }
  ]
});

// ============================================================================
// [GPU Virtualization Information]
// ============================================================================

// ATOM_GPU_VIRTUALIZATION_INFO_V2_1
vbios.$define({
  $name: "GPUVirtualizationInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.GPUVirtualizationInfo,
  $version: [2, 1],
  $members: [
    { $name: "MCUcodeRomStartAddr"            , $type: U32 },
    { $name: "MCUcodeLength"                  , $type: U32 },
    { $name: "SMCUcodeRomStartAddr"           , $type: U32 },
    { $name: "SMCUcodeLength"                 , $type: U32 },
    { $name: "RLCVUcodeRomStartAddr"          , $type: U32 },
    { $name: "RLCVUcodeLength"                , $type: U32 },
    { $name: "TOCUcodeStartAddr"              , $type: U32 },
    { $name: "TOCUcodeLength"                 , $type: U32 },
    { $name: "SMCPatchTableStartAddr"         , $type: U32 },
    { $name: "SMCPatchTableLength"            , $type: U32 },
    { $name: "SystemFlag"                     , $type: U32 }
  ]
});

// ============================================================================
// [SMU Information]
// ============================================================================

vbios.$define({
  $name: "SocClockFCWRangeEntry",
  $version: [1],
  $members: [
    { $name: "MaxSocClockFreq"                , $type: U32 },
    { $name: "VCOSetting"                     , $type: U8  },
    { $name: "Postdiv"                        , $type: U8  },
    { $name: "FCWPCC"                         , $type: U16 },
    { $name: "FCWTransUpper"                  , $type: U16 },
    { $name: "RCWTransLower"                  , $type: U16 }
  ]
});

vbios.$define({
  $name: "SMUInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.SMUInfo,
  $version: [2, 1],
  $members: [
    { $name: "SocClockEntryNum"               , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 },
    { $name: "SocClockFCWRangeEntries"        , $type: Arr, $ref: vbios.SocClockFCWRangeEntry$1, $length: "SocClockEntryNum" }
  ]
});

// ============================================================================
// [VRAM Information]
// ============================================================================

// ATOM_VRAM_TIMING_ENTRY
vbios.$define({
  $name: "VRAMTimingEntry",
  $members: [
    { $name: "CLKRange"                       , $type: U32 },
    { $name: "Latency"                        , $type: Hex , $length: 48 }
  ]
});

// ATOM_VRAM_MODULE - Dummy, used just to define a non-versioned type-name.
vbios.$define({
  $name: "VRAMModule"
});

// ATOM_VRAM_MODULE_V1
vbios.$define({
  $extend: vbios.VRAMModule,
  $version: [1],
  $members: [
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "EMRSValue"                      , $type: U16 },
    { $name: "MRSValue"                       , $type: U16 },
    { $name: "Reserved2"                      , $type: U16 },
    { $name: "ExtMemoryId"                    , $type: U8  },
    { $name: "MemoryType"                     , $type: U8  },
    { $name: "MemoryVendorId"                 , $type: U8  },
    { $name: "MemoryDeviceCfg"                , $type: U8  },
    { $name: "Row"                            , $type: U8  },
    { $name: "Column"                         , $type: U8  },
    { $name: "Bank"                           , $type: U8  },
    { $name: "Rank"                           , $type: U8  },
    { $name: "ChannelNum"                     , $type: U8  },
    { $name: "ChannelConfig"                  , $type: U8  },
    { $name: "DefaultMvddqId"                 , $type: U8  },
    { $name: "DefaultMvddcId"                 , $type: U8  },
    { $name: "Reserved3"                      , $type: U16 }
  ]
});

// ATOM_VRAM_MODULE_V2
vbios.$define({
  $extend: vbios.VRAMModule,
  $version: [2],
  $members: [
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "Flags"                          , $type: U32 },
    { $name: "EngineClock"                    , $type: U32 },
    { $name: "MemoryClock"                    , $type: U32 },
    { $name: "EMRS2Value"                     , $type: U16 },
    { $name: "EMRS3Value"                     , $type: U16 },
    { $name: "EMRSValue"                      , $type: U16 },
    { $name: "MRSValue"                       , $type: U16 },
    { $name: "Reserved2"                      , $type: U16 },
    { $name: "ExtMemoryId"                    , $type: U8  },
    { $name: "MemoryType"                     , $type: U8  },
    { $name: "MemoryVendorId"                 , $type: U8  },
    { $name: "MemoryDeviceCfg"                , $type: U8  },
    { $name: "Row"                            , $type: U8  },
    { $name: "Column"                         , $type: U8  },
    { $name: "Bank"                           , $type: U8  },
    { $name: "Rank"                           , $type: U8  },
    { $name: "ChannelNum"                     , $type: U8  },
    { $name: "ChannelConfig"                  , $type: U8  },
    { $name: "DefaultMvddqId"                 , $type: U8  },
    { $name: "DefaultMvddcId"                 , $type: U8  },
    { $name: "RefreshRateFactor"              , $type: U8  },
    { $name: "Reserved3"                      , $type: U24 }
  ]
});



// ATOM_VRAM_MODULE_V7
vbios.$define({
  $extend: vbios.VRAMModule,
  $version: [7],
  $members: [
    { $name: "ChannelMapCfg"                  , $type: U32 },
    { $name: "ModuleSize"                     , $type: U16 },
    { $name: "PrivateReserved"                , $type: U16 },
    { $name: "EnableChannels"                 , $type: U16 },
    { $name: "ExtMemoryId"                    , $type: U8  },
    { $name: "MemoryType"                     , $type: U8  },
    { $name: "ChannelNum"                     , $type: U8  },
    { $name: "ChannelWidth"                   , $type: U8  },
    { $name: "Density"                        , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Misc"                           , $type: U8  },
    { $name: "VREFI"                          , $type: U8  },
    { $name: "NPL_RT"                         , $type: U8  },
    { $name: "Preamble"                       , $type: U8  },
    { $name: "MemorySize"                     , $type: U8  },
    { $name: "SEQSettingOffset"               , $type: U16 },
    { $name: "Reserved"                       , $type: U8  },
    { $name: "EMRS2Value"                     , $type: U16 },
    { $name: "EMRS3Value"                     , $type: U16 },
    { $name: "MemoryVendorId"                 , $type: U8  },
    { $name: "RefreshRateFactor"              , $type: U8  },
    { $name: "FIFODepth"                      , $type: U8  },
    { $name: "CDR_Bandwidth"                  , $type: U8  },
    { $name: "MemPNString"                    , $type: Str, $length: 10 }
  ]
});

// ATOM_VRAM_MODULE_V8
vbios.$define({
  $extend: vbios.VRAMModule,
  $version: [8],
  $members: [
    { $name: "ChannelMapCfg"                  , $type: U32 },
    { $name: "ModuleSize"                     , $type: U16 },
    { $name: "McRamCfg"                       , $type: U16 },
    { $name: "EnableChannels"                 , $type: U16 },
    { $name: "ExtMemoryId"                    , $type: U8  },
    { $name: "MemoryType"                     , $type: U8  },
    { $name: "ChannelNum"                     , $type: U8  },
    { $name: "ChannelWidth"                   , $type: U8  },
    { $name: "Density"                        , $type: U8  },
    { $name: "BankCol"                        , $type: U8  },
    { $name: "Misc"                           , $type: U8  },
    { $name: "VREFI"                          , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "MemorySize"                     , $type: U16 },
    { $name: "McTunningSetId"                 , $type: U8  },
    { $name: "RowNum"                         , $type: U8  },
    { $name: "EMRS2Value"                     , $type: U16 },
    { $name: "EMRS3Value"                     , $type: U16 },
    { $name: "MemoryVendorId"                 , $type: U8  },
    { $name: "RefreshRateFactor"              , $type: U8  },
    { $name: "FIFODepth"                      , $type: U8  },
    { $name: "CDRBandwidth"                   , $type: U8  },
    { $name: "ChannelMapCfg1"                 , $type: U32 },
    { $name: "BankMapCfg"                     , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 },
    { $name: "MemPNString"                    , $type: Hex , $length: 20 }
  ]
});

// ATOM_VRAM_INFO
vbios.$define({
  $name: "VRAMInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $name: "VRAMInfo",
  $extend: vbios.VRAMInfo,
  $version: [2, 1],
  $members: [
    { $name: "MemAdjustTableOffset"           , $type: U16 },
    { $name: "MemClockPatchTableOffset"       , $type: U16 },
    { $name: "PerBytePresetOffset"            , $type: U16 },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "Reserved2"                      , $type: U16 },
    { $name: "Reserved3"                      , $type: U16 },
    { $name: "NumVRAMModules"                 , $type: U8  }, // ucNumOfVRAMModule
    { $name: "MemClockPatchTableVer"          , $type: U8  },
    { $name: "VRAMModuleVer"                  , $type: U8  },
    { $name: "Reserved4"                      , $type: U8  },
    { $name: "VRAMModules"                    , $type: Arr, $ref: vbios.VRAMModule, $length: "NumVRAMModules", $version: "VRAMModuleVer" }
  ]
});

vbios.$define({
  $name: "VRAMInfo",
  $extend: vbios.VRAMInfo,
  $version: [2, 2],
  $members: [
    { $name: "MemAdjustTableOffset"           , $type: U16 },
    { $name: "MemClockPatchTableOffset"       , $type: U16 },
    { $name: "McAdjustPerTileTableOffset"     , $type: U16 },
    { $name: "McPhyInitTableOffset"           , $type: U16 },
    { $name: "DRAMDataRemapTableOffset"       , $type: U16 },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "NumVRAMModules"                 , $type: U8  }, // ucNumOfVRAMModule
    { $name: "MemClockPatchTableVer"          , $type: U8  },
    { $name: "VRAMModuleVer"                  , $type: U8  },
    { $name: "McPhyTileNum"                   , $type: U8  },
    { $name: "VRAMModules"                    , $type: Arr, $ref: vbios.VRAMModule, $length: "NumVRAMModules", $version: "VRAMModuleVer" }
  ]
});

// ============================================================================
// [Display Object / Object Information]
// ============================================================================

// ATOM_DISPLAY_OBJECT_PATH
vbios.$define({
  $name: "DisplayObjectPath",
  $members: [
    { $name: "DeviceTag"                      , $type: U16 }, // Supported device.
    { $name: "Size"                           , $type: U16 }, // The size of DisplayPathTable.
    { $name: "ConnObjectId"                   , $type: U16 }, // Connector Object ID.
    { $name: "GPUObjectId"                    , $type: U16 }, // GPU ID.

    // 1st Encoder Obj source from GPU to last Graphic Obj destinate to connector.
    { $name: "GraphicObjIds"                  , $type: Arr, $ref: U16, $length: 1 }
  ]
});

// ATOM_DISPLAY_EXTERNAL_OBJECT_PATH
vbios.$define({
  $name: "DisplayExternalObjectPath",
  $members: [
    { $name: "DeviceTag"                      , $type: U16 }, // Supported device.
    { $name: "Size"                           , $type: U16 }, // The size of DisplayPathTable.
    { $name: "ConnObjectId"                   , $type: U16 }, // Connector Object ID.
    { $name: "GPUObjectId"                    , $type: U16 }, // GPU ID.

    // GraphicObjIds[0] - Internal encoder
    // GraphicObjIds[1] - External encoder
    { $name: "GraphicObjIds"                  , $type: Arr, $ref: U16, $length: 2 }
  ]
});

// ATOM_DISPLAY_OBJECT_PATH_TABLE
vbios.$define({
  $name: "DisplayObjectPathTable",
  $members: [
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Version"                        , $type: U8  },
    { $name: "Padding"                        , $type: U16 },
    { $name: "Entries"                        , $type: Arr, $ref: vbios.DisplayObjectPath, $length: "NumEntries" },

    // GraphicObjIds[0] - Internal encoder
    // GraphicObjIds[1] - External encoder
    { $name: "GraphicObjIds"                  , $type: Arr, $ref: U16, $length: 2 }
  ]
});

// ATOM_OBJECT
vbios.$define({
  $name: "Object",
  $members: [
    { $name: "ObjectId"                       , $type: U16 },
    { $name: "SrcDstTableOffset"              , $type: U16 },
    { $name: "RecordOffset"                   , $type: U16 },
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

// Object_Info
// ATOM_OBJECT_HEADER
vbios.$define({
  $name: "ObjectInfo",
  $extend: vbios.CommonTableHeader
});

// ATOM_OBJECT_TABLE
vbios.$define({
  $name: "ObjectTable",
  $members: [
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Padding"                        , $type: U24 },
    { $name: "GraphicObjIds"                  , $type: Arr, $ref: vbios.Object, $length: "NumEntries" }
  ]
});

// ATOM_SRC_DST_TABLE_FOR_ONE_OBJECT
vbios.$define({
  $name: "SrcDstTable",
  $members: [
    { $name: "NumberOfSrc"                    , $type: U8  },
    { $name: "SrcObjectId"                    , $type: Arr, $ref: U16, $length: 1 },
    { $name: "NumberOfDst"                    , $type: U8  },
    { $name: "DstObjectId"                    , $type: Arr, $ref: U16, $length: 1 }
  ]
});

// ATOM_OBJECT_HEADER
vbios.$define({
  $extend: vbios.ObjectInfo,
  $version: [1, 1],
  $members: [
    { $name: "DeviceSupport"                  , $type: U16 },
    { $name: "ConnectorObjectTableOffset"     , $type: U16 },
    { $name: "RouterObjectTableOffset"        , $type: U16 },
    { $name: "EncoderObjectTableOffset"       , $type: U16 },
    { $name: "ProtectionObjectTableOffset"    , $type: U16 },
    { $name: "DisplayPathTableOffset"         , $type: U16 }
  ]
});

// ATOM_OBJECT_HEADER_V3
vbios.$define({
  $extend: vbios["ObjectInfo$1.1"],
  $version: [1, 3],
  $members: [
    { $name: "MiscObjectTableOffset"          , $type: U16 }
  ]
});

// ============================================================================
// [Power Source Information]
// ============================================================================

// ATOM_POWER_SOURCE_OBJECT
vbios.$define({
  $name: "PowerSourceObject",
  $members: [
    { $name: "SourceId"                       , $type: U8  },
    { $name: "SensorType"                     , $type: U8  },
    { $name: "SensorId"                       , $type: U8  },
    { $name: "SensorSlaveAddr"                , $type: U8  },
    { $name: "SensorRegIndex"                 , $type: U8  },
    { $name: "SensorRegBitMask"               , $type: U8  },
    { $name: "SensorActiveState"              , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 },
    { $name: "SensorPower"                    , $type: U16 }
  ]
});

// ATOM_POWER_SOURCE_INFO
vbios.$define({
  $name: "PowerSourceInfo",
  $extend: vbios.CommonTableHeader,
  $verInfo: null,
  $members: [
    { $name: "Behave"                         , $type: Arr, $ref: U8, $length: 16 },
    { $name: "Objects"                        , $type: Arr, $ref: vbios.PowerSourceObject, $length: 1 }
  ]
});

// ============================================================================
// [Gfx Information]
// ============================================================================

vbios.$define({
  $name: "GfxInfo",
  $extend: vbios.CommonTableHeader
});

// ATOM_GFX_INFO_V2_1
//   FIXME: The struct is called `ATOM_GFX_INFO_V2_1` although the version is 2.3?
vbios.$define({
  $extend: vbios.GfxInfo,
  $version: [2, 1],
  $members: [
    { $name: "GfxIPMinor"                     , $type: U8  },
    { $name: "GfxIPMajor"                     , $type: U8  },
    { $name: "MaxShaderEngines"               , $type: U8  },
    { $name: "MaxTilePipes"                   , $type: U8  },
    { $name: "MaxCUPerSH"                     , $type: U8  },
    { $name: "MaxSHPerSE"                     , $type: U8  },
    { $name: "MaxBackendsPerSE"               , $type: U8  },
    { $name: "MaxTextureChannelCaches"        , $type: U8  }
  ]
});

// ============================================================================
// [TMDS Information]
// ============================================================================

// ATOM_MISC_CONTROL_INFO
vbios.$define({
  $name: "MiscControlInfo",
  $members: [
    { $name: "Frequency"                      , $type: U16 },
    { $name: "PLLChargePump"                  , $type: U8  }, // PLL charge-pump gain control.
    { $name: "PLLDutyCycle"                   , $type: U8  }, // PLL duty cycle control.
    { $name: "PLLVCOGain"                     , $type: U8  }, // PLL VCO gain control.
    { $name: "PLLVoltageSwing"                , $type: U8  }  // PLL driver voltage swing control.
  ]
});

// ATOM_TMDS_INFO
vbios.$define({
  $name: "TMDSInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $name: "TMDSInfo",
  $extend: vbios.TMDSInfo,
  $version: [1, 1],
  $members: [
    { $name: "MaxFrequency"                   , $type: U16 }, // In [10Khz] unit.
    { $name: "MiscInfo"                       , $type: vbios.MiscControlInfo, $length: 4 }
  ]
});

// ============================================================================
// [I2CId Configuration]
// ============================================================================

// ATOM_I2C_ID_CONFIG
// ATOM_I2C_ID_CONFIG_ACCESS
//
//    [7:0] - I2C LINE Associate ID (0 == no I2C)
//    [7  ] - HWCapable  = 1,  [6:0]=HW assisted I2C ID(HW line selection)
//                       = 0,  [6:0]=SW assisted I2C ID
//    [6-4] - HWEngineId = 1,  HW engine for NON multimedia use
//                       = 2,  HW engine for Multimedia use
//                       = 3-7 Reserved for future I2C engines
//    [3-0] - I2CLineMux = A Mux number when it's HW assisted I2C or GPIO ID when it's SW I2C
vbios.$define({
  $name: "I2CIdConfig",
  $members: [
    { $name: "I2CLineMux"                     , $type: U8, $bitSize: 4 },
    { $name: "HWEngineId"                     , $type: U8, $bitSize: 3 },
    { $name: "HWCapable"                      , $type: U8, $bitSize: 1 }
  ]
});

// ============================================================================
// [GPIOI2C Information]
// ============================================================================

// ATOM_GPIO_I2C_ASSIGMENT
vbios.$define({
  $name: "GPIOI2CAssignment",
  $members: [
    { $name: "ClockMaskRegisterIndex"         , $type: U16 },
    { $name: "ClockEnRegisterIndex"           , $type: U16 },
    { $name: "ClockYRegisterIndex"            , $type: U16 },
    { $name: "ClockARegisterIndex"            , $type: U16 },
    { $name: "DataMaskRegisterIndex"          , $type: U16 },
    { $name: "DataEnRegisterIndex"            , $type: U16 },
    { $name: "DataYRegisterIndex"             , $type: U16 },
    { $name: "DataARegisterIndex"             , $type: U16 },
    { $name: "I2CId"                          , $type: vbios.I2CIdConfig },
    { $name: "ClockMaskShift"                 , $type: U8  },
    { $name: "ClockEnShift"                   , $type: U8  },
    { $name: "ClockYShift"                    , $type: U8  },
    { $name: "ClockAShift"                    , $type: U8  },
    { $name: "DataMaskShift"                  , $type: U8  },
    { $name: "DataEnShift"                    , $type: U8  },
    { $name: "DataYShift"                     , $type: U8  },
    { $name: "DataAShift"                     , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Reserved2"                      , $type: U8  }
  ]
});

// ATOM_GPIO_I2C_INFO
vbios.$define({
  $name: "GPIOI2CInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.GPIOI2CInfo,
  $version: [1, 1],
  $members: [
    { $name: "GPIOInfo"                       , $type: Arr, $ref: vbios.GPIOI2CAssignment, $length: 16 }
  ]
});

// ============================================================================
// [XTMDS Information]
// ============================================================================

// ATOM_XTMDS_INFO
vbios.$define({
  $name: "XTMDSInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.XTMDSInfo,
  $version: [1, 1],
  $members: [
    { $name: "SingleLinkMaxFrequency"         , $type: U16 },
    { $name: "I2CId"                          , $type: vbios.I2CIdConfig },
    { $name: "XtransimitterId"                , $type: U8  },
    { $name: "SupportedLink"                  , $type: U8  }, // Bit field, bit0=1, single link supported;bit1=1, dual link supported.
    { $name: "SequnceAlterId"                 , $type: U8  }, // This ID is used to alert driver that the sequence is not "standard".
    { $name: "MasterAddress"                  , $type: U8  }, // Address to control Master xTMDS Chip.
    { $name: "SlaveAddress"                   , $type: U8  }, // Address to control Slave xTMDS Chip.
  ]
});

// ============================================================================
// [TODO Uncategorized]
// ============================================================================

// DFP_DPMS_STATUS_CHANGE_PARAMETER
vbios.$define({
  $name: "DFPDPMSStatusChangeParameter",
  $version: [1, 1],
  $members: [
    { $name: "Enable"                         , $type: U8  },
    { $name: "Device"                         , $type: U8  },
    { $name: "Padding"                        , $type: U16 }
  ]
});

// WRITE_ONE_BYTE_HW_I2C_DATA_PARAMETERS
vbios.$define({
  $name: "WriteOneByteHWI2CDataParameters",
  $members: [
    { $name: "Prescale"                       , $type: U16 }, // Ratio between engine clock and I2C clock.
    { $name: "ByteOffset"                     , $type: U16 }, // Write to which byte.
    { $name: "Data"                           , $type: U8  }, // PS data1.
    { $name: "Status"                         , $type: U8  }, // Status byte 1=success, 2=failure, Also is used as PS data2
    { $name: "SlaveAddr"                      , $type: U8  }, // Write to which slave.
    { $name: "LineNumber"                     , $type: U8  }  // Write from which HW assisted line.
  ]
});

// ATOM_MODE_MISC_INFO
// ATOM_MODE_MISC_INFO_ACCESS
vbios.$define({
  $name: "ModeMiscInfo",
  $members: [
    { $name: "HorizontalCutOff"               , $type: U16, $bitSize: 1 },
    { $name: "HSyncPolarity"                  , $type: U16, $bitSize: 1 },
    { $name: "VSyncPolarity"                  , $type: U16, $bitSize: 1 },
    { $name: "VerticalCutOff"                 , $type: U16, $bitSize: 1 },
    { $name: "HReplicationBy2"                , $type: U16, $bitSize: 1 },
    { $name: "VReplicationBy2"                , $type: U16, $bitSize: 1 },
    { $name: "CompositeSync"                  , $type: U16, $bitSize: 1 },
    { $name: "Interlace"                      , $type: U16, $bitSize: 1 },
    { $name: "DoubleClock"                    , $type: U16, $bitSize: 1 },
    { $name: "RGB888"                         , $type: U16, $bitSize: 1 },
    { $name: "Reserved1"                      , $type: U16, $bitSize: 6 }
  ]
});

// ATOM_MODE_TIMING
vbios.$define({
  $name: "ModeTiming",
  $members: [
    { $name: "CRTCHorzTotal"                  , $type: U16 },
    { $name: "CRTCHorzDisp"                   , $type: U16 },
    { $name: "CRTCHorzSyncStart"              , $type: U16 },
    { $name: "CRTCHorzSyncWidth"              , $type: U16 },
    { $name: "CRTCVertTotal"                  , $type: U16 },
    { $name: "CRTCVertDisp"                   , $type: U16 },
    { $name: "CRTCVertSyncStart"              , $type: U16 },
    { $name: "CRTCVertSyncWidth"              , $type: U16 },
    { $name: "PixelClock"                     , $type: U16 },
    { $name: "ModeMiscInfo"                   , $type: vbios.ModeMiscInfo },
    { $name: "CRTCOverscanRight"              , $type: U16 },
    { $name: "CRTCOverscanLeft"               , $type: U16 },
    { $name: "CRTCOverscanBottom"             , $type: U16 },
    { $name: "CRTCOverscanTop"                , $type: U16 },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "InternalModeNumber"             , $type: U8  },
    { $name: "RefreshRate"                    , $type: U8  }
  ]
});

// Obsolete from R600.
vbios.$define({
  $name: "DACInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.DACInfo,
  $version: [2, 1],
  $members: [
    { $name: "MaxFrequency"                   , $type: U16 }, // in [10Khz] unit.
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

// COMPASSIONATE_DATA
vbios.$define({
  $name: "CompassionateData",
  $extend: vbios.CommonTableHeader,
  $members: [
    { $name: "DAC1_BG_Adjustment"             , $type: U8  },
    { $name: "DAC1_DAC_Adjustment"            , $type: U8  },
    { $name: "DAC1_FORCE_Data"                , $type: U16 },
    { $name: "DAC2_CRT2_BG_Adjustment"        , $type: U8  },
    { $name: "DAC2_CRT2_DAC_Adjustment"       , $type: U8  },
    { $name: "DAC2_CRT2_FORCE_Data"           , $type: U16 },
    { $name: "DAC2_CRT2_MUX_RegisterIndex"    , $type: U16 },
    { $name: "DAC2_CRT2_MUX_RegisterInfo"     , $type: U8  },
    { $name: "DAC2_NTSC_BG_Adjustment"        , $type: U8  },
    { $name: "DAC2_NTSC_DAC_Adjustment"       , $type: U8  },
    { $name: "DAC2_TV1_FORCE_Data"            , $type: U16 },
    { $name: "DAC2_TV1_MUX_RegisterIndex"     , $type: U16 },
    { $name: "DAC2_TV1_MUX_RegisterInfo"      , $type: U8  },
    { $name: "DAC2_CV_BG_Adjustment"          , $type: U8  },
    { $name: "DAC2_CV_DAC_Adjustment"         , $type: U8  },
    { $name: "DAC2_CV_FORCE_Data"             , $type: U16 },
    { $name: "DAC2_CV_MUX_RegisterIndex"      , $type: U16 },
    { $name: "DAC2_CV_MUX_RegisterInfo"       , $type: U8  },
    { $name: "DAC2_PAL_BG_Adjustment"         , $type: U8  },
    { $name: "DAC2_PAL_DAC_Adjustment"        , $type: U8  },
    { $name: "DAC2_TV2_FORCE_Data"            , $type: U16 }
  ]
});

// ATOM_CONNECTOR_INFO
// ATOM_CONNECTOR_INFO_ACCESS
vbios.$define({
  $name: "ConnectorInfo",
  $members: [
    { $name: "AssociatedDAC"                  , $type: U8  , $bitSize: 4 },
    { $name: "ConnectorType"                  , $type: U8  , $bitSize: 4 }
  ]
});

// ATOM_CONNECTOR_INFO_I2C
vbios.$define({
  $name: "ConnectorInfoI2C",
  $extend: vbios.ConnectorInfo,
  $members: [
    { $name: "I2CId"                          , $type: vbios.I2CIdConfig }
  ]
});

// ATOM_CONNECTOR_INC_SRC_BITMAP
vbios.$define({
  $name: "ConnectorIntSrcBitmap",
  $members: [
    { $name: "IntSrcBitmap"                   , $type: U8  }
  ]
});

// ATOM_SUPPORTED_DEVICES_INFO
vbios.$define({
  $name: "SupportedDevicesInfo",
  $extend: vbios.CommonTableHeader,
  $members: [
    { $name: "DeviceSupport"                  , $type: U16 }
  ]
});

// ATOM_SUPPORTED_DEVICES_INFO
vbios.$define({
  $extend: vbios.SupportedDevicesInfo,
  $version: [1, 0],
  $members: [
    { $name: "ConnectionInfo"                 , $type: vbios.ConnectorInfoI2C     , $length: 10 }
  ]
});

// ATOM_SUPPORTED_DEVICES_INFO_2
vbios.$define({
  $extend: vbios.SupportedDevicesInfo,
  $version: [2, 0],
  $members: [
    { $name: "ConnectionInfo"                 , $type: vbios.ConnectorInfoI2C     , $length: 10 },
    { $name: "IntSourceInfo"                  , $type: vbios.ConnectorIntSrcBitmap, $length: 10 }
  ]
});

// ATOM_SUPPORTED_DEVICES_INFO_2d1
vbios.$define({
  $extend: vbios.SupportedDevicesInfo,
  $version: [2, 1],
  $members: [
    { $name: "ConnectionInfo"                 , $type: vbios.ConnectorInfoI2C     , $length: 16 },
    { $name: "IntSourceInfo"                  , $type: vbios.ConnectorIntSrcBitmap, $length: 16 }
  ]
});

// ATOM_ENCODER_ATTRIBUTE
// ATOM_ENCODER_ANALOG_ATTRIBUTE
// ATOM_ENCODER_DIGITAL_ATTRIBUTE
vbios.$define({
  $name: "EncoderAttribute",
  $members: [
    { $name: "Attribute"                      , $type: U8  },
    { $name: "Padding"                        , $type: U8  }
  ]
});

// DVO_ENCODER_CONTROL_PARAMETERS
vbios.$define({
  $name: "DVOEncoderControlParameters",
  $version: [1, 0],
  $members: [
    { $name: "PixelClock"                     , $type: U16 },
    { $name: "EncoderId"                      , $type: U16 },
    { $name: "DeviceType"                     , $type: U8  },
    { $name: "Action"                         , $type: U8  },
    { $name: "DeviceAttr"                     , $type: vbios.EncoderAttribute }
  ]
});

// DVO_ENCODER_CONTROL_PARAMETERS_V3
vbios.$define({
  $name: "DVOEncoderControlParameters",
  $version: [1, 3],
  $members: [
    { $name: "PixelClock"                     , $type: U16 },
    { $name: "DVOConfig"                      , $type: U8  },
    { $name: "Action"                         , $type: U8  },
    { $name: "Reserved1"                      , $type: U32 }
  ]
});

// DVO_ENCODER_CONTROL_PARAMETERS_V1_4
vbios.$define({
  $name: "DVOEncoderControlParameters",
  $version: [1, 4],
  $members: [
    { $name: "PixelClock"                     , $type: U16 },
    { $name: "DVOConfig"                      , $type: U8  },
    { $name: "Action"                         , $type: U8  },
    { $name: "BitPerColor"                    , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 }
  ]
});

// DVO_ENCODER_CONTROL_PS_ALLOCATION
vbios.$define({
  $name: "DVOEncoderControlPSAllocation",
  $version: [1],
  $members: [
    { $name: "DVOEncoder"                     , $type: vbios["DVOEncoderControlParameters$1.0"] },
    { $name: "Reserved1"                      , $type: vbios.WriteOneByteHWI2CDataParameters }
  ]
});

// ============================================================================
// [OEM Information]
// ============================================================================

// ATOM_OEM_INFO
vbios.$define({
  $name: "OEMInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.OEMInfo,
  $version: [1, 1],
  $members: [
    { $name: "I2CId"                          , $type: vbios.I2CIdConfig }
  ]
});

// ============================================================================
// [LCD Information]
// ============================================================================

// ATOM_DTD_FORMAT
vbios.$define({
  $name: "DTDFormat",
  $members: [
    { $name: "PixClock"                       , $type: U16 },
    { $name: "HActive"                        , $type: U16 },
    { $name: "HBlanking_Time"                 , $type: U16 },
    { $name: "VActive"                        , $type: U16 },
    { $name: "VBlanking_Time"                 , $type: U16 },
    { $name: "HSyncOffset"                    , $type: U16 },
    { $name: "HSyncWidth"                     , $type: U16 },
    { $name: "VSyncOffset"                    , $type: U16 },
    { $name: "VSyncWidth"                     , $type: U16 },
    { $name: "ImageHSize"                     , $type: U16 },
    { $name: "ImageVSize"                     , $type: U16 },
    { $name: "HBorder"                        , $type: U8  },
    { $name: "VBorder"                        , $type: U8  },
    { $name: "ModeMiscInfo"                   , $type: vbios.ModeMiscInfo },
    { $name: "InternalModeNumber"             , $type: U8  },
    { $name: "RefreshRate"                    , $type: U8  }
  ]
});

// ATOM_LCD_REFRESH_RATE_SUPPORT
vbios.$define({
  $name: "LCDRefreshRateSupport",
  $members: [
    { $name: "SupportedRefreshRate"           , $type: U8  },
    { $name: "MinRefreshRateForDRR"           , $type: U8  }
  ]
});

vbios.$define({
  $name: "LCDInfo",
  $extend: vbios.CommonTableHeader
});

// ATOM_LCD_INFO
vbios.$define({
  $extend: vbios.LCDInfo,
  $version: [1, 1],
  $members: [
    { $name: "LCDTiming"                      , $type: vbios.DTDFormat },
    { $name: "ExtInfoTableOffset"             , $type: U16 },
    { $name: "RefreshRateSupport"             , $type: vbios.LCDRefreshRateSupport },
    { $name: "OffDelayInMS"                   , $type: U16 }, // In [ms] unit.
    { $name: "PowerSequenceDigOntoDE"         , $type: U8  }, // In [10ms] unit.
    { $name: "PowerSequenceDEtoBLOn"          , $type: U8  }, // In [10ms] unit.
    { $name: "LCDMisc"                        , $type: U8  },
    { $name: "PanelDefaultRefreshRate"        , $type: U8  },
    { $name: "PanelIdentification"            , $type: U8  },
    { $name: "SSId"                           , $type: U8  }
  ]
});

// ATOM_LCD_INFO_V12
vbios.$define({
  $extend: vbios["LCDInfo$1.1"],
  $version: [1, 2],
  $members: [
    { $name: "LCDVendorId"                    , $type: U16 },
    { $name: "LCDProductId"                   , $type: U16 },
    { $name: "LCDPanelSpecialHandlingCap"     , $type: U8  },
    { $name: "PanelInfoSize"                  , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

// ATOM_LCD_INFO_V13
vbios.$define({
  $extend: vbios.LCDInfo,
  $version: [1, 3],
  $members: [
    { $name: "LCDTiming"                      , $type: vbios.DTDFormat },
    { $name: "ExtInfoTableOffset"             , $type: U16 },
    { $name: "RefreshRateSupport"             , $type: vbios.LCDRefreshRateSupport },
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "LCDMisc"                        , $type: U8  },
    { $name: "PanelDefaultRefreshRate"        , $type: U8  },
    { $name: "PanelIdentification"            , $type: U8  },
    { $name: "SSId"                           , $type: U8  },
    { $name: "LCDVendorId"                    , $type: U16 },
    { $name: "LCDProductId"                   , $type: U16 },
    { $name: "LCDPanelSpecialHandlingCap"     , $type: U8  },
    { $name: "PanelInfoSize"                  , $type: U8  },
    { $name: "BacklightPWM"                   , $type: U16 },
    { $name: "PowerSequenceDigonToDE"         , $type: U8  }, // In [4ms] unit.
    { $name: "PowerSequenceDEToVaryBL"        , $type: U8  }, // In [4ms] unit.
    { $name: "PowerSequenceVaryBLToDE"        , $type: U8  }, // In [4ms] unit.
    { $name: "PowerSequenceDEtoDigon"         , $type: U8  }, // In [4ms] unit.
    { $name: "OffDelay"                       , $type: U8  }, // In [4ms] unit.
    { $name: "PowerSequenceVaryBLtoBLON"      , $type: U8  }, // In [4ms] unit.
    { $name: "PowerSequenceBLONtoVaryBL"      , $type: U8  }, // In [4ms] unit.
    { $name: "Reserved2"                      , $type: U8  },
    { $name: "DPCDEDPConfigurationCap"        , $type: U8  }, // DPCD 0Dh
    { $name: "DPCDMaxLinkRate"                , $type: U8  }, // DPCD 01h
    { $name: "DPCDMaxLaneCount"               , $type: U8  }, // DPCD 02h
    { $name: "DPCDMaxDownspread"              , $type: U8  }, // DPCD 03h
    { $name: "MaxPixClockInSingleLink"        , $type: U16 }, // Max PixelClock frequency in single link mode.
    { $name: "EDPToLVDSRxId"                  , $type: U8  },
    { $name: "LCDReserved"                    , $type: U8  },
    { $name: "Reserved3"                      , $type: U32 },
    { $name: "Reserved4"                      , $type: U32 }
  ]
});

// ============================================================================
// [Voltage Object / Information]
// ============================================================================

vbios.VOLTAGE_OBJ_GPIO_LUT                 = 0;
vbios.VOLTAGE_OBJ_VR_I2C_INIT_SEQ          = 3;
vbios.VOLTAGE_OBJ_PHASE_LUT                = 4;
vbios.VOLTAGE_OBJ_SVID2                    = 7;
vbios.VOLTAGE_OBJ_EVV                      = 8;
vbios.VOLTAGE_OBJ_POWER_BOOST_LEAKAGE_LUT  = 16;
vbios.VOLTAGE_OBJ_HIGH_STATE_LEAKAGE_LUT   = 17;
vbios.VOLTAGE_OBJ_HIGH1_STATE_LEAKAGE_LUT  = 18;

// VOLTAGE_LUT_ENTRY
vbios.$define({
  $name: "VoltageLUTEntry",
  $version: [1],
  $members: [
    { $name: "VoltageCode"                    , $type: U16 }, // The Voltage ID, either GPIO or I2C code.
    { $name: "VoltageValue"                   , $type: U16 }  // In [mV] unit.
  ]
});

vbios.$define({
  $name: "VoltageLUTEntry",
  $version: [2],
  $members: [
    { $name: "VoltageId"                      , $type: U32 }, // The Voltage ID which is used to program GPIO register.
    { $name: "VoltageValue"                   , $type: U16 }  // In [mV] unit.
  ]
});

// ATOM_VOLTAGE_FORMULA
vbios.$define({
  $name: "VoltageFormula",
  $version: [1],
  $members: [
    { $name: "VoltageBaseLevel"               , $type: U16 },
    { $name: "VoltageStep"                    , $type: U16 },
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Flag"                           , $type: U8  },
    { $name: "BaseVId"                        , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Entries"                        , $type: Arr  , $ref: U8, $length: "NumEntries" }
  ]
});

// ATOM_VOLTAGE_FORMULA_V2
vbios.$define({
  $name: "VoltageFormula",
  $version: [2],
  $members: [
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 },
    { $name: "Entries"                        , $type: Arr  , $ref: vbios.VoltageLUTEntry$1, $length: "NumEntries" }
  ]
});

// ATOM_VOLTAGE_CONTROL
vbios.$define({
  $name: "VoltageControl",
  $members: [
    { $name: "VoltageControlId"               , $type: U8  },
    { $name: "VoltageControlI2CLine"          , $type: U8  },
    { $name: "VoltageControlAddress"          , $type: U8  },
    { $name: "VoltageControlOffset"           , $type: U8  },
    { $name: "GPIOPinAIndex"                  , $type: U16 },
    { $name: "GPIOPinBitShift"                , $type: Arr  , $ref: U8, $length: 9 },
    { $name: "Reserved1"                      , $type: U8  }
  ]
});

// ATOM_VOLTAGE_OBJECT
vbios.$define({
  $name: "VoltageObjectV1",
  $members: [
    { $name: "VoltageType"                    , $type: U8  },                   // Indicates Voltage Source: Vddc, Mvddc, Mvddq or Mvddci.
    { $name: "Size"                           , $type: U8  },                   // Size of the Object.
    { $name: "Control"                        , $type: vbios.VoltageControl   }, // Describes how to control.
    { $name: "Formula"                        , $type: vbios.VoltageFormula$1 }  // Indicate How to convert real Voltage to VID.
  ]
});

// ATOM_VOLTAGE_OBJECT_V2
vbios.$define({
  $name: "VoltageObjectV2",
  $members: [
    { $name: "VoltageType"                    , $type: U8  },
    { $name: "Size"                           , $type: U8  },
    { $name: "Control"                        , $type: vbios.VoltageControl },
    { $name: "Formula"                        , $type: vbios.VoltageFormula$2 }
  ]
});

// ATOM_VOLTAGE_INFO
// ATOM_VOLTAGE_INFO_HEADER
vbios.$define({
  $name: "VoltageInfo",
  $extend: vbios.CommonTableHeader,
  $members: [
    { $name: "VddcBaseLevel"                  , $type: U16 }, // In [50mV] unit.
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "BytesPerVoltageEntry"           , $type: U8  },
    { $name: "VoltageStep"                    , $type: U8  }, // In [0.5mV] unit, indicating in how many [mV] increament is one step.
    { $name: "DefaultVoltageEntry"            , $type: U8  },
    { $name: "VoltageControlI2CLine"          , $type: U8  },
    { $name: "VoltageControlAddress"          , $type: U8  },
    { $name: "VoltageControlOffset"           , $type: U8  }
    // TODO?
    // The actual number of entry is present at NumOfVoltageEntries*BytesPerVoltageEntry
    // { $name: "Entries"                        , $type: Arr }
  ]
});

// ATOM_VOLTAGE_OBJECT_HEADER_V3
vbios.$define({
  $name: "VoltageObjectV3",
  $verInfo: ["VoltageMode"],
  $members: [
    { $name: "VoltageType"                    , $type: U8  }, // Indicates voltage source [Vddc, Mvddc, Mvddq, or Mvddci].
    { $name: "VoltageMode"                    , $type: U8  }, // Indicates voltage control mode [Init, Set, Leakage, Set phase].
    { $name: "Size"                           , $type: U16 }  // Size of the object.
  ]
});

// ATOM_I2C_VOLTAGE_OBJECT_V3
vbios.$define({
  $extend: vbios.VoltageObjectV3,
  $version: [vbios.VOLTAGE_OBJ_VR_I2C_INIT_SEQ],
  $members: [
    { $name: "VoltageRegulatorId"             , $type: U8  },
    { $name: "VoltageControlI2cLine"          , $type: U8  },
    { $name: "VoltageControlAddress"          , $type: U8  },
    { $name: "VoltageControlOffset"           , $type: U8  },
    { $name: "VoltageControlFlag"             , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 },
    // TODO: Length not implemented, ends with 0xFF.
    { $name: "LUTEntries"                     , $type: Arr, $ref: vbios.VoltageLUTEntry$1, $length: 1 }
  ]
});

// ATOM_GPIO_VOLTAGE_OBJECT_V3
vbios.$define({
  $name: "GPIOVoltageObject",
  $extend: vbios.VoltageObjectV3,
  $version: [vbios.VOLTAGE_OBJ_GPIO_LUT],
  $members: [
    { $name: "VoltageGPIOControlId"           , $type: U8  },
    { $name: "GPIOEntryNum"                   , $type: U8  },
    { $name: "PhaseDelay"                     , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "GPIOMaskVal"                    , $type: U32 },
    // TODO: Length not implemented.
    { $name: "LUTEntries"                     , $type: Arr, $ref: vbios.VoltageLUTEntry$2, $length: 1 }
  ]
});

vbios.$define({
  $extend: vbios["VoltageObjectV3$" + vbios.VOLTAGE_OBJ_GPIO_LUT],
  $version: [vbios.VOLTAGE_OBJ_PHASE_LUT]
});

// ATOM_LEAKAGE_VOLTAGE_OBJECT_V3
vbios.$define({
  $extend: vbios.VoltageObjectV3,
  $version: [vbios.VOLTAGE_OBJ_POWER_BOOST_LEAKAGE_LUT],
  $members: [
    { $name: "LeakageControlId"               , $type: U8  },
    { $name: "LeakageEntryNum"                , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "MaxVoltageLevel"                , $type: U32 },
    // TODO: Length not implemented.
    { $name: "LUTEntries"                     , $type: Arr, $ref: vbios.VoltageLUTEntry$2, $length: 1 }
  ]
});

vbios.$define({
  $extend: vbios["VoltageObjectV3$" + vbios.VOLTAGE_OBJ_POWER_BOOST_LEAKAGE_LUT],
  $version: [vbios.VOLTAGE_OBJ_HIGH_STATE_LEAKAGE_LUT],
});

vbios.$define({
  $extend: vbios["VoltageObjectV3$" + vbios.VOLTAGE_OBJ_POWER_BOOST_LEAKAGE_LUT],
  $version: [vbios.VOLTAGE_OBJ_HIGH1_STATE_LEAKAGE_LUT],
});

// ATOM_SVID2_VOLTAGE_OBJECT_V3
vbios.$define({
  $extend: vbios.VoltageObjectV3,
  $version: [vbios.VOLTAGE_OBJ_SVID2],
  $members: [
    { $name: "LoadLinePSI"                    , $type: U16 },
    { $name: "SVDGPIOId"                      , $type: U8  },
    { $name: "SVCGPIOId"                      , $type: U8  },
    { $name: "Reserved1"                      , $type: U32 }
  ]
});

// ATOM_MERGED_VOLTAGE_OBJECT_V3
vbios.$define({
  $extend: vbios.VoltageObjectV3,
  $version: [vbios.VOLTAGE_OBJ_MERGED_POWER],
  $members: [
    { $name: "MergedVType"                    , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 }
  ]
});

/*
// ATOM_EVV_DPM_INFO
vbios.$define({
  $name: "EVVDPMInfo",
  $members: [
    { $name: "DPMSocClock"                    , $type: U32 }, // DPM state SOC clock.
    { $name: "VAdjOffset"                     , $type: U16 }, // In [mV] unit, voltage offset adjustment.
    { $name: "DPMTblVIndex"                   , $type: U8  }, // Voltage Index in SMC_DPM_Table structure VddcTable/VddGfxTable.
    { $name: "DPMState"                       , $type: U8  }  // DPMState0..7.
  ]
});

// ATOM_EVV_VOLTAGE_OBJECT_V3
vbios.$define({
  $extend: vbios.VoltageObjectV3,
  $version: [?],
  $members: [
    { $name: "Entries"                        , $type: vbios.EVVDPMInfo, $length: 8 }
  ]
});
*/

// ATOM_VOLTAGE_OBJECT_INFO
vbios.$define({
  $name: "VoltageObjectInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.VoltageObjectInfo,
  $version: [1, 1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.VoltageObjectV1, $length: 3 }
  ]
});

// ATOM_VOLTAGE_OBJECT_INFO_V2
vbios.$define({
  $extend: vbios.VoltageObjectInfo,
  $version: [2, 1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.VoltageObjectV2, $length: 3 }
  ]
});

// ATOM_VOLTAGE_OBJECT_INFO_V3
vbios.$define({
  $extend: vbios.VoltageObjectInfo,
  $version: [3, 1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.VoltageObjectV3, $length: 3 }
  ]
});

// ============================================================================
// [ASIC Profiling Information]
// ============================================================================

// ATOM_LEAKID_VOLTAGE
vbios.$define({
  $name: "LeakIdVoltage",
  $members: [
    { $name: "LeakageId"                      , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Voltage"                        , $type: U16 }
  ]
});

// ATOM_ASIC_PROFILE_VOLTAGE
vbios.$define({
  $name: "ASICProfileVoltage",
  $members: [
    { $name: "ProfileId"                      , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Size"                           , $type: U16 },
    { $name: "EfuseSpareStartAddr"            , $type: U16 },
    { $name: "FuseIndex"                      , $type: Arr, $ref: U16                , $length: 8 },
    { $name: "LeakVoltage"                    , $type: Arr, $ref: vbios.LeakIdVoltage, $length: 2 }
  ]
});

// EFUSE_LOGISTIC_FUNC_PARAM
//   Measured = LN((2^Bitsize - 1) / EFUSE - 1) * Range / -Alpha + (Max + Min) / 2
vbios.$define({
  $name: "EfuseLogisticFuncParam",
  $members: [
    { $name: "EfuseIndex"                     , $type: U16 }, // Efuse Index in DWORD address, for example Index 911, usEuseIndex = 112.
    { $name: "EfuseBitLSB"                    , $type: U8  }, // Efuse bit LSB in DWORD address, for example Index 911, usEfuseBitLSB= 911-112*8=15.
    { $name: "EfuseLength"                    , $type: U8  }, // Efuse bits length.
    { $name: "EfuseEncodeRange"               , $type: U32 }, // Range = Max - Min, bit31 indicate the efuse is negative number.
    { $name: "EfuseEncodeAverage"             , $type: U32 }  // Average = (Max + Min) / 2.
  ]
});

// EFUSE_LINEAR_FUNC_PARAM
//   Measured = Round(Efuse * (Max - Min) / (2^BitSize - 1) + Min)
vbios.$define({
  $name: "EfuseLinearFuncParam",
  $members: [
    { $name: "EfuseIndex"                     , $type: U16 }, // Efuse Index in DWORD address, for example Index 911, usEuseIndex = 112.
    { $name: "EfuseBitLSB"                    , $type: U8  }, // Efuse bit LSB in DWORD address, for example Index 911, usEfuseBitLSB = 911-112*8=15.
    { $name: "EfuseLength"                    , $type: U8  }, // Efuse bits length.
    { $name: "EfuseEncodeRange"               , $type: U32 }, // Range = Max - Min, bit31 indicate the efuse is negative number.
    { $name: "EfuseMin"                       , $type: U32 }  // Min.
  ]
});

// ATOM_ASIC_PROFILING_INFO
vbios.$define({
  $name: "ASICProfilingInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.ASICProfilingInfo,
  $version: [1, 1],
  $members: [
    { $name: "Voltage"                        , $type: vbios.ASICProfileVoltage }
  ]
});

vbios.$define({
  $extend: vbios.ASICProfilingInfo,
  $version: [2, 1],
  $members: [
    { $name: "LeakageBinNum"                  , $type: U8  },
    { $name: "LeakageBinArrayOffset"          , $type: U16 },
    { $name: "ElbVddcNum"                     , $type: U8  },
    { $name: "ElbVddcIdArrayOffset"           , $type: U16 },
    { $name: "ElbVddcLevelArrayOffset"        , $type: U16 },
    { $name: "ElbVddcINum"                    , $type: U8  },
    { $name: "ElbVddcIIdArrayOffset"          , $type: U16 },
    { $name: "ElbVddcILevelArrayOffset"       , $type: U16 }
  ]
});

vbios.$define({
  $name: "ASICProfilingDPMEntry",
  $version: [3, 1],
  $members: [
    { $name: "Power"                          , $type: U16 },
    { $name: "Current"                        , $type: U16 }
  ]
});

vbios.$define({
  $extend: vbios.ASICProfilingInfo,
  $version: [3, 1],
  $members: [
    { $name: "EvvDerateTdp"                   , $type: U32 },
    { $name: "EvvDerateTdc"                   , $type: U32 },
    { $name: "BoardCoreTemp"                  , $type: U32 },
    { $name: "MaxVddc"                        , $type: U32 },
    { $name: "MinVddc"                        , $type: U32 },
    { $name: "LoadLineSlop"                   , $type: U32 },
    { $name: "LeakageTemp"                    , $type: U32 },
    { $name: "LeakageVoltage"                 , $type: U32 },
    { $name: "CACm"                           , $type: vbios.EfuseLinearFuncParam },
    { $name: "CACb"                           , $type: vbios.EfuseLinearFuncParam },
    { $name: "Ktb"                            , $type: vbios.EfuseLogisticFuncParam },
    { $name: "Kvm"                            , $type: vbios.EfuseLogisticFuncParam },
    { $name: "Kvb"                            , $type: vbios.EfuseLogisticFuncParam },
    { $name: "LeakageEuseIndex"               , $type: U16 },
    { $name: "LeakageEfuseBitLSB"             , $type: U8  },
    { $name: "LeakageEfuseLength"             , $type: U8  },
    { $name: "LeakageEncodeLnMaxDivMin"       , $type: U32 },
    { $name: "LeakageEncodeMax"               , $type: U32 },
    { $name: "LeakageEncodeMin"               , $type: U32 },
    { $name: "EfuseLogisticAlpha"             , $type: U32 },
    { $name: "DPMEntries"                     , $type: Arr, $ref: vbios["ASICProfilingDPMEntry$3.1"], $length: 8 }
  ]
});

vbios.$define({
  $extend: vbios.ASICProfilingInfo,
  $version: [3, 2],
  $members: [
    { $name: "EvvLkgFactor"                   , $type: U32 },
    { $name: "BoardCoreTemp"                  , $type: U32 },
    { $name: "MaxVddc"                        , $type: U32 },
    { $name: "MinVddc"                        , $type: U32 },
    { $name: "LoadLineSlop"                   , $type: U32 },
    { $name: "LeakageTemp"                    , $type: U32 },
    { $name: "LeakageVoltage"                 , $type: U32 },
    { $name: "CACm"                           , $type: vbios.EfuseLinearFuncParam },
    { $name: "CACb"                           , $type: vbios.EfuseLinearFuncParam },
    { $name: "Ktb"                            , $type: vbios.EfuseLogisticFuncParam },
    { $name: "Kvm"                            , $type: vbios.EfuseLogisticFuncParam },
    { $name: "Kvb"                            , $type: vbios.EfuseLogisticFuncParam },
    { $name: "LeakageEuseIndex"               , $type: U16 },
    { $name: "LeakageEfuseBitLSB"             , $type: U8  },
    { $name: "LeakageEfuseLength"             , $type: U8  },
    { $name: "LeakageEncodeLnMaxDivMin"       , $type: U32 },
    { $name: "LeakageEncodeMax"               , $type: U32 },
    { $name: "LeakageEncodeMin"               , $type: U32 },
    { $name: "EfuseLogisticAlpha"             , $type: U32 },
    { $name: "DPMPowerEntries"                , $type: Arr, $ref: U16, $length: 8 },
    { $name: "DPMTDPDerateEntries"            , $type: Arr, $ref: U32, $length: 8 }
  ]
});

// Tonga/Fiji speed EVV algorithm.
vbios.$define({
  $extend: vbios["ASICProfilingInfo$3.2"],
  $version: [3, 3],
  $members: [
    { $name: "RoFuse"                         , $type: vbios.EfuseLinearFuncParam },
    { $name: "RoAlpha"                        , $type: U32 },
    { $name: "RoBeta"                         , $type: U32 },
    { $name: "RoGamma"                        , $type: U32 },
    { $name: "RoEpsilon"                      , $type: U32 },
    { $name: "ATermRo"                        , $type: U32 },
    { $name: "BTermRo"                        , $type: U32 },
    { $name: "CTermRo"                        , $type: U32 },
    { $name: "SocClockMargin"                 , $type: U32 },
    { $name: "FMaxPercent"                    , $type: U32 },
    { $name: "CRPercent"                      , $type: U32 },
    { $name: "SFMaxPercent"                   , $type: U32 },
    { $name: "SCRPercent"                     , $type: U32 },
    { $name: "SDCMargine"                     , $type: U32 }
  ]
});

// Fiji speed EVV algorithm.
vbios.$define({
  $extend: vbios["ASICProfilingInfo$3.2"],
  $version: [3, 4],
  $members: [
    { $name: "RoFuse"                         , $type: vbios.EfuseLinearFuncParam },
    { $name: "EvvDefaultVddc"                 , $type: U32 },
    { $name: "EvvNoCalcVddc"                  , $type: U32 },
    { $name: "ParamNegFlag"                   , $type: U16 },
    { $name: "SpeedModel"                     , $type: U16 },
    { $name: "SMA"                            , $type: Arr, $ref: U32, $length: 8 }, // ulSM_A[0..7]
    { $name: "SMASign"                        , $type: Arr, $ref: U8 , $length: 8 }, // ucSM_A[0..7]_sign
    { $name: "MarginRoA"                      , $type: U32 },
    { $name: "MarginRoB"                      , $type: U32 },
    { $name: "MarginRoC"                      , $type: U32 },
    { $name: "MarginFixed"                    , $type: U32 },
    { $name: "MarginFMaxMean"                 , $type: U32 },
    { $name: "MarginPLatMean"                 , $type: U32 },
    { $name: "MarginFMaxSigma"                , $type: U32 },
    { $name: "MarginPLatSigma"                , $type: U32 },
    { $name: "MarginDCSigma"                  , $type: U32 },
    { $name: "Reserved1"                      , $type: Arr, $ref: U32, $length: 8 }
  ]
});

// Polaris10/Polaris11 speed EVV algorithm.
vbios.$define({
  $extend: vbios.ASICProfilingInfo,
  $version: [3, 5],
  $members: [
    { $name: "MaxVddc"                        , $type: U32 }, // In [0.01mV] unit, maximum voltage for all parts.
    { $name: "MinVddc"                        , $type: U32 }, // In [0.01mV] unit, minimum voltage for all parts.
    { $name: "LkgEuseIndex"                   , $type: U16 },
    { $name: "LkgEfuseBitLSB"                 , $type: U8  },
    { $name: "LkgEfuseLength"                 , $type: U8  },
    { $name: "LkgEncodeLnMaxDivMin"           , $type: U32 },
    { $name: "LkgEncodeMax"                   , $type: U32 },
    { $name: "LkgEncodeMin"                   , $type: U32 },
    { $name: "RoFuse"                         , $type: vbios.EfuseLinearFuncParam },
    { $name: "EvvDefaultVddc"                 , $type: U32 },
    { $name: "EvvNoCalcVddc"                  , $type: U32 },
    { $name: "SpeedModel"                     , $type: U32 },
    { $name: "SMA"                            , $type: Arr, $ref: U32, $length: 8 }, // ulSM_A[0..7]
    { $name: "SMASign"                        , $type: Arr, $ref: U8 , $length: 8 }, // ucSM_A[0..7]_sign
    { $name: "MarginRoA"                      , $type: U32 },
    { $name: "MarginRoB"                      , $type: U32 },
    { $name: "MarginRoC"                      , $type: U32 },
    { $name: "MarginFixed"                    , $type: U32 },
    { $name: "MarginFMaxMean"                 , $type: U32 },
    { $name: "MarginPLatMean"                 , $type: U32 },
    { $name: "MarginFMaxSigma"                , $type: U32 },
    { $name: "MarginPLatSigma"                , $type: U32 },
    { $name: "MarginDCSigma"                  , $type: U32 },
    { $name: "Reserved1"                      , $type: Arr, $ref: U32, $length: 12 }
  ]
});

// Polars10/11 AVFS parameters.
vbios.$define({
  $extend: vbios.ASICProfilingInfo,
  $version: [3, 6],
  $members: [
    { $name: "MaxVddc"                        , $type: U32 }, // In [0.01mV] unit, maximum voltage for all parts.
    { $name: "MinVddc"                        , $type: U32 }, // In [0.01mV] unit, minimum voltage for all parts.
    { $name: "LkgEuseIndex"                   , $type: U16 },
    { $name: "LkgEfuseBitLSB"                 , $type: U8  },
    { $name: "LkgEfuseLength"                 , $type: U8  },
    { $name: "LkgEncodeLnMaxDivMin"           , $type: U32 },
    { $name: "LkgEncodeMax"                   , $type: U32 },
    { $name: "LkgEncodeMin"                   , $type: U32 },
    { $name: "RoFuse"                         , $type: vbios.EfuseLinearFuncParam },
    { $name: "EvvDefaultVddc"                 , $type: U32 },
    { $name: "EvvNoCalcVddc"                  , $type: U32 },
    { $name: "SpeedModel"                     , $type: U32 },
    { $name: "SMA"                            , $type: Arr, $ref: U32, $length: 8 }, // ulSM_A[0..7]
    { $name: "SMASign"                        , $type: Arr, $ref: U8 , $length: 8 }, // ucSM_A[0..7]_sign
    { $name: "MarginRoA"                      , $type: U32 },
    { $name: "MarginRoB"                      , $type: U32 },
    { $name: "MarginRoC"                      , $type: U32 },
    { $name: "MarginFixed"                    , $type: U32 },
    { $name: "MarginFMaxMean"                 , $type: U32 },
    { $name: "MarginPLatMean"                 , $type: U32 },
    { $name: "MarginFMaxSigma"                , $type: U32 },
    { $name: "MarginPLatSigma"                , $type: U32 },
    { $name: "MarginDCSigma"                  , $type: U32 },
    { $name: "LoadLineSlop"                   , $type: U32 },
    { $name: "TDCLimitPerDPM"                 , $type: Arr, $ref: U32, $length: 8 },
    { $name: "NoCalcVddcPerDPM"               , $type: Arr, $ref: U32, $length: 8 },
    { $name: "AVFSMeanNSigmaAcontant0"        , $type: U32 },
    { $name: "AVFSMeanNSigmaAcontant1"        , $type: U32 },
    { $name: "AVFSMeanNSigmaAcontant2"        , $type: U32 },
    { $name: "AVFSMeanNSigmaDCToLSigma"       , $type: U16 },
    { $name: "AVFSMeanNSigmaPlatformMean"     , $type: U16 },
    { $name: "AVFSMeanNSigmaPlatformSigma"    , $type: U16 },
    { $name: "GB_VDROOP_TABLE_CKSOFF_a0"      , $type: U32 },
    { $name: "GB_VDROOP_TABLE_CKSOFF_a1"      , $type: U32 },
    { $name: "GB_VDROOP_TABLE_CKSOFF_a2"      , $type: U32 },
    { $name: "GB_VDROOP_TABLE_CKSON_a0"       , $type: U32 },
    { $name: "GB_VDROOP_TABLE_CKSON_a1"       , $type: U32 },
    { $name: "GB_VDROOP_TABLE_CKSON_a2"       , $type: U32 },
    { $name: "AVFSGBFuseTableCKSOffM1"        , $type: U32 },
    { $name: "AVFSGBFuseTableCKSOffM2"        , $type: U16 },
    { $name: "AVFSGBFuseTableCKSOffB"         , $type: U32 },
    { $name: "AVFSGBFuseTableCKSOnM1"         , $type: U32 },
    { $name: "AVFSGBFuseTableCKSOnM2"         , $type: U16 },
    { $name: "AVFSGBFuseTableCKSOnB"          , $type: U32 },
    { $name: "MaxVoltage_0_25mv"              , $type: U16 }, // In [0.25mV] unit.
    { $name: "EnableGB_VDROOP_TABLE_CKSOFF"   , $type: U8  },
    { $name: "EnableGB_VDROOP_TABLE_CKSON"    , $type: U8  },
    { $name: "EnableGB_FUSE_TABLE_CKSOFF"     , $type: U8  },
    { $name: "EnableGB_FUSE_TABLE_CKSON"      , $type: U8  },
    { $name: "PSMAgeComFactor"                , $type: U16 },
    { $name: "EnableApplyAVFSCKSOFFVoltage"   , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  }
  ]
});

// ============================================================================
// [Service Information]
// ============================================================================

// ATOM_HOLE_INFO
vbios.$define({
  $name: "HoleInfo",
  $members: [
    { $name: "Offset"                         , $type: U16 }, // Offset of the hole (from the start of the binary).
    { $name: "Length"                         , $type: U16 }  // Length of the hole (in bytes).
  ]
});

// ATOM_SERVICE_INFO
// ATOM_SERVICE_DESCRIPTION
vbios.$define({
  $name: "ServiceInfo",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.ServiceInfo,
  $version: [1, 1],
  $members: [
    { $name: "RevisionId"                     , $type: U8  },
    { $name: "Algorithm"                      , $type: U8  },
    { $name: "SignatureType"                  , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "SignatureOffset"                , $type: U16 },
    { $name: "SignatureLength"                , $type: U16 },
    { $name: "NumHoles"                       , $type: U8  },
    { $name: "Holes"                          , $type: Arr, $ref: vbios.HoleInfo, $length: "NumHoles" }
  ]
});

// ============================================================================
// [PowerPlay]
// ============================================================================

// ATOM_PPLIB_CAC_Leakage_Record
vbios.$define({
  $name: "CACLeakageEntry",
  $members: [
    { $name: "Vddc1"                          , $type: U16 },
    { $name: "Vddc2"                          , $type: U16 },
    { $name: "Vddc3"                          , $type: U16 }
  ]
});

// ATOM_PPLIB_CAC_Leakage_Table
vbios.$define({
  $name: "CACLeakageTable",
  $members: [
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Entries"                        , $type: Arr, $ref: vbios.CACLeakageEntry, $length: "NumEntries" }
  ]
});

// ATOM_PPLIB_PhaseSheddingLimits_Record
vbios.$define({
  $name: "PhaseSheddingLimitsEntry",
  $members: [
    { $name: "usVoltage"                      , $type: U16 },
    { $name: "SocClockLow"                    , $type: U16 },
    { $name: "SocClockHigh"                   , $type: U8  },
    { $name: "MemClockLow"                    , $type: U16 },
    { $name: "MemClockHigh"                   , $type: U8  }
  ]
});

// ATOM_PPLIB_PhaseSheddingLimits_Table
vbios.$define({
  $name: "PhaseSheddingLimitsTable",
  $members: [
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Entries"                        , $type: Arr, $ref: vbios.PhaseSheddingLimitsEntry, $length: "NumEntries" }
  ]
});


vbios.$define({
  $name: "PowerTuneTable",
  $extend: vbios.CommonRevIdHeader
});

// ATOM_Tonga_PowerTune_Table
vbios.$define({
  $extend: vbios.PowerTuneTable,
  $version: [3],
  $members: [
    { $name: "TDP"                            , $type: U16 },
    { $name: "ConfigurableTDP"                , $type: U16 },
    { $name: "TDC"                            , $type: U16 },
    { $name: "BatteryPowerLimit"              , $type: U16 },
    { $name: "SmallPowerLimit"                , $type: U16 },
    { $name: "LowCACLeakage"                  , $type: U16 },
    { $name: "HighCACLeakage"                 , $type: U16 },
    { $name: "MaximumPowerDeliveryLimit"      , $type: U16 },
    { $name: "TjMax"                          , $type: U16 },
    { $name: "PowerTuneDataSetId"             , $type: U16 },
    { $name: "EDCLimit"                       , $type: U16 },
    { $name: "SoftwareShutdownTemp"           , $type: U16 },
    { $name: "ClockStretchAmount"             , $type: U16 },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "Reserved2"                      , $type: U16 }
  ]
});

// ATOM_Fiji_PowerTune_Table
vbios.$define({
  $extend: vbios.PowerTuneTable,
  $version: [4],
  $members: [
    { $name: "TDP"                            , $type: U16 },
    { $name: "ConfigurableTDP"                , $type: U16 },
    { $name: "TDC"                            , $type: U16 },
    { $name: "BatteryPowerLimit"              , $type: U16 },
    { $name: "SmallPowerLimit"                , $type: U16 },
    { $name: "LowCACLeakage"                  , $type: U16 },
    { $name: "HighCACLeakage"                 , $type: U16 },
    { $name: "MaximumPowerDeliveryLimit"      , $type: U16 },
    { $name: "TjMax"                          , $type: U16 },
    { $name: "PowerTuneDataSetId"             , $type: U16 },
    { $name: "EDCLimit"                       , $type: U16 },
    { $name: "SoftwareShutdownTemp"           , $type: U16 },
    { $name: "ClockStretchAmount"             , $type: U16 },
    { $name: "TemperatureLimitHotspot"        , $type: U16 },
    { $name: "TemperatureLimitLiquid1"        , $type: U16 },
    { $name: "TemperatureLimitLiquid2"        , $type: U16 },
    { $name: "TemperatureLimitVrVddc"         , $type: U16 },
    { $name: "TemperatureLimitVrMvdd"         , $type: U16 },
    { $name: "TemperatureLimitPlx"            , $type: U16 },
    { $name: "Liquid1I2CAddress"              , $type: U8  },
    { $name: "Liquid2I2CAddress"              , $type: U8  },
    { $name: "LiquidI2CLine"                  , $type: U8  },
    { $name: "VrI2CAddress"                   , $type: U8  },
    { $name: "VrI2CLine"                      , $type: U8  },
    { $name: "PlxI2CAddress"                  , $type: U8  },
    { $name: "PlxI2CLine"                     , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

// ATOM_Vega10_PowerTune_Table
vbios.$define({
  $extend: vbios.PowerTuneTable,
  $version: [5],
  $members: [
    { $name: "SocketPowerLimit"               , $type: U16 },
    { $name: "BatteryPowerLimit"              , $type: U16 },
    { $name: "SmallPowerLimit"                , $type: U16 },
    { $name: "TDCLimit"                       , $type: U16 },
    { $name: "EDCLimit"                       , $type: U16 },
    { $name: "SoftwareShutdownTemp"           , $type: U16 },
    { $name: "TemperatureLimitHotSpot"        , $type: U16 },
    { $name: "TemperatureLimitLiquid1"        , $type: U16 },
    { $name: "TemperatureLimitLiquid2"        , $type: U16 },
    { $name: "TemperatureLimitHBM"            , $type: U16 },
    { $name: "TemperatureLimitVrSoc"          , $type: U16 },
    { $name: "TemperatureLimitVrMem"          , $type: U16 },
    { $name: "TemperatureLimitPlx"            , $type: U16 },
    { $name: "LoadLineResistance"             , $type: U16 },
    { $name: "Liquid1I2CAddress"              , $type: U8  },
    { $name: "Liquid2I2CAddress"              , $type: U8  },
    { $name: "VrI2CAddress"                   , $type: U8  },
    { $name: "PlxI2CAddress"                  , $type: U8  },
    { $name: "LiquidI2CLineSCL"               , $type: U8  },
    { $name: "LiquidI2CLineSDA"               , $type: U8  },
    { $name: "VrI2CLineSCL"                   , $type: U8  },
    { $name: "VrI2CLineSDA"                   , $type: U8  },
    { $name: "PlxI2CLineSCL"                  , $type: U8  },
    { $name: "PlxI2CLineSDA"                  , $type: U8  },
    { $name: "TemperatureLimitTedge"          , $type: U16 }
  ]
});

// ATOM_Vega10_PowerTune_Table_V2
vbios.$define({
  $extend: vbios.PowerTuneTable,
  $version: [6],
  $members: [
    { $name: "SocketPowerLimit"               , $type: U16 },
    { $name: "BatteryPowerLimit"              , $type: U16 },
    { $name: "SmallPowerLimit"                , $type: U16 },
    { $name: "TDCLimit"                       , $type: U16 },
    { $name: "EDCLimit"                       , $type: U16 },
    { $name: "SoftwareShutdownTemp"           , $type: U16 },
    { $name: "TemperatureLimitHotSpot"        , $type: U16 },
    { $name: "TemperatureLimitLiquid1"        , $type: U16 },
    { $name: "TemperatureLimitLiquid2"        , $type: U16 },
    { $name: "TemperatureLimitHBM"            , $type: U16 },
    { $name: "TemperatureLimitVrSoc"          , $type: U16 },
    { $name: "TemperatureLimitVrMem"          , $type: U16 },
    { $name: "TemperatureLimitPlx"            , $type: U16 },
    { $name: "LoadLineResistance"             , $type: U16 },
    { $name: "Liquid1I2CAddress"              , $type: U8  },
    { $name: "Liquid2I2CAddress"              , $type: U8  },
    { $name: "LiquidI2CLine"                  , $type: U8  },
    { $name: "VrI2CAddress"                   , $type: U8  },
    { $name: "VrI2CLine"                      , $type: U8  },
    { $name: "PlxI2CAddress"                  , $type: U8  },
    { $name: "PlxI2CLine"                     , $type: U8  },
    { $name: "TemperatureLimitTedge"          , $type: U16 }
  ]
});

// ATOM_Vega10_PowerTune_Table_V3
vbios.$define({
  $extend: vbios.PowerTuneTable$6,
  $version: [7],
  $members: [
    { $name: "BoostStartTemperature"          , $type: U16 },
    { $name: "BoostStopTemperature"           , $type: U16 },
    { $name: "BoostClock"                     , $type: U32 },
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 }
  ]
});

vbios.$define({
  $name: "PPMTable",
  $extend: vbios.CommonRevIdHeader
});

vbios.$define({
  $extend: vbios.PPMTable,
  $version: [52],
  $members: [
    { $name: "PPMDesign"                      , $type: U8  },
    { $name: "CPUCoreNumber"                  , $type: U16 },
    { $name: "PlatformTDP"                    , $type: U32 },
    { $name: "SmallACPPlatformTDP"            , $type: U32 },
    { $name: "PlatformTDC"                    , $type: U32 },
    { $name: "SmallACPPlatformTDC"            , $type: U32 },
    { $name: "APUTDP"                         , $type: U32 },
    { $name: "DGPUTDP"                        , $type: U32 },
    { $name: "DGPUULVPower"                   , $type: U32 },
    { $name: "TjMax"                          , $type: U32 }
  ]
});

vbios.$define({
  $name: "FanTable",
  $extend: vbios.CommonRevIdHeader
});

// ATOM_PPLIB_FANTABLE
vbios.$define({
  $extend: vbios.FanTable,
  $version: [1],
  $members: [
    { $name: "THyst"                          , $type: U8  }, // Temperature hysteresis.
    { $name: "TMin"                           , $type: U16 }, // The temperature, in 0.01 centigrades, below which we just run at a minimal PWM.
    { $name: "TMed"                           , $type: U16 }, // The middle temperature where we change slopes.
    { $name: "THigh"                          , $type: U16 }, // The high point above TMed for adjusting the second slope.
    { $name: "PWMMin"                         , $type: U16 }, // The minimum PWM value in percent (0.01% increments).
    { $name: "PWMMed"                         , $type: U16 }, // The PWM value (in percent) at TMed.
    { $name: "PWMHigh"                        , $type: U16 }  // The PWM value at THigh.
  ]
});

// ATOM_PPLIB_FANTABLE2
vbios.$define({
  $extend: vbios.FanTable$1,
  $version: [2],
  $members: [
    { $name: "TMax"                           , $type: U16 }  // The max temperature.
  ]
});

// ATOM_PPLIB_FANTABLE3
vbios.$define({
  $extend: vbios.FanTable$2,
  $version: [3],
  $members: [
    { $name: "FanControlMode"                 , $type: U8  }, // Legacy or Fuzzy Fan mode.
    { $name: "FanPWMMax"                      , $type: U16 }, // Maximum allowed fan power in percent.
    { $name: "FanOutputSensitivity"           , $type: U16 }  // Sensitivity of fan reaction to temepature changes.
  ]
});

// ATOM_PPLIB_FANTABLE4
vbios.$define({
  $extend: vbios.FanTable$3,
  $version: [4],
  $members: [
    { $name: "FanRPMMax"                      , $type: U16 }  // The default value in RPM.
  ]
});

// ATOM_PPLIB_FANTABLE5
vbios.$define({
  $extend: vbios.FanTable$4,
  $version: [5],
  $members: [
    { $name: "FanCurrentLow"                  , $type: U16 },
    { $name: "FanCurrentHigh"                 , $type: U16 },
    { $name: "FanRPMLow"                      , $type: U16 },
    { $name: "FanRPMHigh"                     , $type: U16 }
  ]
});

// ATOM_Tonga_Fan_Table
vbios.$define({
  $extend: vbios.FanTable$4,
  $version: [9],
  $members: [
    { $name: "MinFanSocClockAcousticLimit"    , $type: U32 }, // Minimum fan controller SOC clock frequency acoustic limit.
    { $name: "TargetTemperature"              , $type: U8  }, // Advanced fan controller target temperature.
    { $name: "MinimumPWMLimit"                , $type: U8  }, // The minimum PWM that the advanced fan controller can set.  This should be set to the highest PWM that will run the fan at its lowest RPM.
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

// ATOM_Vega10_Fan_Table
vbios.$define({
  $extend: vbios.FanTable,
  $version: [10],
  $members: [
    { $name: "FanOutputSensitivity"           , $type: U16 }, // Sensitivity of fan reaction to temepature changes.
    { $name: "FanRPMMax"                      , $type: U16 }, // The default value, in RMP.
    { $name: "ThrottlingRPM"                  , $type: U16 },
    { $name: "FanAcousticLimit"               , $type: U16 }, // Minimum Fan Controller Frequency Acoustic Limit.
    { $name: "TargetTemperature"              , $type: U16 }, // The default ideal temperature in Celcius.
    { $name: "MinimumPWMLimit"                , $type: U16 }, // The minimum PWM that the advanced fan controller can set.
    { $name: "TargetGfxClock"                 , $type: U16 }, // The ideal Fan Controller GFXCLK Frequency Acoustic Limit.
    { $name: "FanGainEdge"                    , $type: U16 },
    { $name: "FanGainHotspot"                 , $type: U16 },
    { $name: "FanGainLiquid"                  , $type: U16 },
    { $name: "FanGainVrVddc"                  , $type: U16 },
    { $name: "FanGainVrMvdd"                  , $type: U16 },
    { $name: "FanGainPPX"                     , $type: U16 },
    { $name: "FanGainHBM"                     , $type: U16 },
    { $name: "EnableZeroRPM"                  , $type: U8  },
    { $name: "FanStopTemperature"             , $type: U16 },
    { $name: "FanStartTemperature"            , $type: U16 },
  ]
});

// ATOM_Vega10_Fan_Table_V2
vbios.$define({
  $extend: vbios.FanTable,
  $version: [11],
  $members: [
    { $name: "FanOutputSensitivity"           , $type: U16 },
    { $name: "FanAcousticLimitRPM"            , $type: U16 },
    { $name: "ThrottlingRPM"                  , $type: U16 },
    { $name: "TargetTemperature"              , $type: U16 },
    { $name: "MinimumPWMLimit"                , $type: U16 },
    { $name: "TargetGfxClock"                 , $type: U16 },
    { $name: "FanGainEdge"                    , $type: U16 },
    { $name: "FanGainHotspot"                 , $type: U16 },
    { $name: "FanGainLiquid"                  , $type: U16 },
    { $name: "FanGainVrVddc"                  , $type: U16 },
    { $name: "FanGainVrMvdd"                  , $type: U16 },
    { $name: "FanGainPPX"                     , $type: U16 },
    { $name: "FanGainHBM"                     , $type: U16 },
    { $name: "EnableZeroRPM"                  , $type: U8  },
    { $name: "FanStopTemperature"             , $type: U16 },
    { $name: "FanStartTemperature"            , $type: U16 },
    { $name: "FanParameters"                  , $type: U8  },
    { $name: "FanMinRPM"                      , $type: U8  },
    { $name: "FanMaxRPM"                      , $type: U8  }
  ]
});

vbios.$define({
  $name: "GPIOTable",
  $extend: vbios.CommonRevIdHeader
});

vbios.$define({
  $extend: vbios.GPIOTable,
  $version: [0],
  $members: [
    { $name: "VRHotTriggeredSocClockDPMIndex" , $type: U8  }, // If VRHot signal is triggered SOC clock will be limited to this DPM level.
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Reserved2"                      , $type: U8  },
    { $name: "Reserved3"                      , $type: U8  },
    { $name: "Reserved4"                      , $type: U8  },
    { $name: "Reserved5"                      , $type: U8  }
  ]
});

// ATOM_PPLIB_THERMALCONTROLLER
//   - Used by old PPTable, it's the same as ThermalController, but has no header.
vbios.$define({
  $name: "ThermalControllerNoHeader",
  $members: [
    { $name: "ControlType"                    , $type: U8  },
    { $name: "I2CLine"                        , $type: U8  }, // As interpreted by DAL I2C.
    { $name: "I2CAddress"                     , $type: U8  },
    { $name: "FanParameters"                  , $type: U8  },
    { $name: "FanMinRPM"                      , $type: U8  }, // Minimum RPM (hundreds).
    { $name: "FanMaxRPM"                      , $type: U8  }, // Maximum RPM (hundreds).
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Flags"                          , $type: U8  }
  ]
});

vbios.$define({
  $name: "ThermalController",
  $extend: vbios.CommonRevIdHeader
});

// ATOM_Tonga_Thermal_Controller
vbios.$define({
  $extend: vbios.ThermalController,
  $version: [1],
  $members: [
    { $name: "ControlType"                    , $type: U8  },
    { $name: "I2CLine"                        , $type: U8  }, // As interpreted by DAL I2C.
    { $name: "I2CAddress"                     , $type: U8  },
    { $name: "FanParameters"                  , $type: U8  },
    { $name: "FanMinRPM"                      , $type: U8  }, // Minimum RPM (hundreds), for display purposes only.
    { $name: "FanMaxRPM"                      , $type: U8  }, // Maximum RPM (hundreds), for display purposes only.
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Flags"                          , $type: U8  }
  ]
});

// ATOM_Vega10_Thermal_Controller
vbios.$define({
  $extend: vbios.ThermalController,
  $version: [2],
  $members: [
    { $name: "ControlType"                    , $type: U8  },
    { $name: "I2CLine"                        , $type: U8  }, // As interpreted by DAL I2C.
    { $name: "I2CAddress"                     , $type: U8  },
    { $name: "FanParameters"                  , $type: U8  },
    { $name: "FanMinRPM"                      , $type: U8  }, // Minimum RPM (hundreds), for display purposes only.
    { $name: "FanMaxRPM"                      , $type: U8  }, // Maximum RPM (hundreds), for display purposes only
    { $name: "Flags"                          , $type: U8  }
  ]
});

// ATOM_Tonga_State
vbios.$define({
  $name: "StateEntry",
  $version: [1],
  $members: [
    { $name: "SocClockIndexHigh"              , $type: U8  },
    { $name: "SocClockIndexLow"               , $type: U8  },
    { $name: "MemClockIndexHigh"              , $type: U8  },
    { $name: "MemClockIndexLow"               , $type: U8  },
    { $name: "PCIEGenLow"                     , $type: U8  },
    { $name: "PCIEGenHigh"                    , $type: U8  },
    { $name: "PCIELaneLow"                    , $type: U8  },
    { $name: "PCIELaneHigh"                   , $type: U8  },
    { $name: "Classification"                 , $type: U16 },
    { $name: "CapsAndSettings"                , $type: U32 },
    { $name: "Classification2"                , $type: U16 },
    { $name: "Reserved1"                      , $type: U32 }
  ]
});

// ATOM_Vega10_State
vbios.$define({
  $name: "StateEntry",
  $version: [2],
  $members: [
    { $name: "SocClockIndexHigh"              , $type: U8  },
    { $name: "SocClockIndexLow"               , $type: U8  },
    { $name: "GfxClockIndexHigh"              , $type: U8  },
    { $name: "GfxClockIndexLow"               , $type: U8  },
    { $name: "MemClockIndexHigh"              , $type: U8  },
    { $name: "MemClockIndexLow"               , $type: U8  },
    { $name: "Classification"                 , $type: U16 },
    { $name: "CapsAndSettings"                , $type: U32 },
    { $name: "Classification2"                , $type: U16 }
  ]
});

vbios.$define({
  $name: "StateTable",
  $extend: vbios.CommonArrayHeader
});

vbios.$define({
  $extend: vbios.StateTable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.StateEntry$1, $length: "NumEntries" }
  ]
});

vbios.$define({
  $extend: vbios.StateTable,
  $version: [2],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.StateEntry$2, $length: "NumEntries" }
  ]
});

// ATOM_Tonga_SCLK_Dependency_Record
vbios.$define({
  $name: "SocClockDependencyEntry",
  $version: [0],
  $members: [
    { $name: "VddIndex"                       , $type: U8  }, // Base voltage.
    { $name: "VddcOffset"                     , $type: I16 }, // Offset relative to base voltage.
    { $name: "SocClock"                       , $type: U32 },
    { $name: "EDCCurrent"                     , $type: U16 },
    { $name: "ReliabilityTemperature"         , $type: U8  },
    { $name: "CKSOffsetAndDisable"            , $type: U8  }  // Bits 0~6: Voltage offset for CKS, Bit 7: Disable/enable for the SOC clock level.
  ]
});

// ATOM_Polaris_SCLK_Dependency_Record
vbios.$define({
  $name: "SocClockDependencyEntry",
  $version: [1],
  $members: [
    { $name: "Vddc"                           , $type: U8  }, // Base voltage.
    { $name: "VddcOffset"                     , $type: I16 }, // Offset relative to base voltage.
    { $name: "SocClock"                       , $type: U32 },
    { $name: "EDCCurrent"                     , $type: U16 },
    { $name: "ReliabilityTemperature"         , $type: U8  },
    { $name: "CKSOffsetAndDisable"            , $type: U8  }, // Bits 0~6: Voltage offset for CKS, Bit 7: Disable/enable for the SOC clock level.
    { $name: "SocClockOffset"                 , $type: I32 }
  ]
});

// ATOM_Vega10_CLK_Dependency_Record
vbios.$define({
  $name: "SocClockDependencyEntry",
  $version: [2],
  $members: [
    { $name: "Clock"                           , $type: U32 },
    { $name: "VddIndex"                        , $type: U8  }
  ]
});

vbios.$define({
  $name: "SocClockDependencyTable",
  $extend: vbios.CommonArrayHeader
});

// ATOM_Tonga_SCLK_Dependency_Table
vbios.$define({
  $extend: vbios.SocClockDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.SocClockDependencyEntry$0, $length: "NumEntries" }
  ]
});

// ATOM_Polaris_SCLK_Dependency_Table
vbios.$define({
  $extend: vbios.SocClockDependencyTable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.SocClockDependencyEntry$1, $length: "NumEntries" }
  ]
});

// ATOM_Vega10_SOCCLK_Dependency_Table
vbios.$define({
  $extend: vbios.SocClockDependencyTable,
  $version: [2],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.SocClockDependencyEntry$2, $length: "NumEntries" }
  ]
});

// ATOM_Tonga_MCLK_Dependency_Record
vbios.$define({
  $name: "MemClockDependencyEntry",
  $version: [0],
  $members: [
    { $name: "Vddc"                           , $type: U8  },
    { $name: "Vddci"                          , $type: U16 },
    { $name: "VddcGfxOffset"                  , $type: I16 }, // Offset relative to Vddc voltage.
    { $name: "Mvdd"                           , $type: U16 },
    { $name: "MemClock"                       , $type: U32 },
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

// ATOM_Vega10_MCLK_Dependency_Record
vbios.$define({
  $name: "MemClockDependencyEntry",
  $version: [1],
  $members: [
    { $name: "MemClock"                       , $type: U32 },
    { $name: "VddIndex"                       , $type: U8  },
    { $name: "VddMemIndex"                    , $type: U8  },
    { $name: "VddciIndex"                     , $type: U8  }
  ]
});

vbios.$define({
  $name: "MemClockDependencyTable",
  $extend: vbios.CommonArrayHeader
});

// ATOM_Tonga_MCLK_Dependency_Table
vbios.$define({
  $extend: vbios.MemClockDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.MemClockDependencyEntry$0, $length: "NumEntries" }
  ]
});

// ATOM_Vega10_MCLK_Dependency_Table
vbios.$define({
  $extend: vbios.MemClockDependencyTable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.MemClockDependencyEntry$1, $length: "NumEntries" }
  ]
});
// ATOM_Vega10_GFXCLK_Dependency_Record
vbios.$define({
  $name: "GfxClockDependencyEntry",
  $version: [0],
  $members: [
    { $name: "Clock"                          , $type: U32 },
    { $name: "VddIndex"                       , $type: U8  },
    { $name: "CKSVOffsetAndDisable"           , $type: U16 },
    { $name: "AVFSOffset"                     , $type: U16 },
    { $name: "ACGEnable"                      , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 }
  ]
});

vbios.$define({
  $name: "GfxClockDependencyTable",
  $extend: vbios.CommonArrayHeader
});

// ATOM_Vega10_GFXCLK_Dependency_Table
vbios.$define({
  $extend: vbios.GfxClockDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.GfxClockDependencyEntry$0, $length: "NumEntries" }
  ]
});

// ATOM_Vega10_CLK_Dependency_Record
vbios.$define({
  $name: "DcefClockDependencyEntry",
  $version: [0],
  $members: [
    { $name: "Clock"                           , $type: U32 },
    { $name: "VddIndex"                        , $type: U8  }  // Base voltage.
  ]
});

vbios.$define({
  $name: "DcefClockDependencyTable",
  $extend: vbios.CommonArrayHeader
});

// ATOM_Vega10_DCEFCLK_Dependency_Table
vbios.$define({
  $extend: vbios.DcefClockDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.DcefClockDependencyEntry$0, $length: "NumEntries" }
  ]
});

// ATOM_Vega10_CLK_Dependency_Record
vbios.$define({
  $name: "PixClockDependencyEntry",
  $version: [0],
  $members: [
    { $name: "Clock"                           , $type: U32 },
    { $name: "VddIndex"                        , $type: U8  }  // Base voltage.
  ]
});

vbios.$define({
  $name: "PixClockDependencyTable",
  $extend: vbios.CommonArrayHeader
});

// ATOM_Vega10_PIXCLK_Dependency_Table
vbios.$define({
  $extend: vbios.PixClockDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.PixClockDependencyEntry$0, $length: "NumEntries" }
  ]
});

// ATOM_Vega10_CLK_Dependency_Record
vbios.$define({
  $name: "DispClockDependencyEntry",
  $version: [0],
  $members: [
    { $name: "Clock"                           , $type: U32 },
    { $name: "VddIndex"                        , $type: U8  }  // Base voltage.
  ]
});

vbios.$define({
  $name: "DispClockDependencyTable",
  $extend: vbios.CommonArrayHeader
});

// ATOM_Vega10_DISPCLK_Dependency_Table
vbios.$define({
  $extend: vbios.DispClockDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.DispClockDependencyEntry$0, $length: "NumEntries" }
  ]
});

// ATOM_Vega10_CLK_Dependency_Record
vbios.$define({
  $name: "PhyClockDependencyEntry",
  $version: [0],
  $members: [
    { $name: "Clock"                           , $type: U32 },
    { $name: "VddIndex"                        , $type: U8  }  // Base voltage.
  ]
});

vbios.$define({
  $name: "PhyClockDependencyTable",
  $extend: vbios.CommonArrayHeader
});

// ATOM_Vega10_PHYCLK_Dependency_Table
vbios.$define({
  $extend: vbios.PhyClockDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.PhyClockDependencyEntry$0, $length: "NumEntries" }
  ]
});

vbios.$define({
  $name: "VoltageLookupEntry",
  $version: [0],
  $members: [
    { $name: "Vdd"                            , $type: U16 }, // Base voltage.
    { $name: "CACLow"                         , $type: U16 },
    { $name: "CACMid"                         , $type: U16 },
    { $name: "CACHigh"                        , $type: U16 }
  ]
});

vbios.$define({
  $name: "VoltageLookupTable",
  $extend: vbios.CommonArrayHeader
});

vbios.$define({
  $extend: vbios.VoltageLookupTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.VoltageLookupEntry$0, $length: "NumEntries" }
  ]
});

vbios.$define({
  $name: "MMDependencyEntry",
  $version: [0],
  $members: [
    { $name: "Vddc"                           , $type: U8  }, // Vddc voltage.
    { $name: "VddcGfxOffset"                  , $type: I16 }, // Offset relative to Vddc voltage.
    { $name: "DCLK"                           , $type: U32 }, // UVD D-clock.
    { $name: "VCLK"                           , $type: U32 }, // UVD V-clock.
    { $name: "ECLK"                           , $type: U32 }, // VCE clock.
    { $name: "ACLK"                           , $type: U32 }, // ACP clock.
    { $name: "SAMUCLK"                        , $type: U32 }  // SAMU clock.
  ]
});

vbios.$define({
  $name: "MMDependencyTable",
  $extend: vbios.CommonArrayHeader
});

vbios.$define({
  $extend: vbios.MMDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.MMDependencyEntry$0, $length: "NumEntries" }
  ]
});

// ATOM_Tonga_VCE_State_Record
// ATOM_Vega10_VCE_State_Record
vbios.$define({
  $name: "VCEStateEntry",
  $version: [1],
  $members: [
    { $name: "VCEClockIndex"                  , $type: U8  }, // Index into 'VCEDependencyTableOffset' of 'MMDependencyTable'.
    { $name: "Flag"                           , $type: U8  }, // 2 bits indicates memory p-states.
    { $name: "SocClockIndex"                  , $type: U8  }, // Index into 'SocClockDependencyTable'.
    { $name: "MemClockIndex"                  , $type: U8  }  // Index into 'MemClockDependencyTable'.
  ]
});

vbios.$define({
  $name: "VCEStateTable",
  $extend: vbios.CommonArrayHeader
});

// ATOM_Tonga_VCE_State_Table
// ATOM_Vega10_VCE_State_Table
vbios.$define({
  $extend: vbios.VCEStateTable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.VCEStateEntry$1, $length: "NumEntries" }
  ]
});

// ATOM_Tonga_Hard_Limit_Record
vbios.$define({
  $name: "HardLimitEntry",
  $version: [52],
  $members: [
    { $name: "SocClockLimit"                  , $type: U32 },
    { $name: "MemClockLimit"                  , $type: U32 },
    { $name: "VddcLimit"                      , $type: U16 },
    { $name: "VddciLimit"                     , $type: U16 },
    { $name: "VddGfxLimit"                    , $type: U16 }
  ]
});

// ATOM_Vega10_Hard_Limit_Record
vbios.$define({
  $name: "HardLimitEntry",
  $version: [TODO_REVISION],
  $members: [
    { $name: "SocClockLimit"                  , $type: U32 },
    { $name: "GfxClockLimit"                  , $type: U32 },
    { $name: "MemClockLimit"                  , $type: U32 },
    { $name: "VddcLimit"                      , $type: U16 },
    { $name: "VddciLimit"                     , $type: U16 },
    { $name: "VddMemLimit"                    , $type: U16 }
  ]
});

vbios.$define({
  $name: "HardLimitTable",
  $extend: vbios.CommonArrayHeader
});

vbios.$define({
  $extend: vbios.HardLimitTable,
  $version: [52],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.HardLimitEntry$52, $length: "NumEntries" }
  ]
});

vbios.$define({
  $name: "PCIEEntry",
  $version: [0],
  $members: [
    { $name: "PCIEGenSpeed"                   , $type: U8  },
    { $name: "PCIELaneWidth"                  , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

vbios.$define({
  $name: "PCIEEntry",
  $version: [1],
  $members: [
    { $name: "PCIEGenSpeed"                   , $type: U8  },
    { $name: "PCIELaneWidth"                  , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "PCIEClock"                      , $type: U32 }
  ]
});

vbios.$define({
  $name: "PCIETable",
  $extend: vbios.CommonArrayHeader
});

vbios.$define({
  $extend: vbios.PCIETable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.PCIEEntry$0, $length: "NumEntries" }
  ]
});

vbios.$define({
  $extend: vbios.PCIETable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: vbios.PCIEEntry$1, $length: "NumEntries" }
  ]
});

// ATOM_PPLIB_EXTENDEDHEADER
//   - Only used by PowerPlay v6 and less.
vbios.$define({
  $name: "PowerPlayExtendedTable",
  $members: [
    { $name: "Size"                           , $type: U16 },
    { $name: "MaxSocClock"                    , $type: U32 },
    { $name: "MaxMemClock"                    , $type: U32 },
    { $name: "VCETable"                       , $type: U16 },
    { $name: "UVDTable"                       , $type: U16 },
    { $name: "SAMUTable"                      , $type: U16 },
    { $name: "PPMTable"                       , $type: U16 },
    { $name: "ACPTable"                       , $type: U16 },
    { $name: "PowerTuneTable"                 , $type: U16 },
    { $name: "SocClockDependencyTable"        , $type: U16 },
    { $name: "VQBudgetingTable"               , $type: U16 }
  ]
});

vbios.$define({
  $name: "PowerPlayTable",
  $flags: FLAGS.ISOLATE,
  $extend: vbios.CommonTableHeader,
  $verInfo: ["TableFormatRevision"]
});

// ATOM_PPLIB_POWERPLAYTABLE
vbios.$define({
  $extend: vbios.PowerPlayTable,
  $version: [1],
  $members: [
    { $name: "RevisionId"                     , $type: U8  },
    { $name: "NumStates"                      , $type: U8  },
    { $name: "StateEntrySize"                 , $type: U8  },
    { $name: "ClockInfoSize"                  , $type: U8  },
    { $name: "NonClockSize"                   , $type: U8  },
    { $name: "StateTable"                     , $type: U16, $ref: vbios.StateTable },
    { $name: "ClockInfoTable"                 , $type: U16, $ref: TODO_UNDEFINED },
    { $name: "NonClockInfoTable"              , $type: U16, $ref: TODO_UNDEFINED },
    { $name: "BackBiasTime"                   , $type: U16 },
    { $name: "VoltageTime"                    , $type: U16 },
    { $name: "TableSize"                      , $type: U16 },
    { $name: "PlatformCaps"                   , $type: U32 },
    { $name: "ThermalController"              , $type: vbios.ThermalControllerNoHeader },
    { $name: "BootClockTable"                 , $type: U16, $ref: TODO_UNDEFINED },
    { $name: "BootNonClockTable"              , $type: U16, $ref: TODO_UNDEFINED }
  ]
});

// ATOM_PPLIB_POWERPLAYTABLE2
vbios.$define({
  $extend: vbios.PowerPlayTable$1,
  $version: [2],
  $members: [
    { $name: "NumCustomThermalPolicyEntries"  , $type: U8  },
    { $name: "CustomThermalPolicy"            , $type: U16, $ref: TODO_UNDEFINED }
  ]
});

// ATOM_PPLIB_POWERPLAYTABLE3
vbios.$define({
  $extend: vbios.PowerPlayTable$2,
  $version: [3],
  $members: [
    { $name: "FormatId"                       , $type: U16 },
    { $name: "FanTable"                       , $type: U16, $ref: vbios.FanTable },
    { $name: "ExtendedHeader"                 , $type: U16, $ref: vbios.PowerPlayExtendedTable }
  ]
});

// ATOM_PPLIB_POWERPLAYTABLE4
vbios.$define({
  $extend: vbios.PowerPlayTable$3,
  $version: [4],
  $members: [
    { $name: "GoldenPPId"                     , $type: U32 },
    { $name: "GoldenRevision"                 , $type: U32 },
    { $name: "VddcDependencyOnSCLK"           , $type: U16, $ref: TODO_UNDEFINED },
    { $name: "VddciDependencyOnMCLK"          , $type: U16, $ref: TODO_UNDEFINED },
    { $name: "VddcDependencyOnMCLK"           , $type: U16, $ref: TODO_UNDEFINED },
    { $name: "MaxClockVoltageOnDC"            , $type: U16, $ref: TODO_UNDEFINED },
    { $name: "VddcPhaseSheddingLimitsTable"   , $type: U16, $ref: vbios.PhaseSheddingLimitsTable },
    { $name: "MvddDependencyOnMCLK"           , $type: U16, $ref: TODO_UNDEFINED }
  ]
});

// ATOM_PPLIB_POWERPLAYTABLE5
vbios.$define({
  $extend: vbios.PowerPlayTable$4,
  $version: [5],
  $members: [
    { $name: "TDPLimit"                       , $type: U32 },
    { $name: "NearTDPLimit"                   , $type: U32 },
    { $name: "SQRampingThreshold"             , $type: U32 },
    { $name: "CACLeakageTable"                , $type: U16, $ref: vbios.CACLeakageTable },
    { $name: "CACLeakage"                     , $type: U32 },
    { $name: "TDPODLimit"                     , $type: U16 },
    { $name: "LoadLineSlope"                  , $type: U16 }  // In [mohm * 100].
  ]
});

// _ATOM_Tonga_POWERPLAYTABLE
vbios.$define({
  $extend: vbios.PowerPlayTable,
  $version: [7],
  $members: [
    { $name: "RevisionId"                     , $type: U8  },
    { $name: "TableSize"                      , $type: U16 },
    { $name: "GoldenPPId"                     , $type: U32 },
    { $name: "GoldenRevision"                 , $type: U32 },
    { $name: "FormatId"                       , $type: U16 },
    { $name: "VoltageTime"                    , $type: U16 }, // In [ms].
    { $name: "PlatformCaps"                   , $type: U32 },
    { $name: "SocClockMaxOD"                  , $type: U32 },
    { $name: "MemClockMaxOD"                  , $type: U32 },
    { $name: "PowerControlLimit"              , $type: U16 },
    { $name: "UlvVoltageOffset"               , $type: U16 }, // In [mV] unit.
    { $name: "StateTable"                     , $type: U16 , $ref: vbios.StateTable               },
    { $name: "FanTable"                       , $type: U16 , $ref: vbios.FanTable                 },
    { $name: "ThermalController"              , $type: U16 , $ref: vbios.ThermalController        },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "MemClockDependencyTable"        , $type: U16 , $ref: vbios.MemClockDependencyTable  },
    { $name: "SocClockDependencyTable"        , $type: U16 , $ref: vbios.SocClockDependencyTable  },
    { $name: "VddcLookupTable"                , $type: U16 , $ref: vbios.VoltageLookupTable       },
    { $name: "VddGfxLookupTable"              , $type: U16 , $ref: vbios.VoltageLookupTable       },
    { $name: "MMDependencyTable"              , $type: U16 , $ref: vbios.MMDependencyTable        },
    { $name: "VCEStateTable"                  , $type: U16 , $ref: vbios.VCEStateTable            },
    { $name: "PPMTable"                       , $type: U16 , $ref: vbios.PPMTable                 },
    { $name: "PowerTuneTable"                 , $type: U16 , $ref: vbios.PowerTuneTable           },
    { $name: "HardLimitTable"                 , $type: U16 , $ref: vbios.HardLimitTable           },
    { $name: "PCIETable"                      , $type: U16 , $ref: vbios.PCIETable                },
    { $name: "GPIOTable"                      , $type: U16 , $ref: vbios.GPIOTable                },
    { $name: "Reserved2"                      , $type: U16 },
    { $name: "Reserved3"                      , $type: U16 },
    { $name: "Reserved4"                      , $type: U16 },
    { $name: "Reserved5"                      , $type: U16 },
    { $name: "Reserved6"                      , $type: U16 },
    { $name: "Reserved7"                      , $type: U16 }
  ]
});

// ATOM_Vega10_POWERPLAYTABLE
vbios.$define({
  $extend: vbios.PowerPlayTable,
  $version: [8],
  $members: [
    { $name: "RevisionId"                     , $type: U8  },
    { $name: "TableSize"                      , $type: U16 },
    { $name: "GoldenPPId"                     , $type: U32 },
    { $name: "GoldenRevision"                 , $type: U32 },
    { $name: "FormatId"                       , $type: U16 },
    { $name: "PlatformCaps"                   , $type: U32 },
    { $name: "SocClockMaxOD"                  , $type: U32 },
    { $name: "MemClockMaxOD"                  , $type: U32 },
    { $name: "PowerControlLimit"              , $type: U16 },
    { $name: "UlvVoltageOffset"               , $type: U16 }, // In [mV] unit.

    { $name: "UlvSmnClockDid"                 , $type: U16 },
    { $name: "UlvMp1ClockDid"                 , $type: U16 },
    { $name: "UlvGfxClockBypass"              , $type: U16 },
    { $name: "GfxClockSlewRate"               , $type: U16 },

    { $name: "GfxVoltageMode"                 , $type: U8 },
    { $name: "SocVoltageMode"                 , $type: U8 },
    { $name: "UCLKVoltageMode"                , $type: U8 },
    { $name: "UVDVoltageMode"                 , $type: U8 },
    { $name: "VCEVoltageMode"                 , $type: U8 },
    { $name: "Mp0VoltageMode"                 , $type: U8 },
    { $name: "DCEFVoltageMode"                , $type: U8 },

    { $name: "StateTable"                     , $type: U16 , $ref: vbios.StateTable               },
    { $name: "FanTable"                       , $type: U16 , $ref: vbios.FanTable                 },
    { $name: "ThermalController"              , $type: U16 , $ref: vbios.ThermalController        },
    { $name: "SocClockDependencyTable"        , $type: U16 , $ref: vbios.SocClockDependencyTable  },
    { $name: "MemClockDependencyTable"        , $type: U16 , $ref: vbios.MemClockDependencyTable  },
    { $name: "GfxClockDependencyTable"        , $type: U16 , $ref: vbios.GfxClockDependencyTable  },
    { $name: "DcefClockDependencyTable"       , $type: U16 , $ref: vbios.DcefClockDependencyTable },
    { $name: "VddcLookupTable"                , $type: U16 , $ref: vbios.VoltageLookupTable       },
    { $name: "VddMemLookupTable"              , $type: U16 , $ref: vbios.VoltageLookupTable       },
    { $name: "MMDependencyTable"              , $type: U16 , $ref: vbios.MMDependencyTable        },
    { $name: "VCEStateTable"                  , $type: U16 , $ref: vbios.VCEStateTable            },
    { $name: "Reserved"                       , $type: U16 },
    { $name: "PowerTuneTable"                 , $type: U16 , $ref: vbios.PowerTuneTable           },
    { $name: "HardLimitTable"                 , $type: U16 , $ref: vbios.HardLimitTable           },
    { $name: "VddciLookupTable"               , $type: U16 , $ref: vbios.VoltageLookupTable       },
    { $name: "PCIETable"                      , $type: U16 , $ref: vbios.PCIETable                },
    { $name: "PixClockDependencyTable"        , $type: U16 , $ref: vbios.PixClockDependencyTable  },
    { $name: "DispClockDependencyTable"       , $type: U16 , $ref: vbios.DispClockDependencyTable },
    { $name: "PhyClockDependencyTable"        , $type: U16 , $ref: vbios.PhyClockDependencyTable  }
  ]
});

// ============================================================================
// [MasterCommandTable]
// ============================================================================

// ATOM_MASTER_COMMAND_TABLE {
//   ATOM_COMMON_TABLE_HEADER
//   ATOM_MASTER_LIST_OF_COMMAND_TABLES
// }
vbios.$define({
  $name: "MasterCommandTable",
  $extend: vbios.CommonTableHeader
});

vbios.$define({
  $extend: vbios.MasterCommandTable,
  $version: [1, 1],
  $members: [
    { $name: "ASICInit"                       , $type: U16 }, // [FT] used by various SW components,latest version 1.1
    { $name: "GetDisplaySurfaceSize"          , $type: U16 }, // [AT] Used by Bios when enabling HW ICON
    { $name: "ASICRegistersInit"              , $type: U16 }, // [AT] indirectly used by various SW components,called from ASIC_Init
    { $name: "VRAMBlockVendorDetection"       , $type: U16 }, // [AT] used only by Bios
    { $name: "DIGxEncoderControl"             , $type: U16 }, // [--] Only used by Bios
    { $name: "MemoryControllerInit"           , $type: U16 }, // [AT] indirectly used by various SW components,called from ASIC_Init
    { $name: "EnableCRTCMemReq"               , $type: U16 }, // [FT] directly used by various SW components,latest version 2.1
    { $name: "MemoryParamAdjust"              , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemoryClock if needed
    { $name: "DVOEncoderControl"              , $type: U16 }, // [FT] directly used by various SW components,latest version 1.2
    { $name: "GPIOPinControl"                 , $type: U16 }, // [AT] only used by Bios
    { $name: "SetEngineClock"                 , $type: U16 }, // [FT] directly used by various SW components,latest version 1.1
    { $name: "SetMemoryClock"                 , $type: U16 }, // [FT] directly used by various SW components,latest version 1.1
    { $name: "SetPixelClock"                  , $type: U16 }, // [FT] directly used by various SW components,latest version 1.2
    { $name: "DynamicClockGating"             , $type: U16 }, // [AT] indirectly used by various SW components,called from ASIC_Init
    { $name: "ResetMemoryDLL"                 , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemoryClock
    { $name: "ResetMemoryDevice"              , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemoryClock
    { $name: "MemoryPLLInit"                  , $type: U16 },
    { $name: "AdjustDisplayPll"               , $type: U16 }, // [--] only used by Bios
    { $name: "AdjustMemoryController"         , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemoryClock
    { $name: "EnableASICStaticPwrMgt"         , $type: U16 }, // [AT] only used by Bios
    { $name: "ASICStaticPwrMgtStatusChange"   , $type: U16 }, // [--] Obsolete ,     only used by Bios
    { $name: "DACLoadDetection"               , $type: U16 }, // [AT] directly used by various SW components,latest version 1.2
    { $name: "LVTMAEncoderControl"            , $type: U16 }, // [AT] directly used by various SW components,latest version 1.3
    { $name: "LCD1OutputControl"              , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "DAC1EncoderControl"             , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "DAC2EncoderControl"             , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "DVOOutputControl"               , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "CV1OutputControl"               , $type: U16 }, // [AT] Atomic Table,  Obsolete from Ry6xx, use DAC2 Output instead
    { $name: "GetConditionalGoldenSetting"    , $type: U16 }, // [--] only used by Bios
    { $name: "TVEncoderControl"               , $type: U16 }, // [FT] directly used by various SW components,latest version 1.1
    { $name: "TMDSAEncoderControl"            , $type: U16 }, // [AT] directly used by various SW components,latest version 1.3
    { $name: "LVDSEncoderControl"             , $type: U16 }, // [AT] directly used by various SW components,latest version 1.3
    { $name: "TV1OutputControl"               , $type: U16 }, // [AT] Obsolete from Ry6xx, use DAC2 Output instead
    { $name: "EnableScaler"                   , $type: U16 }, // [AT] used only by Bios
    { $name: "BlankCRTC"                      , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "EnableCRTC"                     , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "GetPixelClock"                  , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "EnableVGARender"                , $type: U16 }, // [FT] directly used by various SW components,latest version 1.1
    { $name: "GetSocClockOverMemClockRatio"   , $type: U16 }, // [AT] only used by Bios
    { $name: "SetCRTCTiming"                  , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "SetCRTCOverScan"                , $type: U16 }, // [AT] used by various SW components,latest version 1.1
    { $name: "SetCRTCReplication"             , $type: U16 }, // [AT] used only by Bios
    { $name: "SelectCRTCSource"               , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "EnableGraphSurfaces"            , $type: U16 }, // [AT] used only by Bios
    { $name: "UpdateCRTCDoubleBufferRegisters", $type: U16 },
    { $name: "LUTAutoFill"                    , $type: U16 }, // [AT] only used by Bios
    { $name: "EnableHWIconCursor"             , $type: U16 }, // [AT] only used by Bios
    { $name: "GetMemoryClock"                 , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "GetEngineClock"                 , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "SetCRTCUsingDTDTiming"          , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "ExternalEncoderControl"         , $type: U16 }, // [AT] directly used by various SW components,latest version 2.1
    { $name: "LVTMAOutputControl"             , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "VRAMBlockDetectionByStrap"      , $type: U16 }, // [AT] used only by Bios
    { $name: "MemoryCleanUp"                  , $type: U16 }, // [AT] only used by Bios
    { $name: "ProcessI2CChannelTransaction"   , $type: U16 }, // [FT] only used by Bios
    { $name: "WriteOneByteToHWAssistedI2C"    , $type: U16 }, // [FT] indirectly used by various SW components
    { $name: "ReadHWAssistedI2CStatus"        , $type: U16 }, // [AT] indirectly used by various SW components
    { $name: "SpeedFanControl"                , $type: U16 }, // [FT] indirectly used by various SW components,called from ASIC_Init
    { $name: "PowerConnectorDetection"        , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "MCSynchronization"              , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemoryClock
    { $name: "ComputeMemoryEnginePLL"         , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemory/EngineClock
    { $name: "MemoryRefreshConversion"        , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemory or SetEngineClock
    { $name: "VRAMGetCurrentInfoBlock"        , $type: U16 }, // [AT] used only by Bios
    { $name: "DynamicMemorySettings"          , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemoryClock
    { $name: "MemoryTraining"                 , $type: U16 }, // [AT] used only by Bios
    { $name: "EnableSpreadSpectrumOnPPLL"     , $type: U16 }, // [AT] directly used by various SW components,latest version 1.2
    { $name: "TMDSAOutputControl"             , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "SetVoltage"                     , $type: U16 }, // [FT] directly and/or indirectly used by various SW components,latest version 1.1
    { $name: "DAC1OutputControl"              , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "DAC2OutputControl"              , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "SetupHWAssistedI2CStatus"       , $type: U16 }, // [FT] only used by Bios, obsolete soon.Switch to use "ReadEDIDFromHWAssistedI2C"
    { $name: "ClockSource"                    , $type: U16 }, // [AT] indirectly used by various SW components,called from ASIC_Init
    { $name: "MemoryDeviceInit"               , $type: U16 }, // [AT] indirectly used by various SW components,called from SetMemoryClock
    { $name: "EnableYUV"                      , $type: U16 }, // [AT] indirectly used by various SW components,called from EnableVGARender
    { $name: "DIG1EncoderControl"             , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "DIG2EncoderControl"             , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "DIG1TransmitterControl"         , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "DIG2TransmitterControl"         , $type: U16 }, // [AT] directly used by various SW components,latest version 1.1
    { $name: "ProcessAuxChannelTransaction"   , $type: U16 }, // [FT] only used by Bios
    { $name: "DPEncoderService"               , $type: U16 }, // [FT] only used by Bios
    { $name: "GetVoltageInfo"                 , $type: U16 }
  ]
});

// ATOM_TABLE_ATTRIBUTE
vbios.$define({
  $name: "TableAttribute",
  $members: [
    { $name: "WSSizeInBytes"                  , $type: U16 , $bitSize: 8 }, // Size of workspace in Bytes (in multiple of a dword).
    { $name: "PSSizeInBytes"                  , $type: U16 , $bitSize: 7 }, // Size of parameter space in Bytes (multiple of a dword).
    { $name: "UpdatedByUtility"               , $type: U16 , $bitSize: 1 }  // Table updated by utility flag.
  ]
});

// ATOM_COMMON_ROM_COMMAND_TABLE_HEADER
vbios.$define({
  $name: "CommonCommandTableHeader",
  $extend: vbios.CommonTableHeader,
  $members: [
    { $name: "TableAttribute"                 , $type: vbios.TableAttribute }
  ]
});

// ============================================================================
// [MasterDataTable]
// ============================================================================

// ATOM_MASTER_DATA_TABLE {
//   ATOM_COMMON_TABLE_HEADER
//   ATOM_MASTER_LIST_OF_DATA_TABLES
// }
vbios.$define({
  $name: "MasterDataTable",
  $extend: vbios.CommonTableHeader,
  $members: [
    { $name: "UtilityPipeLine"                , $type: U16 },
    { $name: "MultimediaCapabilityInfo"       , $type: U16 , $ref: vbios.MultimediaCapabilityInfo, $flags: ABS_OFF },
    { $name: "MultimediaConfigInfo"           , $type: U16 , $ref: vbios.MultimediaConfigInfo    , $flags: ABS_OFF },
    { $name: "StandardVESATiming"             , $type: U16 , $ref: vbios.ModeTiming              , $flags: ABS_OFF },
    { $name: "FirmwareInfo"                   , $type: U16 , $ref: vbios.FirmwareInfo            , $flags: ABS_OFF },
    { $name: "DACInfo"                        , $type: U16 , $ref: vbios.DACInfo                 , $flags: ABS_OFF },
    { $name: "LCDInfo"                        , $type: U16 , $ref: vbios.LCDInfo                 , $flags: ABS_OFF },
    { $name: "TMDSInfo"                       , $type: U16 , $ref: vbios.TMDSInfo                , $flags: ABS_OFF },
    { $name: "SMUInfo"                        , $type: U16 , $ref: vbios.SMUInfo                 , $flags: ABS_OFF },
    { $name: "SupportedDevicesInfo"           , $type: U16 , $ref: vbios.SupportedDevicesInfo    , $flags: ABS_OFF },
    { $name: "GPIOI2CInfo"                    , $type: U16 , $ref: vbios.GPIOI2CInfo             , $flags: ABS_OFF },
    { $name: "VRAMUsageByFirmware"            , $type: U16 },
    { $name: "GPIOPinLUT"                     , $type: U16 },
    { $name: "VESAToInternalModeLUT"          , $type: U16 },
    { $name: "GfxInfo"                        , $type: U16 , $ref: vbios.GfxInfo                 , $flags: ABS_OFF },
    { $name: "PowerPlayTable"                 , $type: U16 , $ref: vbios.PowerPlayTable          , $flags: ABS_OFF },
    { $name: "CompassionateData"              , $type: U16 , $ref: vbios.CompassionateData       , $flags: ABS_OFF },
    { $name: "SaveRestoreInfo"                , $type: U16 },
    { $name: "PPLLSSInfo"                     , $type: U16 }, // Shared by various SW components,latest version 1.2, used to call SS_Info, change to new name because of int ASIC SS info
    { $name: "OEMInfo"                        , $type: U16 , $ref: vbios.OEMInfo                 , $flags: ABS_OFF },
    { $name: "XTMDSInfo"                      , $type: U16 , $ref: vbios.XTMDSInfo               , $flags: ABS_OFF },
    { $name: "MemClockSSInfo"                 , $type: U16 }, // Shared by various SW components,latest version 1.1, only enabled when ext SS chip is used
    { $name: "ObjectInfo"                     , $type: U16 , $ref: vbios.ObjectInfo              , $flags: ABS_OFF },
    { $name: "IndirectIOAccess"               , $type: U16 },
    { $name: "MCInitParameter"                , $type: U16 }, // Only used by command table
    { $name: "ASICVddcInfo"                   , $type: U16 },
    { $name: "ASICInternalSSInfo"             , $type: U16 }, // New tabel name from R600, used to be called "ASIC_MVDDC_Info"
    { $name: "TVVideoMode"                    , $type: U16 }, // Only used by command table
    { $name: "VRAMInfo"                       , $type: U16 , $ref: vbios.VRAMInfo                , $flags: ABS_OFF },
    { $name: "MemoryTrainingInfo"             , $type: U16 }, // Used for VBIOS and Diag utility for memory training purpose since R600. the new table rev start from 2.1
    { $name: "IntegratedSystemInfo"           , $type: U16 , $ref: vbios.IntegratedSystemInfo    , $flags: ABS_OFF },
    { $name: "ASICProfilingInfo"              , $type: U16 , $ref: vbios.ASICProfilingInfo       , $flags: ABS_OFF },
    { $name: "VoltageObjectInfo"              , $type: U16 , $ref: vbios.VoltageObjectInfo       , $flags: ABS_OFF },
    { $name: "PowerSourceInfo"                , $type: U16 , $ref: vbios.PowerSourceInfo         , $flags: ABS_OFF },
    { $name: "ServiceInfo"                    , $type: U16 , $ref: vbios.ServiceInfo             , $flags: ABS_OFF }
  ]
});

vbios.$define({
  $extend: vbios.MasterDataTable,
  $version: [1, 1]
});

// ============================================================================
// [Rom]
// ============================================================================

// ATOM_ROM_HEADER
vbios.$define({
  $name: "RomTable",
  $extend: vbios.CommonTableHeader,
  $members: [
    { $name: "FirmwareSignature"              , $type: U32 },
    { $name: "BiosRuntimeSegmentAddress"      , $type: U16 },
    { $name: "ProtectedModeInfoOffset"        , $type: U16 },
    { $name: "ConfigFilenameOffset"           , $type: U16 },
    { $name: "CRCBlockOffset"                 , $type: U16 },
    { $name: "BIOSBootupMessageOffset"        , $type: U16 },
    { $name: "Int10Offset"                    , $type: U16 },
    { $name: "PCIBusDevInitCode"              , $type: U16 },
    { $name: "IOBaseAddress"                  , $type: U16 },
    { $name: "SubsystemVendorId"              , $type: U16 },
    { $name: "SubsystemId"                    , $type: U16 },
    { $name: "PCIInfoOffset"                  , $type: U16 },
    { $name: "MasterCommandTable"             , $type: U16 , $ref: vbios.MasterCommandTable, $flags: ABS_OFF },
    { $name: "MasterDataTable"                , $type: U16 , $ref: vbios.MasterDataTable   , $flags: ABS_OFF },
    { $name: "ExtendedFunctionCode"           , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  }
  ]
});

// ATOM_ROM_HEADER_V1_1
vbios.$define({
  $extend: vbios.RomTable,
  $version: [1, 1]
});

// ATOM_ROM_HEADER_V2_1
vbios.$define({
  $extend: vbios["RomTable$1.1"],
  $version: [2, 1],
  $members: [
    { $name: "PSPDirTableOffset"              , $type: U32 }
  ]
});

// ============================================================================
// [VBIOS]
// ============================================================================

// VBIOS_ROM_HEADER
vbios.$define({
  $name: "VBIOSTable",
  $flags: FLAGS.ISOLATE,
  $members: [
    { $name: "PCIRomSignature"                , $type: U16 },
    { $name: "PCIRomSizeIn512Bytes"           , $type: U8  },
    { $name: "JumpCoreMainInitBIOS"           , $type: U8  },
    { $name: "LabelCoreMainInitBIOS"          , $type: U16 },
    { $name: "PCIReservedSpace"               , $type: Arr, $length: 18, $ref: U8 },
    { $name: "PCIDataStructureOffset"         , $type: U16 },
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "IBMSignature"                   , $type: Str, $length: 3  },
    { $name: "CheckSum"                       , $type: Arr, $length: 14, $ref: U8 },
    { $name: "BIOSMsgNumber"                  , $type: U8  },
    { $name: "Str761295520"                   , $type: Str, $length: 16 },
    { $name: "LabelCoreVPOSTNoMode"           , $type: U16 },
    { $name: "SpecialPostOffset"              , $type: U16 },
    { $name: "SpecialPostImageSizeIn512Bytes" , $type: U8  },
    { $name: "Reserved2"                      , $type: U24 },
    { $name: "RomTable"                       , $type: U16, $ref: vbios.RomTable },
    { $name: "Reserved3"                      , $type: U16 },
    { $name: "Reserved4"                      , $type: U32 },
    { $name: "BuildTimeStamp"                 , $type: Str, $length: 20 },
    { $name: "JumpCoreXFuncFarHandler"        , $type: U8  },
    { $name: "CoreXFuncFarHandlerOffset"      , $type: U16 },
    { $name: "Reserved5"                      , $type: U8  },
    { $name: "JumpCoreVFuncFarHandler"        , $type: U8  },
    { $name: "CoreVFuncFarHandlerOffset"      , $type: U16 },
    { $name: "Reserved6"                      , $type: U24 },
    { $name: "BIOSMsgOffset"                  , $type: U16 }
  ]
});

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports", require("./binlib.js")] : [this, "vbios", this.binlib]);
