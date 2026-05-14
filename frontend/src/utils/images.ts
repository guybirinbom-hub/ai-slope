import { toLabel } from './strings';

export async function getShapeIcon(content: string) {
  const res = await fetch(`https://api.dicebear.com/7.x/shapes/svg?seed=${content}`);
  return res.ok ? await res.text() : '';
}

export async function getRingIcon(content: string) {
  // await sleep(100); // to avoid rate limiting
  const res = await fetch(`https://api.dicebear.com/7.x/rings/svg?seed=${content}`);
  return res.ok ? await res.text() : '';
}

export async function isValidImage(url?: string): Promise<boolean> {
  if (!url) return false;
  // Accept any http(s):// URL with a host; the old pattern required a TLD
  // (`.com` etc.) which excluded `http://localhost:9000` and similar paths
  // we use for local self-hosted storage.
  const urlPattern = /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?(\/\S*)?$/;
  if (url.trim().match(urlPattern)) {
    return new Promise((resolve, reject) => {
      let img = new Image();
      img.onload = function () {
        resolve(true);
      };
      img.onerror = function () {
        resolve(false);
      };
      img.src = url;
    });
  } else {
    return false;
  }
}

export async function preloadImage(url?: string | null): Promise<void> {
  if (!url || !url.trim()) return;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
}

export async function findCreatureImage(name: string): Promise<string | undefined> {
  if (!name.trim()) return undefined;
  const aonPath = `https://2e.aonprd.com/Images/Monsters/${toLabel(name).replace(/ /g, '_')}.webp`;
  if (await isValidImage(aonPath)) {
    return aonPath;
  } else {
    return undefined;
  }
}
