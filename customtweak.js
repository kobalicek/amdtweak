// This is an example that you can modify to test `amdtweak` package.
"use strict";

const iofs = require("./lib/iofs.js");
const vbios = require("./lib/vbios.js");

// Change to true if you want to overwrite your PP table(s).
//   (you must execute this script as root in that case)
const OVERWRITE = false;

// Name of AMDGPU driver (either AMDGPU or AMDGPU-PRO).
const AMDGPU_DRIVER_NAME = "amdgpu";

// ============================================================================
// Called for each PP table of each AMDGPU found in your running system.
function modifyPPTable(cardId, pp) {
  console.log(`Card '${cardId}' ` + JSON.stringify(pp));
  // ... (do your modification here) ...
}
// ============================================================================

function pathOfCard(cardId) {
  return `/sys/class/drm/card${cardId}`;
}

function log(message) {
  console.log(message);
}

function getListOfAMDGPUs() {
  var cards = [];
  var cardId = 0;

  for (;;) {
    const props = iofs.readProperties(pathOfCard(cardId) + "/device/uevent");
    if (!props) break;

    if (props.DRIVER === AMDGPU_DRIVER_NAME)
      cards.push(cardId);
    cardId++;
  }

  return cards;
}

function main() {
  getListOfAMDGPUs().forEach(function(cardId) {
    const ppFileName = pathOfCard(cardId) + "/device/pp_table";
    try {
      const buf = iofs.readFile(ppFileName);
      const pp = vbios.$readObject({ buffer: buf, type: vbios.PowerPlayTable, log: log });

      modifyPPTable(cardId, pp);
      vbios.$updateObject({ buffer: buf, object: pp, log: log });

      if (OVERWRITE)
        iofs.writeFile(ppFileName, buf);
    }
    catch (ex) {
      console.log(ex.toString());
    }
  });
}

main();
