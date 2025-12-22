import { getChannels, buildLogoUrl } from '../utils/helpers.js';
import config from '../utils/config.js';

export default async function handler(req, res) {
  // 严格禁止缓存
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  const groups = getChannels();
  const baseUrl = `https://${req.headers.host}`;

  let m3u = "#EXTM3U x-tvg-url=\"https://live.fanmingming.com/e.xml\"\n";

  if (!groups || groups.length === 0) {
    m3u += `#EXTINF:-1 group-title="提示",无数据\n`;
    m3u += `${baseUrl}/${config.fallbackFileName}\n`;
  } else {
    groups.forEach(g => {
      if(Array.isArray(g.channels)) {
        g.channels.forEach(ch => {
            const logo = buildLogoUrl(ch.logo);
            const tvgId = ch.id || ch.name;
            m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${g.group}",${ch.name}\n`;
            m3u += `${baseUrl}/jptv.php?id=${ch.id}\n`;
        });
      }
    });
  }

  res.status(200).send(m3u);
}
