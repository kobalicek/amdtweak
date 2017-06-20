// ============================================================================
// [atom.js]
// Structures used by AMDGPU's ATOM-VBIOS and AMD's PowerPlay.
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
//   * Don't prefix structures with "Atom" or "ATOM. This is all related to ATOM
//     so this is not necessary, and when the library is imported as `atom` all
//     structures are also accessed as `atom.???` so the namespace is implicit.
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
//     end of `atom.js`. To make it more natural to follow the data structures
//     we use init functions that are called in reverse order.
//
// TODOS
//
//   * It's unfinished. There is still a lot of tables not described here.
//
//   * Some tables that use a complicated formula to calculate a number of
//     elements in an array cannot be interpreted yet. This must be fixed in
//     binlib first
//
// NOTES:
//
//   * VDD       - ?
//   * MVDD      - ?
//   * VDDCGFXO  - ?
//   * MVDDC     - Pure Memory Voltage (FIJI)
//   * VDDCI     - Memory controller voltage (not POLARIS).
//   * VDDCI/AUX - I/O bus voltage (between memory and GPU core) (POLARIS)
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

const atom = new binlib.Context();
$export[$as] = atom;

const I8 = binlib.I8;
const U8 = binlib.U8;
const I16 = binlib.I16;
const U16 = binlib.U16;
const U24 = binlib.U24;
const I32 = binlib.I32;
const U32 = binlib.U32;
const Str = binlib.Str;
const Hex = binlib.Hex;
const Arr = binlib.Array;

// ============================================================================
// [Definitions & Utilities]
// ============================================================================

// Make a 32-bit signature from the given string `s` that must have 4 characters.
function makeSignature32(s) {
  if (typeof s !== "string")
    throw Error(`atom.makeSignature32(): Signature must be a string, not '${typeof s}'`);

  if (s.length !== 4)
    throw Error(`atom.makeSignature32(): Signature must be exactly 4 characters long, not '${s.length}'`);

  const a = s.charCodeAt(0);
  const b = s.charCodeAt(1);
  const c = s.charCodeAt(2);
  const d = s.charCodeAt(3);
  return (d << 24) | (c << 16) | (b << 8) | a;
}
atom.makeSignature32 = makeSignature32;

// Check whether the given buffer `buf` is a VBIOS header.
function isVBIOSData(buf, offset) {
  const len = buf.length;
  const off = offset || 0;

  // The data must hold at least VBIOS structure.
  const VBIOS = atom.VBIOSTable;
  if (len < VBIOS.$size)
    return false;

  // Check some signatures to make sure it's data we expect.
  const PCIRomSignature = VBIOS.PCIRomSignature.$read(atom, buf, off);
  if (PCIRomSignature !== atom.VBIOS_SIGNATURE)
    return false;

  const StrIBM = VBIOS.StrIBM.$read(atom, buf, off);
  if (StrIBM !== "IBM")
    return false;

  const RomTableOffset = VBIOS.RomTableOffset.$read(atom, buf, off);
  if (RomTableOffset < VBIOS.$size)
    return false;

  return true;
}
atom.isVBIOSData = isVBIOSData;

function extractVBIOSPowerPlayData(buf, offset) {
  if (!isVBIOSData(buf, offset))
    return null;

  const len = buf.length;
  const off = offset || 0;

  const VBIOS = atom.VBIOSTable;
  const RomTable = atom.RomTable;
  const MasterDataTable = atom.MasterDataTable;
  const PowerPlayInfo = atom.PowerPlayInfo;

  const RomTableOffset = VBIOS.RomTableOffset.$read(atom, buf, off) + off;
  if (RomTableOffset < VBIOS.$size ||
      RomTableOffset + RomTable.MasterDataTableOffset.$offset >= len)
    return null;

  const MasterDataTableOffset = RomTable.MasterDataTableOffset.$read(atom, buf, RomTableOffset) + off;
  if (MasterDataTableOffset < VBIOS.$size ||
      MasterDataTableOffset + MasterDataTable.PowerPlayInfoOffset.$offset >= len)
    return null;

  const PowerPlayInfoOffset = MasterDataTable.PowerPlayInfoOffset.$read(atom, buf, MasterDataTableOffset) + off;
  if (PowerPlayInfoOffset < VBIOS.$size ||
      PowerPlayInfoOffset + 4 >= len)
    return null;

  const PowerPlayInfoSize = PowerPlayInfo.StructureSize.$read(atom, buf, PowerPlayInfoOffset);
  if (PowerPlayInfoSize == 0 ||
      PowerPlayInfoOffset + PowerPlayInfoSize > len)
    return null;

  return buf.slice(PowerPlayInfoOffset, PowerPlayInfoOffset + PowerPlayInfoSize);
}
atom.extractVBIOSPowerPlayData = extractVBIOSPowerPlayData;

atom.VBIOS_SIGNATURE = 0xAA55;
atom.VBIOS_ROM_OFFSET = 0x48;
atom.FIRMWARE_SIGNATURE = makeSignature32("ATOM");

// ============================================================================
// [Common]
// ============================================================================

// ATOM_COMMON_TABLE_HEADER
atom.$addStruct({
  $name: "CommonTableHeader",
  $verInfo: ["TableFormatRevision", "TableContentRevision"],
  $members: [
    { $name: "StructureSize"                  , $type: U16 },
    { $name: "TableFormatRevision"            , $type: U8  },
    { $name: "TableContentRevision"           , $type: U8  }
  ]
});

// Simple base structure for versioned structures that use `RevisionID`.
atom.$addStruct({
  $name: "CommonRevIdHeader",
  $verInfo: ["RevisionID"],
  $members: [
    { $name: "RevisionID"                     , $type: U8  }
  ]
});

// Doesn't really have a struct version in C, but we use it as a base for many
// C array structures that contain these two members followed by Entries[...].
atom.$addStruct({
  $name: "CommonArrayHeader",
  $extend: atom.CommonRevIdHeader,
  $members: [
    { $name: "NumEntries"                     , $type: U8  }
  ]
});


// ============================================================================
// [Firmware Information]
// ============================================================================

// ATOM_FIRMWARE_CAPABILITY
// ATOM_FIRMWARE_CAPABILITY_ACCESS
atom.$addStruct({
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
atom.$addStruct({
  $name: "ProductBranding",
  $members: [
    { $name: "EmbeddedCap"                    , $type: U8 , $bitSize: 2 },
    { $name: "Reserved1"                      , $type: U8 , $bitSize: 2 },
    { $name: "BrandingID"                     , $type: U8 , $bitSize: 4 }
  ]
});

// ATOM_FIRMWARE_INFO
atom.$addStruct({
  $name: "FirmwareInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.FirmwareInfo,
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
    { $name: "FirmwareCapability"             , $type: atom.FirmwareCapability },
    { $name: "ReferenceClock"                 , $type: U16 }, // In [10Khz] unit
    { $name: "PMRTSLocation"                  , $type: U16 }, // RTS PM4 starting location in ROM in 1Kb unit.
    { $name: "PMRTSStreamSize"                , $type: U8  }, // RTS PM4 packets in Kb unit.
    { $name: "DesignID"                       , $type: U8  }, // Indicates what is the board design.
    { $name: "MemoryModuleID"                 , $type: U8  }  // Indicates what is the board design.
  ]
});

// ATOM_FIRMWARE_INFO_V1_2
atom.$addStruct({
  $extend: atom.FirmwareInfo,
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
    { $name: "FirmwareCapability"             , $type: atom.FirmwareCapability },
    { $name: "ReferenceClock"                 , $type: U16 }, // In [10Khz] unit
    { $name: "PMRTSLocation"                  , $type: U16 }, // RTS PM4 starting location in ROM in 1Kb unit.
    { $name: "PMRTSStreamSize"                , $type: U8  }, // RTS PM4 packets in Kb unit.
    { $name: "DesignID"                       , $type: U8  }, // Indicates what is the board design.
    { $name: "MemoryModuleID"                 , $type: U8  }  // Indicates what is the board design.
  ]
});

// ATOM_FIRMWARE_INFO_V1_3
atom.$addStruct({
  $extend: atom.FirmwareInfo,
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
    { $name: "FirmwareCapability"             , $type: atom.FirmwareCapability },
    { $name: "ReferenceClock"                 , $type: U16 }, // In [10Khz] unit
    { $name: "PMRTSLocation"                  , $type: U16 }, // RTS PM4 starting location in ROM in 1Kb unit.
    { $name: "PMRTSStreamSize"                , $type: U8  }, // RTS PM4 packets in Kb unit.
    { $name: "DesignID"                       , $type: U8  }, // Indicates what is the board design.
    { $name: "MemoryModuleID"                 , $type: U8  }  // Indicates what is the board design.
  ]
});

// ATOM_FIRMWARE_INFO_V1_4
atom.$addStruct({
  $extend: atom.FirmwareInfo,
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
    { $name: "BootUpVDDCVoltage"              , $type: U16 }, // In [mV] unit.
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
    { $name: "FirmwareCapability"             , $type: atom.FirmwareCapability },
    { $name: "ReferenceClock"                 , $type: U16 }, // In [10Khz] unit
    { $name: "PMRTSLocation"                  , $type: U16 }, // RTS PM4 starting location in ROM in 1Kb unit.
    { $name: "PMRTSStreamSize"                , $type: U8  }, // RTS PM4 packets in Kb unit.
    { $name: "DesignID"                       , $type: U8  }, // Indicates what is the board design.
    { $name: "MemoryModuleID"                 , $type: U8  }  // Indicates what is the board design.
  ]
});

// ATOM_FIRMWARE_INFO_V2_1
atom.$addStruct({
  $extend: atom.FirmwareInfo,
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
    { $name: "DefaultDispEngineClkFreq"       , $type: U32 }, // In [10Khz] unit.
    { $name: "Reserved3"                      , $type: U8  },
    { $name: "MinAllowedBLLevel"              , $type: U8  },
    { $name: "BootUpVDDCVoltage"              , $type: U16 }, // In [mV] unit.
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
    { $name: "FirmwareCapability"             , $type: atom.FirmwareCapability },
    { $name: "CoreReferenceClock"             , $type: U16 }, // In [10Khz] unit
    { $name: "MemoryReferenceClock"           , $type: U16 }, // In [10Khz] unit
    { $name: "UniphyDPModeExtClkFreq"         , $type: U16 }, // In [10Khz] unit
    { $name: "MemoryModuleID"                 , $type: U8  },
    { $name: "Reserved5"                      , $type: U32 }
  ]
});

// ATOM_FIRMWARE_INFO_V2_2
atom.$addStruct({
  $extend: atom.FirmwareInfo,
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
    { $name: "DefaultDispEngineClkFreq"       , $type: U32 }, // In [10Khz] unit.
    { $name: "Reserved3"                      , $type: U8  },
    { $name: "MinAllowedBLLevel"              , $type: U8  },
    { $name: "BootUpVDDCVoltage"              , $type: U16 }, // In [mV] unit.
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
    { $name: "BootUpVDDCIVoltage"             , $type: U16 }, // In [mV] unit.
    { $name: "FirmwareCapability"             , $type: atom.FirmwareCapability },
    { $name: "CoreReferenceClock"             , $type: U16 }, // In [10Khz] unit
    { $name: "MemoryReferenceClock"           , $type: U16 }, // In [10Khz] unit
    { $name: "UniphyDPModeExtClkFreq"         , $type: U16 }, // In [10Khz] unit
    { $name: "MemoryModuleID"                 , $type: U8  },
    { $name: "CoolingSolutionID"              , $type: U8  },
    { $name: "ProductBranding"                , $type: atom.ProductBranding },
    { $name: "Reserved9"                      , $type: U8  },
    { $name: "BootUpMVDDCVoltage"             , $type: U16 }, // In [mV] unit.
    { $name: "BootUpVDDGFXVoltage"            , $type: U16 }, // In [mV] unit.
    { $name: "Reserved10"                     , $type: U32 },
    { $name: "Reserved11"                     , $type: U32 },
    { $name: "Reserved12"                     , $type: U32 }
  ]
});

// ============================================================================
// [Multimedia Capability]
// ============================================================================

// ATOM_MULTIMEDIA_CAPABILITY_INFO
atom.$addStruct({
  $name: "MultimediaCapabilityInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.MultimediaCapabilityInfo,
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
atom.$addStruct({
  $name: "MultimediaConfigInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.MultimediaConfigInfo,
  $version: [1, 1],
  $members: [
    { $name: "Signature"                      , $type: U32 }, // MM info table signature string "$MMT"
    { $name: "TunerInfo"                      , $type: U8  }, // Type of tuner installed on the adapter (4:0) and video input for tuner (7:5)
    { $name: "AudioChipInfo"                  , $type: U8  }, // List the audio chip type (3:0) product type (4) and OEM revision (7:5)
    { $name: "ProductID"                      , $type: U8  }, // Defines as OEM ID or ATI board ID dependent on product type setting
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
atom.$addStruct({
  $name: "IntegratedSystemInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.IntegratedSystemInfo,
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
atom.$addStruct({
  $extend: atom.IntegratedSystemInfo,
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
atom.$addStruct({
  $extend: atom.IntegratedSystemInfo,
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
atom.$addStruct({
  $name: "GPUVirtualizationInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.GPUVirtualizationInfo,
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

atom.$addStruct({
  $name: "SCLKFCWRangeEntry",
  $version: [1],
  $members: [
    { $name: "MaxSCLKFreq"                    , $type: U32 },
    { $name: "VCOSetting"                     , $type: U8  },
    { $name: "Postdiv"                        , $type: U8  },
    { $name: "FCWPCC"                         , $type: U16 },
    { $name: "FCWTransUpper"                  , $type: U16 },
    { $name: "RCWTransLower"                  , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "SMUInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.SMUInfo,
  $version: [2, 1],
  $members: [
    { $name: "SCLKEntryNum"                   , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 },
    { $name: "SCLKFCWRangeEntries"            , $type: Arr, $ref: atom.SCLKFCWRangeEntry$1, $length: "SCLKEntryNum" }
  ]
});

// ============================================================================
// [VRAM Information]
// ============================================================================

atom.$addStruct({
  $name: "VRAMTimingEntry",
  $members: [
    { $name: "CLKRange"                       , $type: U32 },
    { $name: "Latency"                        , $type: Hex , $size: 48 }
  ]
});

atom.$addStruct({
  $name: "VRAMModule",
  $extend: atom.CommonTableHeader,
  $members: [
    { $name: "ChannelMapCfg"                  , $type: U32 },
    { $name: "ModuleSize"                     , $type: U16 },
    { $name: "McRamCfg"                       , $type: U16 },
    { $name: "EnableChannels"                 , $type: U16 },
    { $name: "ExtMemoryID"                    , $type: U8  },
    { $name: "MemoryType"                     , $type: U8  },
    { $name: "ChannelNum"                     , $type: U8  },
    { $name: "ChannelWidth"                   , $type: U8  },
    { $name: "Density"                        , $type: U8  },
    { $name: "BankCol"                        , $type: U8  },
    { $name: "Misc"                           , $type: U8  },
    { $name: "VREFI"                          , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "MemorySize"                     , $type: U16 },
    { $name: "McTunningSetID"                 , $type: U8  },
    { $name: "RowNum"                         , $type: U8  },
    { $name: "EMRS2Value"                     , $type: U16 },
    { $name: "EMRS3Value"                     , $type: U16 },
    { $name: "MemoryVendorID"                 , $type: U8  },
    { $name: "RefreshRateFactor"              , $type: U8  },
    { $name: "FIFODepth"                      , $type: U8  },
    { $name: "CDRBandwidth"                   , $type: U8  },
    { $name: "ChannelMapCfg1"                 , $type: U32 },
    { $name: "BankMapCfg"                     , $type: U32 },
    { $name: "Reserved2"                      , $type: U32 },
    { $name: "MemPNString"                    , $type: Hex , $size: 20 }
  ]
});

atom.$addStruct({
  $name: "VRAMInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $name: "VRAMInfo",
  $extend: atom.VRAMInfo,
  $version: [2, 2],
  $members: [
    { $name: "MemAdjustTableOffset"           , $type: U16 },
    { $name: "MCLKPatchTableOffset"           , $type: U16 },
    { $name: "McAdjustPerTileTableOffset"     , $type: U16 },
    { $name: "McPhyInitTableOffset"           , $type: U16 },
    { $name: "DRAMDataRemapTableOffset"       , $type: U16 },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "NumModules"                     , $type: U8  },
    { $name: "MCLKPatchTableVer"              , $type: U8  },
    { $name: "VRAMModuleVer"                  , $type: U8  },
    { $name: "McPhyTileNum"                   , $type: U8  },
    { $name: "Modules"                        , $type: Arr, $ref: atom.VRAMModule, $length: "NumModules" }
  ]
});

// ============================================================================
// [Display Object / Object Information]
// ============================================================================

// ATOM_DISPLAY_OBJECT_PATH
atom.$addStruct({
  $name: "DisplayObjectPath",
  $members: [
    { $name: "DeviceTag"                      , $type: U16 }, // Supported device.
    { $name: "Size"                           , $type: U16 }, // The size of DisplayPathTable.
    { $name: "ConnObjectID"                   , $type: U16 }, // Connector Object ID.
    { $name: "GPUObjectID"                    , $type: U16 }, // GPU ID.

    // 1st Encoder Obj source from GPU to last Graphic Obj destinate to connector.
    { $name: "GraphicObjIDs"                  , $type: Arr, $ref: U16, $length: 1 }
  ]
});

// ATOM_DISPLAY_EXTERNAL_OBJECT_PATH
atom.$addStruct({
  $name: "DisplayExternalObjectPath",
  $members: [
    { $name: "DeviceTag"                      , $type: U16 }, // Supported device.
    { $name: "Size"                           , $type: U16 }, // The size of DisplayPathTable.
    { $name: "ConnObjectID"                   , $type: U16 }, // Connector Object ID.
    { $name: "GPUObjectID"                    , $type: U16 }, // GPU ID.

    // GraphicObjIDs[0] - Internal encoder
    // GraphicObjIDs[1] - External encoder
    { $name: "GraphicObjIDs"                  , $type: Arr, $ref: U16, $length: 2 }
  ]
});

// ATOM_DISPLAY_OBJECT_PATH_TABLE
atom.$addStruct({
  $name: "DisplayObjectPathTable",
  $members: [
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Version"                        , $type: U8  },
    { $name: "Padding"                        , $type: U16 },
    { $name: "Entries"                        , $type: Arr, $ref: atom.DisplayObjectPath, $length: "NumEntries" },

    // GraphicObjIDs[0] - Internal encoder
    // GraphicObjIDs[1] - External encoder
    { $name: "GraphicObjIDs"                  , $type: Arr, $ref: U16, $length: 2 }
  ]
});

// ATOM_OBJECT
atom.$addStruct({
  $name: "Object",
  $members: [
    { $name: "ObjectID"                       , $type: U16 },
    { $name: "SrcDstTableOffset"              , $type: U16 },
    { $name: "RecordOffset"                   , $type: U16 },
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

// Object_Info
// ATOM_OBJECT_HEADER
atom.$addStruct({
  $name: "ObjectInfo",
  $extend: atom.CommonTableHeader
});

// ATOM_OBJECT_TABLE
atom.$addStruct({
  $name: "ObjectTable",
  $members: [
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Padding"                        , $type: U24 },
    { $name: "GraphicObjIDs"                  , $type: Arr, $ref: atom.Object, $length: "NumEntries" }
  ]
});

// ATOM_SRC_DST_TABLE_FOR_ONE_OBJECT
atom.$addStruct({
  $name: "SrcDstTable",
  $members: [
    { $name: "NumberOfSrc"                    , $type: U8  },
    { $name: "SrcObjectID"                    , $type: Arr, $ref: U16, $length: 1 },
    { $name: "NumberOfDst"                    , $type: U8  },
    { $name: "DstObjectID"                    , $type: Arr, $ref: U16, $length: 1 }
  ]
});

// ATOM_OBJECT_HEADER
atom.$addStruct({
  $extend: atom.ObjectInfo,
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
atom.$addStruct({
  $extend: atom["ObjectInfo$1.1"],
  $version: [1, 3],
  $members: [
    { $name: "MiscObjectTableOffset"          , $type: U16 }
  ]
});

// ============================================================================
// [Power Source Information]
// ============================================================================

// ATOM_POWER_SOURCE_OBJECT
atom.$addStruct({
  $name: "PowerSourceObject",
  $members: [
    { $name: "SourceID"                       , $type: U8  },
    { $name: "SensorType"                     , $type: U8  },
    { $name: "SensorID"                       , $type: U8  },
    { $name: "SensorSlaveAddr"                , $type: U8  },
    { $name: "SensorRegIndex"                 , $type: U8  },
    { $name: "SensorRegBitMask"               , $type: U8  },
    { $name: "SensorActiveState"              , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 },
    { $name: "SensorPower"                    , $type: U16 }
  ]
});

// ATOM_POWER_SOURCE_INFO
atom.$addStruct({
  $name: "PowerSourceInfo",
  $extend: atom.CommonTableHeader,
  $verInfo: null,
  $members: [
    { $name: "Behave"                         , $type: Arr, $ref: U8, $length: 16 },
    { $name: "Objects"                        , $type: Arr, $ref: atom.PowerSourceObject, $length: 1 }
  ]
});

// ============================================================================
// [GFX Information]
// ============================================================================

atom.$addStruct({
  $name: "GFXInfo",
  $extend: atom.CommonTableHeader
});

// ATOM_GFX_INFO_V2_1
//   FIXME: The struct is called `ATOM_GFX_INFO_V2_1` although the version is 2.3?
atom.$addStruct({
  $extend: atom.GFXInfo,
  $version: [2, 1],
  $members: [
    { $name: "GFXIPMinor"                     , $type: U8  },
    { $name: "GFXIPMajor"                     , $type: U8  },
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
atom.$addStruct({
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
atom.$addStruct({
  $name: "TMDSInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $name: "TMDSInfo",
  $extend: atom.TMDSInfo,
  $version: [1, 1],
  $members: [
    { $name: "MaxFrequency"                   , $type: U16 }, // In [10Khz] unit.
    { $name: "MiscInfo"                       , $type: atom.MiscControlInfo, $length: 4 }
  ]
});

// ============================================================================
// [I2CID Configuration]
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
atom.$addStruct({
  $name: "I2CIDConfig",
  $members: [
    { $name: "I2CLineMux"                     , $type: U8, $bitSize: 4 },
    { $name: "HWEngineID"                     , $type: U8, $bitSize: 3 },
    { $name: "HWCapable"                      , $type: U8, $bitSize: 1 }
  ]
});

// ============================================================================
// [GPIOI2C Information]
// ============================================================================

// ATOM_GPIO_I2C_ASSIGMENT
atom.$addStruct({
  $name: "GPIOI2CAssignment",
  $members: [
    { $name: "ClkMaskRegisterIndex"           , $type: U16 },
    { $name: "ClkEnRegisterIndex"             , $type: U16 },
    { $name: "ClkYRegisterIndex"              , $type: U16 },
    { $name: "ClkARegisterIndex"              , $type: U16 },
    { $name: "DataMaskRegisterIndex"          , $type: U16 },
    { $name: "DataEnRegisterIndex"            , $type: U16 },
    { $name: "DataYRegisterIndex"             , $type: U16 },
    { $name: "DataARegisterIndex"             , $type: U16 },
    { $name: "I2CID"                          , $type: atom.I2CIDConfig },
    { $name: "ClkMaskShift"                   , $type: U8  },
    { $name: "ClkEnShift"                     , $type: U8  },
    { $name: "ClkYShift"                      , $type: U8  },
    { $name: "ClkAShift"                      , $type: U8  },
    { $name: "DataMaskShift"                  , $type: U8  },
    { $name: "DataEnShift"                    , $type: U8  },
    { $name: "DataYShift"                     , $type: U8  },
    { $name: "DataAShift"                     , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Reserved2"                      , $type: U8  }
  ]
});

// ATOM_GPIO_I2C_INFO
atom.$addStruct({
  $name: "GPIOI2CInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.GPIOI2CInfo,
  $version: [1, 1],
  $members: [
    { $name: "GPIOInfo"                       , $type: Arr, $ref: atom.GPIOI2CAssignment, $length: 16 }
  ]
});

// ============================================================================
// [XTMDS Information]
// ============================================================================

// ATOM_XTMDS_INFO
atom.$addStruct({
  $name: "XTMDSInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.XTMDSInfo,
  $version: [1, 1],
  $members: [
    { $name: "SingleLinkMaxFrequency"         , $type: U16 },
    { $name: "I2CID"                          , $type: atom.I2CIDConfig },
    { $name: "XtransimitterID"                , $type: U8  },
    { $name: "SupportedLink"                  , $type: U8  }, // Bit field, bit0=1, single link supported;bit1=1, dual link supported.
    { $name: "SequnceAlterID"                 , $type: U8  }, // This ID is used to alert driver that the sequence is not "standard".
    { $name: "MasterAddress"                  , $type: U8  }, // Address to control Master xTMDS Chip.
    { $name: "SlaveAddress"                   , $type: U8  }, // Address to control Slave xTMDS Chip.
  ]
});

// ============================================================================
// [TODO Uncategorized]
// ============================================================================

// DFP_DPMS_STATUS_CHANGE_PARAMETER
atom.$addStruct({
  $name: "DFPDPMSStatusChangeParameter",
  $version: [1, 1],
  $members: [
    { $name: "Enable"                         , $type: U8  },
    { $name: "Device"                         , $type: U8  },
    { $name: "Padding"                        , $type: U16 }
  ]
});

// WRITE_ONE_BYTE_HW_I2C_DATA_PARAMETERS
atom.$addStruct({
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
atom.$addStruct({
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
atom.$addStruct({
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
    { $name: "ModeMiscInfo"                   , $type: atom.ModeMiscInfo },
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
atom.$addStruct({
  $name: "DACInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.DACInfo,
  $version: [2, 1],
  $members: [
    { $name: "MaxFrequency"                   , $type: U16 }, // in [10Khz] unit.
    { $name: "Reserved"                       , $type: U16 }
  ]
});

// COMPASSIONATE_DATA
atom.$addStruct({
  $name: "CompassionateData",
  $extend: atom.CommonTableHeader,
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
atom.$addStruct({
  $name: "ConnectorInfo",
  $members: [
    { $name: "AssociatedDAC"                  , $type: U8  , $bitSize: 4 },
    { $name: "ConnectorType"                  , $type: U8  , $bitSize: 4 }
  ]
});

// ATOM_CONNECTOR_INFO_I2C
atom.$addStruct({
  $name: "ConnectorInfoI2C",
  $extend: atom.ConnectorInfo,
  $members: [
    { $name: "I2CID"                          , $type: atom.I2CIDConfig }
  ]
});

// ATOM_CONNECTOR_INC_SRC_BITMAP
atom.$addStruct({
  $name: "ConnectorIntSrcBitmap",
  $members: [
    { $name: "IntSrcBitmap"                   , $type: U8  }
  ]
});

// ATOM_SUPPORTED_DEVICES_INFO
atom.$addStruct({
  $name: "SupportedDevicesInfo",
  $extend: atom.CommonTableHeader,
  $members: [
    { $name: "DeviceSupport"                  , $type: U16 }
  ]
});

// ATOM_SUPPORTED_DEVICES_INFO
atom.$addStruct({
  $extend: atom.SupportedDevicesInfo,
  $version: [1, 0],
  $members: [
    { $name: "ConnectionInfo"                 , $type: atom.ConnectorInfoI2C     , $length: 10 }
  ]
});

// ATOM_SUPPORTED_DEVICES_INFO_2
atom.$addStruct({
  $extend: atom.SupportedDevicesInfo,
  $version: [2, 0],
  $members: [
    { $name: "ConnectionInfo"                 , $type: atom.ConnectorInfoI2C     , $length: 10 },
    { $name: "IntSourceInfo"                  , $type: atom.ConnectorIntSrcBitmap, $length: 10 }
  ]
});

// ATOM_SUPPORTED_DEVICES_INFO_2d1
atom.$addStruct({
  $extend: atom.SupportedDevicesInfo,
  $version: [2, 1],
  $members: [
    { $name: "ConnectionInfo"                 , $type: atom.ConnectorInfoI2C     , $length: 16 },
    { $name: "IntSourceInfo"                  , $type: atom.ConnectorIntSrcBitmap, $length: 16 }
  ]
});

// ATOM_ENCODER_ATTRIBUTE
// ATOM_ENCODER_ANALOG_ATTRIBUTE
// ATOM_ENCODER_DIGITAL_ATTRIBUTE
atom.$addStruct({
  $name: "EncoderAttribute",
  $members: [
    { $name: "Attribute"                      , $type: U8  },
    { $name: "Padding"                        , $type: U8  }
  ]
});

// DVO_ENCODER_CONTROL_PARAMETERS
atom.$addStruct({
  $name: "DVOEncoderControlParameters",
  $version: [1, 0],
  $members: [
    { $name: "PixelClock"                     , $type: U16 },
    { $name: "EncoderID"                      , $type: U16 },
    { $name: "DeviceType"                     , $type: U8  },
    { $name: "Action"                         , $type: U8  },
    { $name: "DeviceAttr"                     , $type: atom.EncoderAttribute }
  ]
});

// DVO_ENCODER_CONTROL_PARAMETERS_V3
atom.$addStruct({
  $name: "DVOEncoderControlParameters",
  $version: [1, 3],
  $members: [
    { $name: "PixelClock"                     , $type: U16 },
    { $name: "DVOConfig"                      , $type: U8  },
    { $name: "Action"                         , $type: U8  },
    { $name: "Reserved"                       , $type: U32 }
  ]
});

// DVO_ENCODER_CONTROL_PARAMETERS_V1_4
atom.$addStruct({
  $name: "DVOEncoderControlParameters",
  $version: [1, 4],
  $members: [
    { $name: "PixelClock"                     , $type: U16 },
    { $name: "DVOConfig"                      , $type: U8  },
    { $name: "Action"                         , $type: U8  },
    { $name: "BitPerColor"                    , $type: U8  },
    { $name: "Reserved"                       , $type: U24 }
  ]
});

// DVO_ENCODER_CONTROL_PS_ALLOCATION
atom.$addStruct({
  $name: "DVOEncoderControlPSAllocation",
  $version: [1],
  $members: [
    { $name: "DVOEncoder"                     , $type: atom["DVOEncoderControlParameters$1.0"] },
    { $name: "Reserved"                       , $type: atom.WriteOneByteHWI2CDataParameters }
  ]
});

// ============================================================================
// [OEM Information]
// ============================================================================

// ATOM_OEM_INFO
atom.$addStruct({
  $name: "OEMInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.OEMInfo,
  $version: [1, 1],
  $members: [
    { $name: "I2CID"                          , $type: atom.I2CIDConfig }
  ]
});

// ============================================================================
// [LCD Information]
// ============================================================================

// ATOM_DTD_FORMAT
atom.$addStruct({
  $name: "DTDFormat",
  $members: [
    { $name: "PixClk"                         , $type: U16 },
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
    { $name: "ModeMiscInfo"                   , $type: atom.ModeMiscInfo },
    { $name: "InternalModeNumber"             , $type: U8  },
    { $name: "RefreshRate"                    , $type: U8  }
  ]
});

// ATOM_LCD_REFRESH_RATE_SUPPORT
atom.$addStruct({
  $name: "LCDRefreshRateSupport",
  $members: [
    { $name: "SupportedRefreshRate"           , $type: U8  },
    { $name: "MinRefreshRateForDRR"           , $type: U8  }
  ]
});

atom.$addStruct({
  $name: "LCDInfo",
  $extend: atom.CommonTableHeader
});

// ATOM_LCD_INFO
atom.$addStruct({
  $extend: atom.LCDInfo,
  $version: [1, 1],
  $members: [
    { $name: "LCDTiming"                      , $type: atom.DTDFormat },
    { $name: "ExtInfoTableOffset"             , $type: U16 },
    { $name: "RefreshRateSupport"             , $type: atom.LCDRefreshRateSupport },
    { $name: "OffDelayInMS"                   , $type: U16 }, // In [ms] unit.
    { $name: "PowerSequenceDigOntoDE"         , $type: U8  }, // In [10ms] unit.
    { $name: "PowerSequenceDEtoBLOn"          , $type: U8  }, // In [10ms] unit.
    { $name: "LCDMisc"                        , $type: U8  },
    { $name: "PanelDefaultRefreshRate"        , $type: U8  },
    { $name: "PanelIdentification"            , $type: U8  },
    { $name: "SSID"                           , $type: U8  }
  ]
});

// ATOM_LCD_INFO_V12
atom.$addStruct({
  $extend: atom["LCDInfo$1.1"],
  $version: [1, 2],
  $members: [
    { $name: "LCDVendorID"                    , $type: U16 },
    { $name: "LCDProductID"                   , $type: U16 },
    { $name: "LCDPanelSpecialHandlingCap"     , $type: U8  },
    { $name: "PanelInfoSize"                  , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 }
  ]
});

// ATOM_LCD_INFO_V13
atom.$addStruct({
  $extend: atom.LCDInfo,
  $version: [1, 3],
  $members: [
    { $name: "LCDTiming"                      , $type: atom.DTDFormat },
    { $name: "ExtInfoTableOffset"             , $type: U16 },
    { $name: "RefreshRateSupport"             , $type: atom.LCDRefreshRateSupport },
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "LCDMisc"                        , $type: U8  },
    { $name: "PanelDefaultRefreshRate"        , $type: U8  },
    { $name: "PanelIdentification"            , $type: U8  },
    { $name: "SSID"                           , $type: U8  },
    { $name: "LCDVendorID"                    , $type: U16 },
    { $name: "LCDProductID"                   , $type: U16 },
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
    { $name: "MaxPclkFreqInSingleLink"        , $type: U16 }, // Max PixelClock frequency in single link mode.
    { $name: "EDPToLVDSRxID"                  , $type: U8  },
    { $name: "LCDReserved"                    , $type: U8  },
    { $name: "Reserved3"                      , $type: U32 },
    { $name: "Reserved4"                      , $type: U32 }
  ]
});

// ============================================================================
// [Voltage Object / Information]
// ============================================================================

atom.VOLTAGE_OBJ_GPIO_LUT                 = 0;
atom.VOLTAGE_OBJ_VR_I2C_INIT_SEQ          = 3;
atom.VOLTAGE_OBJ_PHASE_LUT                = 4;
atom.VOLTAGE_OBJ_SVID2                    = 7;
atom.VOLTAGE_OBJ_EVV                      = 8;
atom.VOLTAGE_OBJ_POWER_BOOST_LEAKAGE_LUT  = 16;
atom.VOLTAGE_OBJ_HIGH_STATE_LEAKAGE_LUT   = 17;
atom.VOLTAGE_OBJ_HIGH1_STATE_LEAKAGE_LUT  = 18;

// VOLTAGE_LUT_ENTRY
atom.$addStruct({
  $name: "VoltageLUTEntry",
  $version: [1],
  $members: [
    { $name: "VoltageCode"                    , $type: U16 }, // The Voltage ID, either GPIO or I2C code.
    { $name: "VoltageValue"                   , $type: U16 }  // In [mV] unit.
  ]
});

atom.$addStruct({
  $name: "VoltageLUTEntry",
  $version: [2],
  $members: [
    { $name: "VoltageID"                      , $type: U32 }, // The Voltage ID which is used to program GPIO register.
    { $name: "VoltageValue"                   , $type: U16 }  // In [mV] unit.
  ]
});

// ATOM_VOLTAGE_FORMULA
atom.$addStruct({
  $name: "VoltageFormula",
  $version: [1],
  $members: [
    { $name: "VoltageBaseLevel"               , $type: U16 },
    { $name: "VoltageStep"                    , $type: U16 },
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Flag"                           , $type: U8  },
    { $name: "BaseVID"                        , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Entries"                        , $type: Arr  , $ref: U8, $length: "NumEntries" }
  ]
});

// ATOM_VOLTAGE_FORMULA_V2
atom.$addStruct({
  $name: "VoltageFormula",
  $version: [2],
  $members: [
    { $name: "NumEntries"                     , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 },
    { $name: "Entries"                        , $type: Arr  , $ref: atom.VoltageLUTEntry$1, $length: "NumEntries" }
  ]
});

// ATOM_VOLTAGE_CONTROL
atom.$addStruct({
  $name: "VoltageControl",
  $members: [
    { $name: "VoltageControlID"               , $type: U8  },
    { $name: "VoltageControlI2CLine"          , $type: U8  },
    { $name: "VoltageControlAddress"          , $type: U8  },
    { $name: "VoltageControlOffset"           , $type: U8  },
    { $name: "GPIOPinAIndex"                  , $type: U16 },
    { $name: "GPIOPinBitShift"                , $type: Arr  , $ref: U8, $length: 9 },
    { $name: "Reserved1"                      , $type: U8  }
  ]
});

// ATOM_VOLTAGE_OBJECT
atom.$addStruct({
  $name: "VoltageObjectV1",
  $members: [
    { $name: "VoltageType"                    , $type: U8  },                   // Indicates Voltage Source: VDDC, MVDDC, MVDDQ or MVDDCI.
    { $name: "Size"                           , $type: U8  },                   // Size of the Object.
    { $name: "Control"                        , $type: atom.VoltageControl   }, // Describes how to control.
    { $name: "Formula"                        , $type: atom.VoltageFormula$1 }  // Indicate How to convert real Voltage to VID.
  ]
});

// ATOM_VOLTAGE_OBJECT_V2
atom.$addStruct({
  $name: "VoltageObjectV2",
  $members: [
    { $name: "VoltageType"                    , $type: U8  },
    { $name: "Size"                           , $type: U8  },
    { $name: "Control"                        , $type: atom.VoltageControl },
    { $name: "Formula"                        , $type: atom.VoltageFormula$2 }
  ]
});

// ATOM_VOLTAGE_INFO
// ATOM_VOLTAGE_INFO_HEADER
atom.$addStruct({
  $name: "VoltageInfo",
  $extend: atom.CommonTableHeader,
  $members: [
    { $name: "VDDCBaseLevel"                  , $type: U16 }, // In [50mV] unit.
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
atom.$addStruct({
  $name: "VoltageObjectV3",
  $verInfo: ["VoltageMode"],
  $members: [
    { $name: "VoltageType"                    , $type: U8  }, // Indicates voltage source [VDDC, MVDDC, MVDDQ, or MVDDCI].
    { $name: "VoltageMode"                    , $type: U8  }, // Indicates voltage control mode [Init, Set, Leakage, Set phase].
    { $name: "Size"                           , $type: U16 }  // Size of the object.
  ]
});

// ATOM_I2C_VOLTAGE_OBJECT_V3
atom.$addStruct({
  $extend: atom.VoltageObjectV3,
  $version: [atom.VOLTAGE_OBJ_VR_I2C_INIT_SEQ],
  $members: [
    { $name: "VoltageRegulatorId"             , $type: U8  },
    { $name: "VoltageControlI2cLine"          , $type: U8  },
    { $name: "VoltageControlAddress"          , $type: U8  },
    { $name: "VoltageControlOffset"           , $type: U8  },
    { $name: "VoltageControlFlag"             , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 },
    // TODO: Length not implemented, ends with 0xFF.
    { $name: "LUTEntries"                     , $type: Arr, $ref: atom.VoltageLUTEntry$1, $length: 1 }
  ]
});

// ATOM_GPIO_VOLTAGE_OBJECT_V3
atom.$addStruct({
  $name: "GPIOVoltageObject",
  $extend: atom.VoltageObjectV3,
  $version: [atom.VOLTAGE_OBJ_GPIO_LUT],
  $members: [
    { $name: "VoltageGPIOControlID"           , $type: U8  },
    { $name: "GPIOEntryNum"                   , $type: U8  },
    { $name: "PhaseDelay"                     , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "GPIOMaskVal"                    , $type: U32 },
    // TODO: Length not implemented.
    { $name: "LUTEntries"                     , $type: Arr, $ref: atom.VoltageLUTEntry$2, $length: 1 }
  ]
});

atom.$addStruct({
  $extend: atom[`VoltageObjectV3$${atom.VOLTAGE_OBJ_GPIO_LUT}`],
  $version: [atom.VOLTAGE_OBJ_PHASE_LUT]
});

// ATOM_LEAKAGE_VOLTAGE_OBJECT_V3
atom.$addStruct({
  $extend: atom.VoltageObjectV3,
  $version: [atom.VOLTAGE_OBJ_POWER_BOOST_LEAKAGE_LUT],
  $members: [
    { $name: "LeakageControlID"               , $type: U8  },
    { $name: "LeakageEntryNum"                , $type: U8  },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "MaxVoltageLevel"                , $type: U32 },
    // TODO: Length not implemented.
    { $name: "LUTEntries"                     , $type: Arr, $ref: atom.VoltageLUTEntry$2, $length: 1 }
  ]
});

atom.$addStruct({
  $extend: atom[`VoltageObjectV3$${atom.VOLTAGE_OBJ_POWER_BOOST_LEAKAGE_LUT}`],
  $version: [atom.VOLTAGE_OBJ_HIGH_STATE_LEAKAGE_LUT],
});

atom.$addStruct({
  $extend: atom[`VoltageObjectV3$${atom.VOLTAGE_OBJ_POWER_BOOST_LEAKAGE_LUT}`],
  $version: [atom.VOLTAGE_OBJ_HIGH1_STATE_LEAKAGE_LUT],
});

// ATOM_SVID2_VOLTAGE_OBJECT_V3
atom.$addStruct({
  $extend: atom.VoltageObjectV3,
  $version: [atom.VOLTAGE_OBJ_SVID2],
  $members: [
    { $name: "LoadLinePSI"                    , $type: U16 },
    { $name: "SVDGPIOID"                      , $type: U8  },
    { $name: "SVCGPIOID"                      , $type: U8  },
    { $name: "Reserved1"                      , $type: U32 }
  ]
});

// ATOM_MERGED_VOLTAGE_OBJECT_V3
atom.$addStruct({
  $extend: atom.VoltageObjectV3,
  $version: [atom.VOLTAGE_OBJ_MERGED_POWER],
  $members: [
    { $name: "MergedVType"                    , $type: U8  },
    { $name: "Reserved1"                      , $type: U24 }
  ]
});

/*
// ATOM_EVV_DPM_INFO
atom.$addStruct({
  $name: "EVVDPMInfo",
  $members: [
    { $name: "DPMSCLK"                        , $type: U32 }, // DPM state SCLK.
    { $name: "VAdjOffset"                     , $type: U16 }, // In [mV] unit, voltage offset adjustment.
    { $name: "DPMTblVIndex"                   , $type: U8  }, // Voltage Index in SMC_DPM_Table structure VddcTable/VddGfxTable.
    { $name: "DPMState"                       , $type: U8  }  // DPMState0..7.
  ]
});

// ATOM_EVV_VOLTAGE_OBJECT_V3
atom.$addStruct({
  $extend: atom.VoltageObjectV3,
  $version: [?],
  $members: [
    { $name: "Entries"                        , $type: atom.EVVDPMInfo, $length: 8 }
  ]
});
*/

// ATOM_VOLTAGE_OBJECT_INFO
atom.$addStruct({
  $name: "VoltageObjectInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.VoltageObjectInfo,
  $version: [1, 1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.VoltageObjectV1, $length: 3 }
  ]
});

// ATOM_VOLTAGE_OBJECT_INFO_V2
atom.$addStruct({
  $extend: atom.VoltageObjectInfo,
  $version: [2, 1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.VoltageObjectV2, $length: 3 }
  ]
});

// ATOM_VOLTAGE_OBJECT_INFO_V3
atom.$addStruct({
  $extend: atom.VoltageObjectInfo,
  $version: [3, 1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.VoltageObjectV3, $length: 3 }
  ]
});

// ============================================================================
// [ASIC Profiling Information]
// ============================================================================

// ATOM_LEAKID_VOLTAGE
atom.$addStruct({
  $name: "LeakIDVoltage",
  $members: [
    { $name: "LeakageID"                      , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Voltage"                        , $type: U16 }
  ]
});

// ATOM_ASIC_PROFILE_VOLTAGE
atom.$addStruct({
  $name: "ASICProfileVoltage",
  $members: [
    { $name: "ProfileID"                      , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Size"                           , $type: U16 },
    { $name: "EfuseSpareStartAddr"            , $type: U16 },
    { $name: "FuseIndex"                      , $type: Arr, $ref: U16               , $length: 8 },
    { $name: "LeakVoltage"                    , $type: Arr, $ref: atom.LeakIDVoltage, $length: 2 }
  ]
});

// EFUSE_LOGISTIC_FUNC_PARAM
//   Measured = LN((2^Bitsize - 1) / EFUSE - 1) * Range / -Alpha + (Max + Min) / 2
atom.$addStruct({
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
atom.$addStruct({
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
atom.$addStruct({
  $name: "ASICProfilingInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.ASICProfilingInfo,
  $version: [1, 1],
  $members: [
    { $name: "Voltage"                        , $type: atom.ASICProfileVoltage }
  ]
});

atom.$addStruct({
  $extend: atom.ASICProfilingInfo,
  $version: [2, 1],
  $members: [
    { $name: "LeakageBinNum"                  , $type: U8  },
    { $name: "LeakageBinArrayOffset"          , $type: U16 },
    { $name: "ElbVDDCNum"                     , $type: U8  },
    { $name: "ElbVDDCIDArrayOffset"           , $type: U16 },
    { $name: "ElbVDDCLevelArrayOffset"        , $type: U16 },
    { $name: "ElbVDDCINum"                    , $type: U8  },
    { $name: "ElbVDDCIIDArrayOffset"          , $type: U16 },
    { $name: "ElbVDDCILevelArrayOffset"       , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "ASICProfilingDPMEntry",
  $version: [3, 1],
  $members: [
    { $name: "Power"                          , $type: U16 },
    { $name: "Current"                        , $type: U16 }
  ]
});

atom.$addStruct({
  $extend: atom.ASICProfilingInfo,
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
    { $name: "CACm"                           , $type: atom.EfuseLinearFuncParam },
    { $name: "CACb"                           , $type: atom.EfuseLinearFuncParam },
    { $name: "Ktb"                            , $type: atom.EfuseLogisticFuncParam },
    { $name: "Kvm"                            , $type: atom.EfuseLogisticFuncParam },
    { $name: "Kvb"                            , $type: atom.EfuseLogisticFuncParam },
    { $name: "LeakageEuseIndex"               , $type: U16 },
    { $name: "LeakageEfuseBitLSB"             , $type: U8  },
    { $name: "LeakageEfuseLength"             , $type: U8  },
    { $name: "LeakageEncodeLnMaxDivMin"       , $type: U32 },
    { $name: "LeakageEncodeMax"               , $type: U32 },
    { $name: "LeakageEncodeMin"               , $type: U32 },
    { $name: "EfuseLogisticAlpha"             , $type: U32 },
    { $name: "DPMEntries"                     , $type: Arr, $ref: atom["ASICProfilingDPMEntry$3.1"], $length: 8 }
  ]
});

atom.$addStruct({
  $extend: atom.ASICProfilingInfo,
  $version: [3, 2],
  $members: [
    { $name: "EvvLkgFactor"                   , $type: U32 },
    { $name: "BoardCoreTemp"                  , $type: U32 },
    { $name: "MaxVddc"                        , $type: U32 },
    { $name: "MinVddc"                        , $type: U32 },
    { $name: "LoadLineSlop"                   , $type: U32 },
    { $name: "LeakageTemp"                    , $type: U32 },
    { $name: "LeakageVoltage"                 , $type: U32 },
    { $name: "CACm"                           , $type: atom.EfuseLinearFuncParam },
    { $name: "CACb"                           , $type: atom.EfuseLinearFuncParam },
    { $name: "Ktb"                            , $type: atom.EfuseLogisticFuncParam },
    { $name: "Kvm"                            , $type: atom.EfuseLogisticFuncParam },
    { $name: "Kvb"                            , $type: atom.EfuseLogisticFuncParam },
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
atom.$addStruct({
  $extend: atom["ASICProfilingInfo$3.2"],
  $version: [3, 3],
  $members: [
    { $name: "RoFuse"                         , $type: atom.EfuseLinearFuncParam },
    { $name: "RoAlpha"                        , $type: U32 },
    { $name: "RoBeta"                         , $type: U32 },
    { $name: "RoGamma"                        , $type: U32 },
    { $name: "RoEpsilon"                      , $type: U32 },
    { $name: "ATermRo"                        , $type: U32 },
    { $name: "BTermRo"                        , $type: U32 },
    { $name: "CTermRo"                        , $type: U32 },
    { $name: "SCLKMargin"                     , $type: U32 },
    { $name: "FMaxPercent"                    , $type: U32 },
    { $name: "CRPercent"                      , $type: U32 },
    { $name: "SFMaxPercent"                   , $type: U32 },
    { $name: "SCRPercent"                     , $type: U32 },
    { $name: "SDCMargine"                     , $type: U32 }
  ]
});

// Fiji speed EVV algorithm.
atom.$addStruct({
  $extend: atom["ASICProfilingInfo$3.2"],
  $version: [3, 4],
  $members: [
    { $name: "RoFuse"                         , $type: atom.EfuseLinearFuncParam },
    { $name: "EvvDefaultVDDC"                 , $type: U32 },
    { $name: "EvvNoCalcVDDC"                  , $type: U32 },
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
    { $name: "Reserved"                       , $type: Arr, $ref: U32, $length: 8 }
  ]
});

// Polaris10/Polaris11 speed EVV algorithm.
atom.$addStruct({
  $extend: atom.ASICProfilingInfo,
  $version: [3, 5],
  $members: [
    { $name: "MaxVDDC"                        , $type: U32 }, // In [0.01mV] unit, maximum voltage for all parts.
    { $name: "MinVDDC"                        , $type: U32 }, // In [0.01mV] unit, minimum voltage for all parts.
    { $name: "LkgEuseIndex"                   , $type: U16 },
    { $name: "LkgEfuseBitLSB"                 , $type: U8  },
    { $name: "LkgEfuseLength"                 , $type: U8  },
    { $name: "LkgEncodeLnMaxDivMin"           , $type: U32 },
    { $name: "LkgEncodeMax"                   , $type: U32 },
    { $name: "LkgEncodeMin"                   , $type: U32 },
    { $name: "RoFuse"                         , $type: atom.EfuseLinearFuncParam },
    { $name: "EvvDefaultVDDC"                 , $type: U32 },
    { $name: "EvvNoCalcVDDC"                  , $type: U32 },
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
    { $name: "Reserved"                       , $type: Arr, $ref: U32, $length: 12 }
  ]
});

// Polars10/11 AVFS parameters.
atom.$addStruct({
  $extend: atom.ASICProfilingInfo,
  $version: [3, 6],
  $members: [
    { $name: "MaxVDDC"                        , $type: U32 }, // In [0.01mV] unit, maximum voltage for all parts.
    { $name: "MinVDDC"                        , $type: U32 }, // In [0.01mV] unit, minimum voltage for all parts.
    { $name: "LkgEuseIndex"                   , $type: U16 },
    { $name: "LkgEfuseBitLSB"                 , $type: U8  },
    { $name: "LkgEfuseLength"                 , $type: U8  },
    { $name: "LkgEncodeLnMaxDivMin"           , $type: U32 },
    { $name: "LkgEncodeMax"                   , $type: U32 },
    { $name: "LkgEncodeMin"                   , $type: U32 },
    { $name: "RoFuse"                         , $type: atom.EfuseLinearFuncParam },
    { $name: "EvvDefaultVDDC"                 , $type: U32 },
    { $name: "EvvNoCalcVDDC"                  , $type: U32 },
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
    { $name: "NoCalcVDDCPerDPM"               , $type: Arr, $ref: U32, $length: 8 },
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
atom.$addStruct({
  $name: "HoleInfo",
  $members: [
    { $name: "Offset"                         , $type: U16 }, // Offset of the hole (from the start of the binary).
    { $name: "Length"                         , $type: U16 }  // Length of the hole (in bytes).
  ]
});

// ATOM_SERVICE_INFO
// ATOM_SERVICE_DESCRIPTION
atom.$addStruct({
  $name: "ServiceInfo",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.ServiceInfo,
  $version: [1, 1],
  $members: [
    { $name: "RevisionID"                     , $type: U8  },
    { $name: "Algorithm"                      , $type: U8  },
    { $name: "SignatureType"                  , $type: U8  },
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "SignatureOffset"                , $type: U16 },
    { $name: "SignatureLength"                , $type: U16 },
    { $name: "NumHoles"                       , $type: U8  },
    { $name: "Holes"                          , $type: Arr, $ref: atom.HoleInfo, $length: "NumHoles" }
  ]
});

// ============================================================================
// [PowerPlay]
// ============================================================================

atom.$addStruct({
  $name: "PowerTuneTable",
  $extend: atom.CommonRevIdHeader
});

atom.$addStruct({
  $extend: atom.PowerTuneTable,
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
    { $name: "PowerTuneDataSetID"             , $type: U16 },
    { $name: "EDCLimit"                       , $type: U16 },
    { $name: "SoftwareShutdownTemp"           , $type: U16 },
    { $name: "ClockStretchAmount"             , $type: U16 },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "Reserved2"                      , $type: U16 }
  ]
});

atom.$addStruct({
  $extend: atom.PowerTuneTable,
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
    { $name: "PowerTuneDataSetID"             , $type: U16 },
    { $name: "EDCLimit"                       , $type: U16 },
    { $name: "SoftwareShutdownTemp"           , $type: U16 },
    { $name: "ClockStretchAmount"             , $type: U16 },
    { $name: "TemperatureLimitHotspot"        , $type: U16 },
    { $name: "TemperatureLimitLiquid1"        , $type: U16 },
    { $name: "TemperatureLimitLiquid2"        , $type: U16 },
    { $name: "TemperatureLimitVrVDDC"         , $type: U16 },
    { $name: "TemperatureLimitVrMVDD"         , $type: U16 },
    { $name: "TemperatureLimitPlx"            , $type: U16 },
    { $name: "Liquid1I2CAddress"              , $type: U8  },
    { $name: "Liquid2I2CAddress"              , $type: U8  },
    { $name: "LiquidI2CLine"                  , $type: U8  },
    { $name: "VrI2CAddress"                   , $type: U8  },
    { $name: "VrI2CLine"                      , $type: U8  },
    { $name: "PlxI2CAddress"                  , $type: U8  },
    { $name: "PlxI2CLine"                     , $type: U8  },
    { $name: "Reserved"                       , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "PPMTable",
  $extend: atom.CommonRevIdHeader
});

atom.$addStruct({
  $extend: atom.PPMTable,
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

atom.$addStruct({
  $name: "FanTable",
  $extend: atom.CommonRevIdHeader
});

atom.$addStruct({
  $extend: atom.FanTable,
  $version: [9],
  $members: [
    { $name: "THyst"                          , $type: U8  }, // Temperature hysteresis.
    { $name: "TMin"                           , $type: U16 }, // The temperature, in 0.01 centigrades, below which we just run at a minimal PWM.
    { $name: "TMed"                           , $type: U16 }, // The middle temperature where we change slopes.
    { $name: "THigh"                          , $type: U16 }, // The high point above TMed for adjusting the second slope.
    { $name: "PWMMin"                         , $type: U16 }, // The minimum PWM value in percent (0.01% increments).
    { $name: "PWMMed"                         , $type: U16 }, // The PWM value (in percent) at TMed.
    { $name: "PWMHigh"                        , $type: U16 }, // The PWM value at THigh.
    { $name: "TMax"                           , $type: U16 }, // The max temperature.
    { $name: "FanControlMode"                 , $type: U8  }, // Legacy or Fuzzy Fan mode.
    { $name: "FanPWMMax"                      , $type: U16 }, // Maximum allowed fan power in percent.
    { $name: "FanOutputSensitivity"           , $type: U16 }, // Sensitivity of fan reaction to temepature changes.
    { $name: "FanRPMMax"                      , $type: U16 }, // The default value in RPM.
    { $name: "MinFanSCLKAcousticLimit"        , $type: U32 }, // Minimum Fan Controller SCLK Frequency Acoustic Limit.
    { $name: "TargetTemperature"              , $type: U8  }, // Advanced fan controller target temperature.
    { $name: "MinimumPWMLimit"                , $type: U8  }, // The minimum PWM that the advanced fan controller can set.  This should be set to the highest PWM that will run the fan at its lowest RPM.
    { $name: "Reserved"                       , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "GPIOTable",
  $extend: atom.CommonRevIdHeader
});

atom.$addStruct({
  $extend: atom.GPIOTable,
  $version: [0],
  $members: [
    { $name: "VRHotTriggeredSCLKDPMIndex"     , $type: U8  }, // If VRHot signal is triggered SCLK will be limited to this DPM level.
    { $name: "Reserved1"                      , $type: U8  },
    { $name: "Reserved2"                      , $type: U8  },
    { $name: "Reserved3"                      , $type: U8  },
    { $name: "Reserved4"                      , $type: U8  },
    { $name: "Reserved5"                      , $type: U8  }
  ]
});

atom.$addStruct({
  $name: "ThermalControlTable",
  $extend: atom.CommonRevIdHeader
});

atom.$addStruct({
  $extend: atom.ThermalControlTable,
  $version: [1],
  $members: [
    { $name: "ControlType"                    , $type: U8  },
    { $name: "I2CLine"                        , $type: U8  }, // As interpreted by DAL I2C.
    { $name: "I2CAddress"                     , $type: U8  },
    { $name: "FanParameters"                  , $type: U8  },
    { $name: "FanMinRPM"                      , $type: U8  }, // Minimum RPM (hundreds).
    { $name: "FanMaxRPM"                      , $type: U8  }, // Maximum RPM (hundreds).
    { $name: "Reserved"                       , $type: U8  },
    { $name: "Flags"                          , $type: U8  }
  ]
});

atom.$addStruct({
  $name: "StateEntry",
  $version: [1],
  $members: [
    { $name: "SCLKIdxHigh"                    , $type: U8  },
    { $name: "SCLKIdxLow"                     , $type: U8  },
    { $name: "MCLKIdxHigh"                    , $type: U8  },
    { $name: "MCLKIdxLow"                     , $type: U8  },
    { $name: "PCIEGenLow"                     , $type: U8  },
    { $name: "PCIEGenHigh"                    , $type: U8  },
    { $name: "PCIELaneLow"                    , $type: U8  },
    { $name: "PCIELaneHigh"                   , $type: U8  },
    { $name: "Classification"                 , $type: U16 },
    { $name: "CapsAndSettings"                , $type: U32 },
    { $name: "Classification2"                , $type: U16 },
    { $name: "Reserved"                       , $type: U32 }
  ]
});

atom.$addStruct({
  $name: "StateTable",
  $extend: atom.CommonArrayHeader
});

atom.$addStruct({
  $extend: atom.StateTable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.StateEntry$1, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $name: "SCLKDependencyEntry",
  $version: [0],
  $members: [
    { $name: "VDDIndex"                       , $type: U8  }, // Base voltage.
    { $name: "VDDCOffset"                     , $type: I16 }, // Offset relative to base voltage.
    { $name: "SCLK"                           , $type: U32 },
    { $name: "EDCCurrent"                     , $type: U16 },
    { $name: "ReliabilityTemperature"         , $type: U8  },
    { $name: "CKSOffsetAndDisable"            , $type: U8  }  // Bits 0~6: Voltage offset for CKS, Bit 7: Disable/enable for the SCLK level.
  ]
});

atom.$addStruct({
  $name: "SCLKDependencyEntry",
  $version: [1],
  $members: [
    { $name: "VDDC"                           , $type: U8  }, // Base voltage.
    { $name: "VDDCOffset"                     , $type: I16 }, // Offset relative to base voltage.
    { $name: "SCLK"                           , $type: U32 },
    { $name: "EDCCurrent"                     , $type: U16 },
    { $name: "ReliabilityTemperature"         , $type: U8  },
    { $name: "CKSOffsetAndDisable"            , $type: U8  }, // Bits 0~6: Voltage offset for CKS, Bit 7: Disable/enable for the SCLK level.
    { $name: "SCLKOffset"                     , $type: I32 }
  ]
});

atom.$addStruct({
  $name: "SCLKDependencyTable",
  $extend: atom.CommonArrayHeader
});

atom.$addStruct({
  $extend: atom.SCLKDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.SCLKDependencyEntry$0, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $extend: atom.SCLKDependencyTable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.SCLKDependencyEntry$1, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $name: "MCLKDependencyEntry",
  $version: [0],
  $members: [
    { $name: "VDDC"                           , $type: U8  },
    { $name: "VDDCI"                          , $type: U16 },
    { $name: "VDDCGFXOffset"                  , $type: I16 }, // Offset relative to VDDC voltage.
    { $name: "MVDD"                           , $type: U16 },
    { $name: "MCLK"                           , $type: U32 },
    { $name: "Reserved"                       , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "MCLKDependencyTable",
  $extend: atom.CommonArrayHeader
});

atom.$addStruct({
  $extend: atom.MCLKDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.MCLKDependencyEntry$0, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $name: "VoltageLookupEntry",
  $version: [0],
  $members: [
    { $name: "VDD"                            , $type: U16 }, // Base voltage.
    { $name: "CACLow"                         , $type: U16 },
    { $name: "CACMid"                         , $type: U16 },
    { $name: "CACHigh"                        , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "VoltageLookupTable",
  $extend: atom.CommonArrayHeader
});

atom.$addStruct({
  $extend: atom.VoltageLookupTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.VoltageLookupEntry$0, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $name: "MMDependencyEntry",
  $version: [0],
  $members: [
    { $name: "VDDC"                           , $type: U8  }, // VDDC voltage.
    { $name: "VDDCGFXOffset"                  , $type: I16 }, // Offset relative to VDDC voltage.
    { $name: "DCLK"                           , $type: U32 }, // UVD D-clock.
    { $name: "VCLK"                           , $type: U32 }, // UVD V-clock.
    { $name: "ECLK"                           , $type: U32 }, // VCE clock.
    { $name: "ACLK"                           , $type: U32 }, // ACP clock.
    { $name: "SAMUCLK"                        , $type: U32 }  // SAMU clock.
  ]
});

atom.$addStruct({
  $name: "MMDependencyTable",
  $extend: atom.CommonArrayHeader
});

atom.$addStruct({
  $extend: atom.MMDependencyTable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.MMDependencyEntry$0, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $name: "VCEStateEntry",
  $version: [1],
  $members: [
    { $name: "VCECLKIdx"                      , $type: U8  }, // Index into 'VCEDependencyTableOffset' of 'MMDependencyTable'.
    { $name: "Flag"                           , $type: U8  }, // 2 bits indicates memory p-states.
    { $name: "SCLKIdx"                        , $type: U8  }, // Index into 'SCLKDependencyTable'.
    { $name: "MCLKIdx"                        , $type: U8  }  // Index into 'MCLKDependencyTable'.
  ]
});

atom.$addStruct({
  $name: "VCEStateTable",
  $extend: atom.CommonArrayHeader
});

atom.$addStruct({
  $extend: atom.VCEStateTable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.VCEStateEntry$1, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $name: "HardLimitEntry",
  $version: [52],
  $members: [
    { $name: "SCLKLimit"                      , $type: U32 },
    { $name: "MCLKLimit"                      , $type: U32 },
    { $name: "VDDCLimit"                      , $type: U16 },
    { $name: "VDDCILimit"                     , $type: U16 },
    { $name: "VDDGFXLimit"                    , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "HardLimitTable",
  $extend: atom.CommonArrayHeader
});

atom.$addStruct({
  $extend: atom.HardLimitTable,
  $version: [52],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.HardLimitEntry$52, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $name: "PCIEEntry",
  $version: [0],
  $members: [
    { $name: "PCIEGenSpeed"                   , $type: U8  },
    { $name: "PCIELaneWidth"                  , $type: U8  },
    { $name: "Reserved"                       , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "PCIEEntry",
  $version: [1],
  $members: [
    { $name: "PCIEGenSpeed"                   , $type: U8  },
    { $name: "PCIELaneWidth"                  , $type: U8  },
    { $name: "Reserved"                       , $type: U16 },
    { $name: "PCIESCLK"                       , $type: U32 }
  ]
});

atom.$addStruct({
  $name: "PCIETable",
  $extend: atom.CommonArrayHeader
});

atom.$addStruct({
  $extend: atom.PCIETable,
  $version: [0],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.PCIEEntry$0, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $extend: atom.PCIETable,
  $version: [1],
  $members: [
    { $name: "Entries"                        , $type: Arr, $ref: atom.PCIEEntry$1, $length: "NumEntries" }
  ]
});

atom.$addStruct({
  $name: "PowerPlayInfo",
  $extend: atom.CommonTableHeader,
  $verInfo: ["RevisionID"],
  $members: [
    { $name: "RevisionID"                     , $type: U8  },
    { $name: "TableSize"                      , $type: U16 }
  ]
});

atom.$addStruct({
  $name: "PowerPlayInfo",
  $extend: atom.PowerPlayInfo,
  $version: [0],
  $members: [
    { $name: "GoldenPPID"                     , $type: U32 },
    { $name: "GoldenRevision"                 , $type: U32 },
    { $name: "FormatID"                       , $type: U16 },
    { $name: "VoltageTime"                    , $type: U16 }, // In [ms].
    { $name: "PlatformCaps"                   , $type: U32 },
    { $name: "SCLKMaxOD"                      , $type: U32 },
    { $name: "MCLKMaxOD"                      , $type: U32 },
    { $name: "PowerControlLimit"              , $type: U16 },
    { $name: "UlvVoltageOffset"               , $type: U16 }, // In [mV] unit.
    { $name: "StateTableOffset"               , $type: U16 , $ref: atom.StateTable          , $as: "StateTable"          },
    { $name: "FanTableOffset"                 , $type: U16 , $ref: atom.FanTable            , $as: "FanTable"            },
    { $name: "ThermalControlOffset"           , $type: U16 , $ref: atom.ThermalControlTable , $as: "ThermalControl"      },
    { $name: "Reserved1"                      , $type: U16 },
    { $name: "MCLKDependencyTableOffset"      , $type: U16 , $ref: atom.MCLKDependencyTable , $as: "MCLKDependencyTable" },
    { $name: "SCLKDependencyTableOffset"      , $type: U16 , $ref: atom.SCLKDependencyTable , $as: "SCLKDependencyTable" },
    { $name: "VDDCLookupTableOffset"          , $type: U16 , $ref: atom.VoltageLookupTable  , $as: "VDDCLookupTable"     },
    { $name: "VDDGFXLookupTableOffset"        , $type: U16 , $ref: atom.VoltageLookupTable  , $as: "VDDGFXLookupTable"   },
    { $name: "MMDependencyTableOffset"        , $type: U16 , $ref: atom.MMDependencyTable   , $as: "MMDependencyTable"   },
    { $name: "VCEStateTableOffset"            , $type: U16 , $ref: atom.VCEStateTable       , $as: "VCEStateTable"       },
    { $name: "PPMTableOffset"                 , $type: U16 , $ref: atom.PPMTable            , $as: "PPMTable"            },
    { $name: "PowerTuneTableOffset"           , $type: U16 , $ref: atom.PowerTuneTable      , $as: "PowerTuneTable"      },
    { $name: "HardLimitTableOffset"           , $type: U16 , $ref: atom.HardLimitTable      , $as: "HardLimitTable"      },
    { $name: "PCIETableOffset"                , $type: U16 , $ref: atom.PCIETable           , $as: "PCIETable"           },
    { $name: "GPIOTableOffset"                , $type: U16 , $ref: atom.GPIOTable           , $as: "GPIOTable"           },
    { $name: "Reserved2"                      , $type: U16 },
    { $name: "Reserved3"                      , $type: U16 },
    { $name: "Reserved4"                      , $type: U16 },
    { $name: "Reserved5"                      , $type: U16 },
    { $name: "Reserved6"                      , $type: U16 },
    { $name: "Reserved7"                      , $type: U16 }
  ]
});

// ============================================================================
// [Master Command]
// ============================================================================

// ATOM_MASTER_COMMAND_TABLE {
//   ATOM_COMMON_TABLE_HEADER
//   ATOM_MASTER_LIST_OF_COMMAND_TABLES
// }
atom.$addStruct({
  $name: "MasterCommandTable",
  $extend: atom.CommonTableHeader
});

atom.$addStruct({
  $extend: atom.MasterCommandTable,
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
    { $name: "GetSCLKOverMCLKRatio"           , $type: U16 }, // [AT] only used by Bios
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
atom.$addStruct({
  $name: "TableAttribute",
  $members: [
    { $name: "WSSizeInBytes"                  , $type: U16 , $bitSize: 8 }, // Size of workspace in Bytes (in multiple of a dword).
    { $name: "PSSizeInBytes"                  , $type: U16 , $bitSize: 7 }, // Size of parameter space in Bytes (multiple of a dword).
    { $name: "UpdatedByUtility"               , $type: U16 , $bitSize: 1 }  // Table updated by utility flag.
  ]
});

// ATOM_COMMON_ROM_COMMAND_TABLE_HEADER
atom.$addStruct({
  $name: "CommonCommandTableHeader",
  $extend: atom.CommonTableHeader,
  $members: [
    { $name: "TableAttribute"                 , $type: atom.TableAttribute }
  ]
});

// ============================================================================
// [Master Data]
// ============================================================================

// ATOM_MASTER_DATA_TABLE {
//   ATOM_COMMON_TABLE_HEADER
//   ATOM_MASTER_LIST_OF_DATA_TABLES
// }
atom.$addStruct({
  $name: "MasterDataTable",
  $extend: atom.CommonTableHeader,
  $members: [
    { $name: "UtilityPipeLine"                , $type: U16 },
    { $name: "MultimediaCapabilityInfoOffset" , $type: U16 , $ref: atom.MultimediaCapabilityInfo, $refType: "absolute", $as: "MultimediaCapabilityInfo" },
    { $name: "MultimediaConfigInfoOffset"     , $type: U16 , $ref: atom.MultimediaConfigInfo    , $refType: "absolute", $as: "MultimediaConfigInfo" },
    { $name: "StandardVESATimingOffset"       , $type: U16 , $ref: atom.ModeTiming              , $refType: "absolute", $as: "StandardVESATiming"   },
    { $name: "FirmwareInfoOffset"             , $type: U16 , $ref: atom.FirmwareInfo            , $refType: "absolute", $as: "FirmwareInfo"         },
    { $name: "DACInfoOffset"                  , $type: U16 , $ref: atom.DACInfo                 , $refType: "absolute", $as: "DACInfo"              },
    { $name: "LCDInfoOffset"                  , $type: U16 , $ref: atom.LCDInfo                 , $refType: "absolute", $as: "LCDInfo"              },
    { $name: "TMDSInfoOffset"                 , $type: U16 , $ref: atom.TMDSInfo                , $refType: "absolute", $as: "TMDSInfo"             },
    { $name: "SMUInfoOffset"                  , $type: U16 , $ref: atom.SMUInfo                 , $refType: "absolute", $as: "SMUInfo"              },
    { $name: "SupportedDevicesInfoOffset"     , $type: U16 , $ref: atom.SupportedDevicesInfo    , $refType: "absolute", $as: "SupportedDevicesInfo" },
    { $name: "GPIOI2CInfoOffset"              , $type: U16 , $ref: atom.GPIOI2CInfo             , $refType: "absolute", $as: "GPIOI2CInfo" },
    { $name: "VRAMUsageByFirmware"            , $type: U16 },
    { $name: "GPIOPinLUT"                     , $type: U16 },
    { $name: "VESAToInternalModeLUT"          , $type: U16 },
    { $name: "GFXInfoOffset"                  , $type: U16 , $ref: atom.GFXInfo                 , $refType: "absolute", $as: "FGXInfo"              },
    { $name: "PowerPlayInfoOffset"            , $type: U16 , $ref: atom.PowerPlayInfo           , $refType: "absolute", $as: "PowerPlayInfo"        },
    { $name: "CompassionateDataOffset"        , $type: U16 , $ref: atom.CompassionateData       , $refType: "absolute", $as: "CompassionateData"    },
    { $name: "SaveRestoreInfo"                , $type: U16 },
    { $name: "PPLLSSInfo"                     , $type: U16 }, // Shared by various SW components,latest version 1.2, used to call SS_Info, change to new name because of int ASIC SS info
    { $name: "OEMInfoOffset"                  , $type: U16 , $ref: atom.OEMInfo                 , $refType: "absolute", $as: "OEMInfo"              },
    { $name: "XTMDSInfo"                      , $type: U16 , $ref: atom.XTMDSInfo               , $refType: "absolute", $as: "XTMDSInfo"            },
    { $name: "MCLKSSInfo"                     , $type: U16 }, // Shared by various SW components,latest version 1.1, only enabled when ext SS chip is used
    { $name: "ObjectInfoOffset"               , $type: U16 , $ref: atom.ObjectInfo              , $refType: "absolute", $as: "ObjectInfo"           },
    { $name: "IndirectIOAccess"               , $type: U16 },
    { $name: "MCInitParameter"                , $type: U16 }, // Only used by command table
    { $name: "ASICVDDCInfo"                   , $type: U16 },
    { $name: "ASICInternalSSInfo"             , $type: U16 }, // New tabel name from R600, used to be called "ASIC_MVDDC_Info"
    { $name: "TVVideoMode"                    , $type: U16 }, // Only used by command table
    { $name: "VRAMInfoOffset"                 , $type: U16 , $ref: atom.VRAMInfo                , $refType: "absolute", $as: "VRAMInfo" },
    { $name: "MemoryTrainingInfo"             , $type: U16 }, // Used for VBIOS and Diag utility for memory training purpose since R600. the new table rev start from 2.1
    { $name: "IntegratedSystemInfoOffset"     , $type: U16 , $ref: atom.IntegratedSystemInfo    , $refType: "absolute", $as: "IntegratedSystemInfo" },
    { $name: "ASICProfilingInfoOffset"        , $type: U16 , $ref: atom.ASICProfilingInfo       , $refType: "absolute", $as: "ASICProfilingInfo"    },
    { $name: "VoltageObjectInfoOffset"        , $type: U16 , $ref: atom.VoltageObjectInfo       , $refType: "absolute", $as: "VoltageObjectInfo"    },
    { $name: "PowerSourceInfoOffset"          , $type: U16 , $ref: atom.PowerSourceInfo         , $refType: "absolute", $as: "PowerSourceInfo"      },
    { $name: "ServiceInfoOffset"              , $type: U16 , $ref: atom.ServiceInfo             , $refType: "absolute", $as: "ServiceInfo"          }
  ]
});

atom.$addStruct({
  $extend: atom.MasterDataTable,
  $version: [1, 1]
});

// ============================================================================
// [Rom]
// ============================================================================

// ATOM_ROM_HEADER
atom.$addStruct({
  $name: "RomTable",
  $extend: atom.CommonTableHeader,
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
    { $name: "SubsystemVendorID"              , $type: U16 },
    { $name: "SubsystemID"                    , $type: U16 },
    { $name: "PCIInfoOffset"                  , $type: U16 },
    { $name: "MasterCommandTableOffset"       , $type: U16 , $ref: atom.MasterCommandTable, $refType: "absolute" , $as: "MasterCommandTable" },
    { $name: "MasterDataTableOffset"          , $type: U16 , $ref: atom.MasterDataTable   , $refType: "absolute" , $as: "MasterDataTable"    },
    { $name: "ExtendedFunctionCode"           , $type: U8  },
    { $name: "Reserved"                       , $type: U8  }
  ]
});

atom.$addStruct({
  $extend: atom.RomTable,
  $version: [1, 1]
});

// ATOM_ROM_HEADER_V2_1
atom.$addStruct({
  $extend: atom["RomTable$1.1"],
  $version: [2, 1],
  $members: [
    { $name: "PSPDirTableOffset"              , $type: U32 }
  ]
});

// ============================================================================
// [VBIOS]
// ============================================================================

// VBIOS_ROM_HEADER
atom.$addStruct({
  $name: "VBIOSTable",
  $members: [
    { $name: "PCIRomSignature"                , $type: U16 },
    { $name: "PCIRomSizeIn512Bytes"           , $type: U8  },
    { $name: "JumpCoreMainInitBIOS"           , $type: U8  },
    { $name: "LabelCoreMainInitBIOS"          , $type: U16 },
    { $name: "PCIReservedSpace"               , $type: Arr, $length: 18, $ref: U8 },
    { $name: "PCIDataStructureOffset"         , $type: U16 },
    { $name: "Reserved1"                      , $type: U32 },
    { $name: "StrIBM"                         , $type: Str, $length: 3  },
    { $name: "CheckSum"                       , $type: Arr, $length: 14, $ref: U8 },
    { $name: "BIOSMsgNumber"                  , $type: U8  },
    { $name: "Str761295520"                   , $type: Str, $length: 16 },
    { $name: "LabelCoreVPOSTNoMode"           , $type: U16 },
    { $name: "SpecialPostOffset"              , $type: U16 },
    { $name: "SpecialPostImageSizeIn512Bytes" , $type: U8  },
    { $name: "Reserved2"                      , $type: U24 },
    { $name: "RomTableOffset"                 , $type: U16, $ref: atom.RomTable, $as: "RomTable" },
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
  ? [module, "exports", require("./binlib.js")] : [this, "atom", this.binlib]);
