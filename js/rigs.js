/* ============================================================
   The rig store — which creatures are drawn from data instead of from code.

   Empty by design. Every creature ships as a hand-written painter, and stays
   that way until somebody draws a rig for it in the bestiary's studio and
   pastes the result in here. Where a rig exists it stands in for the painter;
   where none does, nothing about that creature changes. There is no automatic
   conversion and no half state: a creature is drawn by its function or by its
   rig, and which one is a line in this file.

   To add one: design it in the studio, press Copy, and paste the entry below.

     RIGS.deer = { parts: [...], poses: {...} };

   Drafts made in the studio live in localStorage and are visible only to the
   bestiary. Nothing reaches the window until it is written down here, which
   keeps the piece's promise that it is only ever the files you can read.
   ============================================================ */

const RIGS = {
  // deer: { parts: [ … ], poses: { rest: { … }, graze: { … } } },
};

export { RIGS };
