// This is an example that you can modify to test `amdtweak` package.
"use strict";

const fs = require("fs");
const atom = require("./lib/atom.js");
const iofs = require("./lib/iofs.js");

// Change to true if you want to overwrite your PP table(s).
//   (you must execute this script as root in that case)
const OVERWRITE = false;

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

function getListOfAMDGPUs() {
  const AMDGPU_DRIVER_NAME = "amdgpu";

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
      const buf = fs.readFileSync(ppFileName);
      const pp = atom.$decomposeData(buf, 0, atom.PowerPlayInfo);

      modifyPPTable(cardId, pp);
      atom.$mergeData(buf, 0, null, pp);

      if (OVERWRITE)
        fs.writeFileSync(ppFileName, buf);
    }
    catch (ex) {
      console.log(ex.toString());
    }
  });
}

main();
