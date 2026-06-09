// electron-builder afterPack hook — reliably stamp the Windows exe icon.
//
// electron-builder's built-in rcedit step intermittently fails with
// "Unable to commit changes": Windows Defender briefly locks the freshly
// written .exe while it scans it, so the resource write can't commit. The
// result is the app exe (and any shortcut pointing at it) showing the default
// Electron icon. This hook runs right after the app is packed into
// win-unpacked and retries `rcedit --set-icon` until the lock clears, so
// build/icon.ico actually lands on the exe before the target (portable/nsis)
// wraps it.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findRcedit() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  try {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'rcedit-x64.exe');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {
    /* cache dir missing */
  }
  return null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const productFilename =
    (context.packager && context.packager.appInfo && context.packager.appInfo.productFilename) || "Wanderer's Guide";
  const exe = path.join(context.appOutDir, `${productFilename}.exe`);
  const icon = path.join(__dirname, '..', 'build', 'icon.ico');

  if (!fs.existsSync(exe)) {
    console.log('[afterPack] app exe not found, skipping icon set:', exe);
    return;
  }
  if (!fs.existsSync(icon)) {
    console.log('[afterPack] build/icon.ico not found, skipping icon set');
    return;
  }
  const rcedit = findRcedit();
  if (!rcedit) {
    console.log('[afterPack] rcedit-x64.exe not found in winCodeSign cache; skipping icon set');
    return;
  }

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      execFileSync(rcedit, [exe, '--set-icon', icon], { stdio: 'ignore', timeout: 30000 });
      console.log(`[afterPack] icon set on "${productFilename}.exe" (attempt ${attempt})`);
      return;
    } catch (e) {
      if (attempt === 10) {
        console.error('[afterPack] failed to set icon after 10 attempts:', e.message);
        return;
      }
      await sleep(1500); // let Defender release the exe, then retry
    }
  }
};
