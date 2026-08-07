/* Where the browser is, which is not the same answer everywhere.

   Every bench in `tools/` drives a headless Chromium. They each used to name
   one explicitly — `/opt/pw-browsers/chromium`, which is where it lives in the
   container these were written in and nowhere else. On any other machine that
   is a path to nothing, and eleven harnesses failed identically on a fresh
   clone with an error about an executable that does not exist.

   Letting Playwright find its own browser is the right default: `npx playwright
   install chromium` puts one where Playwright expects it. But the container's
   copy predates the installed Playwright and sits at a path its own resolution
   no longer looks in, so the explicit answer has to survive as a fallback.

   So: an override for anyone who wants one, the container's path if it is
   really there, and otherwise nothing at all — which is Playwright's own
   default and what any normal install wants. */
import { existsSync } from 'fs';

const CONTAINER = '/opt/pw-browsers/chromium';

/* Spreadable, so a caller keeps its own launch options:
     chromium.launch({ ...chromiumPath(), args: [...] })          */
export function chromiumPath() {
  const exe = process.env.CHROMIUM_PATH
    || (existsSync(CONTAINER) ? CONTAINER : null);
  return exe ? { executablePath: exe } : {};
}

/* And the whole launch, for callers that would rather not import Playwright
   themselves — which lets a tool that only *sometimes* needs a browser avoid
   paying for it when it does not. */
export async function launch(opts) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    const err = new Error('playwright is not installed');
    err.code = 'NO_PLAYWRIGHT';
    throw err;
  }
  return chromium.launch(Object.assign({ ...chromiumPath() }, opts));
}
