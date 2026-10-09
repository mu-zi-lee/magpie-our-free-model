import fs from 'node:fs';
import path from 'node:path';

// CLI login opens a browser even in fixture runs. Intercept only inside the
// smoke test's child environment so tests never open tabs on the user's desktop.
export function quietBrowserEnv(scratch, env) {
  if (process.platform === 'win32') throw new Error('Browser isolation requires a POSIX smoke-test environment');
  const directory = path.join(scratch, 'browser-stubs');
  fs.mkdirSync(directory, { mode: 0o700 });
  for (const command of ['open', 'xdg-open', 'termux-open-url']) {
    fs.writeFileSync(path.join(directory, command), '#!/bin/sh\nprintf "intercepted\\n" >> "$OFM_SMOKE_BROWSER_LOG"\n', { mode: 0o700 });
  }
  return { ...env, PATH: `${directory}${path.delimiter}${env.PATH ?? ''}`,
    OFM_SMOKE_BROWSER_LOG: path.join(scratch, 'browser-intercepted.log') };
}
