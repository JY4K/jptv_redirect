import { getChannels, buildLogoUrl } from '../utils/helpers.js';

export default async function handler(req, res) {
  // 禁止订阅文件被缓存，确保用户获取最新列表
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  const groups = getChannels();
  const baseUrl = `https://${req.headers.host}`;

  // 头部信息
  let m3u = "#EXTM3U url-tvg=\"https://epg.freejptv.com/jp.xml,https://animenosekai.github.io/japanterebi-xmltv/guide.xml\" tvg-shift=0 m3uautoload=1\n";

  if (!groups || groups.length === 0) {
    // 无数据时不显示任何内容，或仅显示提示
    m3u += `#EXTINF:-1 group-title="提示",无频道数据\n`;
    m3u += `http://0.0.0.0/\n`; // 无效地址
  } else {
    groups.forEach(g => {
      if(Array.isArray(g.channels)) {
        g.channels.forEach(ch => {
            // 过滤无效频道
            if (!ch.name || !ch.url) return;

            const logo = buildLogoUrl(ch.logo);
            const tvgId = ch.id || ch.name;
            // 指向 jptv.php 进行重定向
            m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${ch.name}" tvg-logo="${logo}" group-title="${g.group}",${ch.name}\n`;
            m3u += `${baseUrl}/jptv.php?id=${ch.id}\n`;
        });
      }
    });
  }

  res.status(200).send(m3u);
}