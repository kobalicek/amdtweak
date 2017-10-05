AMD Tweak
---------

This is a library that can be used to manipulate data used by AMDGPU's ATOM BIOS and PowerPlay (PP). This package is designed to provide a foundation to load, modify, and save binary data used by AMDGPU and provides a few scripts that show how the library can be used. This project is mostly for people who want to experiment and write their own scripts.

The project started by supporting Polaris GPUs, but since the structure definitions have support for versioning any GPU can be supported if the required tables are provided.

The library part of this tool is written in JS and is cross-platform. You can use it on any OS and also within a browser. However, scripts provided at the root of the project are designed only for Linux and for AMD GPUs (they use sysfs to access the VROM and PP tables).

There is a [vbiosed](https://kobalicek.com/vbiosed) project that brings VBIOS editing into a browser, however, it can only explore existing VBIOS and PowerPlay tables at the moment.

Disclaimer
----------

**Use at your own risk! Improper use of this tool can damage your hardware!**

**I Don't have AMDGPUs anymore so this tool is currently untested. If you encounter a bug please report it and if possible try to fix it, the whole tool can be debugged easily.**

Install & Use
-------------

The package is self-containing, you only need node.js to use it:

```bash
$ git clone https://github.com/kobalicek/amdtweak.git
$ cd amdtweak
$ ./amdtweak
```

Library Design
--------------

  * `/`    - Root directory, provides documentation and few examples
  * `/lib` - Library
    * `/lib/binlib.js` - Library that can be used to describe C-like structures and that can serialize and deserialize them to/from JSON, respectively.
    * `/lib/iofs.js` - Lightweight library that simplifies accessing files with helpers for making sysfs access easier.
    * `/lib/vbios.js` - Library that provides structures used by ATOM BIOS and PowerPlay (PP). Renamed to vbios.js so it can support Intel and NVidia BIOSes in the future.

SysFS - Basics
--------------

(These are notes for Linux users only)

AMDGPU driver exposes some functionality via the SysFS interface. GPU drivers create links at `/sys/class/drm` directory for each GPU the kernel loaded. You can simply list that directory and check if your cards (`card0`, `card1`, etc) are listed:

```bash
$ ls -ll /sys/class/drm
```

which should list all cards:

```
... (only showing the interesting output) ...
lrwxrwxrwx 1 root root    0 Jun 19 23:33 card0 -> ../../devices/pci0000:00/0000:00:02.0/drm/card0
lrwxrwxrwx 1 root root    0 Jun 19 23:33 card1 -> ../../devices/pci0000:00/0000:00:01.0/0000:01:00.0/drm/card1
lrwxrwxrwx 1 root root    0 Jun 19 23:33 card2 -> ../../devices/pci0000:00/0000:00:1c.4/0000:03:00.0/drm/card2
... (only showing the interesting output) ...
```

The files listed are actually symlinks pointing to some PCI addresses, but that's a detail. If multiple GPUs from multiple vendors are present you can check each one by reading its device/uevent file:

```bash
$ cat /sys/class/drm/card0/device/uevent
DRIVER=i915 # This is a name of an INTEL driver.
PCI_CLASS=30000
PCI_ID=8086:1912
PCI_SUBSYS_ID=1462:7970
PCI_SLOT_NAME=0000:00:02.0
MODALIAS=pci:v00008086d00001912sv00001462sd00007970bc03sc00i00

$ cat /sys/class/drm/card1/device/uevent
DRIVER=amdgpu # This is a name of an AMDGPU/AMDGPU-PRO driver.
PCI_CLASS=30000
PCI_ID=1002:67DF
PCI_SUBSYS_ID=174B:E347
PCI_SLOT_NAME=0000:01:00.0
MODALIAS=pci:v00001002d000067DFsv0000174Bsd0000E347bc03sc00i00
```

There are many files that can be used to read more information about the driver and the card status. We are mostly interested in these (exposed by the AMDGPU driver):

  * `device/pp_dpm_pcie` - List of PCI Express states and current state
  * `device/pp_dpm_mclk` - List of memory clock states and current state
  * `device/pp_dpm_sclk` - List of system/GPU clock states and current state
  * `device/pp_table` - Can be used to read and write AMDGPU's PowerPlay information. PowerPlay is set of data structures that contain a lot of information including clock settings, voltage, and fan settings. Please note that only root can write to this file.
  * `device/rom` - Can be used to read BIOS/ROM of the driver. This is a universal PCIE file that is provided by many drivers, it's not strictly AMDGPU related.

A lot of people use also `device/pp_mclk_od` and `device/pp_sclk_od` for overclocking, but these only allow to increase the frequency and cannot be used to control voltage, so we will not discuss these two in detail. Manipulating PowerPlay table is much better and provides much more options, but is also much more difficult without good tools.

SysFS - Manipulating PowerPlay (PP) Table
-----------------------------------------

We know where the PowerPlay table is stored so let's manipulate it. You only need node.js and copy of this repository. The script assumes you place the example file in a root directory of the `amdtweak` package (or anywhere else and change the require path).

```js
const fs = require("fs");
const vbios = require("./lib/vbios.js");

// Just what the script should do.
const DUMP = true;
const OVERWRITE = false;

const CARD_ID = 1;
const CARD_PP = `/sys/class/drm/card${CARD_ID}/device/pp_table`;

const buf = fs.readFileSync(CARD_PP);

// Decompose `buf` into a JS object:
const obj = vbios.$readObject({ buffer: buf, type: vbios.PowerPlayTable });

// Now, if everything went ok we will have an object describing the
// whole PP table. You can do whatever you want with it, including
// dumping its content, modifying it, etc.
if (DUMP)
  console.log(JSON.stringify(obj, null, 2));

// If you want to modify it, you can simply change the fields it
// provides. For example to change max TDP, which is stored in
// PowerTuneTable (subtable), do the following:
obj.PowerTuneTable.TDP = 90;

// We modified the JS object and the data was not been synced with
// the original buffer yet. To save all values back to the buffer
// you have to call `$updateObject()`:
vbios.$updateObject({ buffer: buf, object: obj });

// Now the `buf` contains new changed data, the only thing to do
// next is to write it back.
if (OVERWRITE)
  fs.writeFileSync(CARD_PP, buf);
```

You can see yourself that the approach is completely programmable and can be scripted easily. Since you change the data by manipulating members of JS objects it's very easy to create scripts that make non-trivial modifications to the existing data. Also, by reading the table and merging the data back there will never be any data loss caused by unknown tables as unknown data will simply not be part of the `obj` and won't be merged back (would stay as is).

SysFS - Restoring the PowerPlay Table
-------------------------------------

Once the PowerPlay table has been modified by writing to `pp_table` file there is a no way back. The `pp_table` content is temporary and will be cleared when the driver reloads or the machine restarts, however, the driver doesn't expose any functionality to restore the table to the content stored in driver's ROM. However, there is a way to read the ROM, extract the table from it and write it to `pp_table`.

Firstly, we should learn how to read the drivers ROM based on the Linux documentation about [sysfs-pci](https://www.kernel.org/doc/Documentation/filesystems/sysfs-pci.txt):

```bash
# To read ROM you first need to write `1` to it, then read it, and then write
# `0` to it as described in the documentation. The reason is that the content
# is not provided by default, by writing `1` to it you are telling the driver
# to make it accessible.
CARD_ID=1
CARD_ROM="/sys/class/drm/card${CARD_ID}/device/rom"
FILE_ROM="amdgpu-rom.bin"

echo 1 > $CARD_ROM
cat $CARD_ROM > $FILE_ROM
echo 0 > $CARD_ROM
echo "Saved as ${FILE_ROM}"
```

The script was written in bash, but can be rewritten to any other language easily. Let's do this in node.js and check if the `pp_table` the card uses is the same as the `pp_table` stored in its BIOS:

```js
const fs = require("fs");
const vbios = require("./lib/vbios.js");

const CARD_ID = 1;
const CARD_PP = `/sys/class/drm/card${CARD_ID}/device/pp_table`;
const CARD_BIOS = `/sys/class/drm/card${CARD_ID}/device/rom`;

// Tell the driver we intend to read its BIOS.
fs.writeFileSync(CARD_BIOS, "1");

const rawPPData = fs.readFileSync(CARD_PP);
const biosData = fs.readFileSync(CARD_BIOS);

// Tell the driver we don't need to read its ROM anymore.
fs.writeFileSync(CARD_BIOS, "0");

const biosPPData = vbios.extractPowerPlayFromVBIOS(biosData);
if (biosPPData.equals(rawPPData))
  console.log(`The card ${CARD_ID} is using stock PowerPlay table.`);
else
  console.log(`The card ${CARD_ID} is using modified PowerPlay table.`);
```

To restore the PowerPlay table to its BIOS version it would be just a matter of overwriting the `pp_table`:

```js
fs.writeFileSync(CARD_PP, biosPPData);
```

AMDTweak Tool
-------------

The `amdtweak` tool is bundled with `amdtweak` package and can be used to perform basic manipulation of PP tables. It's actually a command runner that sees each argument starting with `--` as a command and all next arguments (until the next --command) as its parameters. By using this tool you can load, modify, and save PowerPlay tables of each GPU programatically. You can even add new commands easily by just adding a function to the `Commander` class.

The tool should be seen as an example of what's possible with the library, it's not a definite solution to PP tables on Linux. The tool can also be used to extract the BIOS of your GPU and to extract a stock PowerPlay (PP) table from that BIOS.

Basic usage:

```bash
$ ./amdtweak --verbose \
             --card @ \
             --read-card-pp \
             --print
```

The command above would print the content of all PP tables of all AMDGPU's available as JSON. The output would look like:

```
Card '1' selected
Card '2' selected
Card '1' PP data loaded from '/sys/class/drm/card1/device/pp_table'
Card '2' PP data loaded from '/sys/class/drm/card2/device/pp_table'
Card '1': {
  "StructureSize": 820,
  "TableFormatRevision": 7,
  "TableContentRevision": 1,
  "RevisionId": 0,
  "TableSize": 77,
  "GoldenPPId": 1546,
  "GoldenRevision": 9416,
  "FormatId": 25,
  "VoltageTime": 0,
  "PlatformCaps": 16941056,
  "SCLKMaxOD": 200000,
  "MCLKMaxOD": 225000,
  "PowerControlLimit": 50,
  "UlvVoltageOffset": 50,
  "StateTableOffset": 77,
  "StateTable": {
    ... (omitted) ...
  }
}
Card '2': {
  ... (omitted) ...
}
```

The following command would do a simple modification to all cards from index 0 to 1:

```bash
$ ./amdtweak --verbose \
             --card 0-1 \
             --read-card-pp \
             --set PowerTuneTable.TDP=90 \
             --write-card-pp
```

The tool is still in development, to show a basic usage just execute it without any arguments:

```
$ ./amdtweak

Usage:
  amdtweak [commands...]

Commands:
  --card X               - Select card to be used for all operations:
         @               - Select all available cards
         X-Y             - Select all available cards between X and Y, inclusive
         X,Y,...         - Select X, Y, possibly more cards

  --read-bios-pp         - Read a PowerPlay table from each selected card's BIOS
  --read-card-pp         - Read a PowerPlay table from each selected card
  --write-card-pp        - Write a PowerPlay table to each selected card

  --read-file-pp FILE    - Read a PowerPlay table from file
  --write-file-pp FILE   - Write a PowerPlay table to file

  --extract-bios FILE    - Extract BIOS of each selected card and store to FILE
  --extract-bios-pp FILE - Extract PP from BIOS of each selected card and store to FILE

  --set PROPERTY=VALUE   - Set a PROPERTY of each loaded PowerPlay table to VALUE
  --print                - Print each PowerPlay table as JSON
```

Playground
----------

There is also a [customtweak.js](./customtweak.js) file that can be used as a playground and to test your own non-trivial PowerPlay modification.

More
----

The `amdtweak` package is not finished. You can help with the development by donating or by contributing! The goal of the tool is to have a reliable package that can be used to tune AMDGPUs for different purposes (gaming, mining, etc...) and to have all VBIOS tables in a format that can be easily introspected and extended in the future. The first version of this tool was written in C++ and used a macro-based approach to define structures that can be inspected dynamically, but it quickly turned into an insane solution. So this is a second version that uses node.js and `binlib.js` library that was developed as a part of `amdtweak` and provides a foundation to define all the structures required (and also structure versioning, which is used by many tables).

Other Projects and Resources
----------------------------

AMDGPU:

  * [AMDGPU Linux Driver](https://github.com/torvalds/linux/tree/master/drivers/gpu/drm/amd) - Most tables come from this driver.

VBIOS and PP tweaks:

  * [OhGodATool](https://github.com/OhGodACompany/OhGodATool) - Can modify some values in VBIOS/PP.
  * [PolarisBiosEditor](https://github.com/caa82437/PolarisBiosEditor) - Can modify some values in VBIOS/PP (Windows only).

Memory timing:
  * [OhGodADecode](https://github.com/OhGodACompany/OhGodADecode) - Decodes an entire timing strap for an AMD VBIOS.
  * [StrapRead](https://github.com/nerdralph/strapread) - AMD GCN BIOS strap reader.
  * [GDDR5 memory timing details](https://nerdralph.blogspot.com/ncr/2017/05/gddr5-memory-timing-details.html)

Donate
------

Please donate if you found this project useful and would like to keep it active in the future. It's free for anyone but it took a lot of time to put all the tables and utilities together.

You can donate to these addresses:

  * DCR: DsfjC2mCGsq8jPLmUYSgAYJ5x4f2rNbCjQ9
  * ETH: 0x19ff6f0ad1708293ef6cca24c75a59dad498a0ef
  * ETC: 0xe9c5a23f2e1f41ab686796832e2d44b8b7fbd267
  * ZEC: t1WiKEdq8268MaoUrNyghHiJCZxF4HDDX8d

License
-------

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org/>
