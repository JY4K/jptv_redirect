import { getChannels } from '../utils/helpers.js';
import config from '../utils/config.js';

export default async function handler(req, res) {
  // 严格禁止缓存，确保实时性
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store'); // Vercel 特有头部，禁止 CDN 缓存
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  const baseUrl = `https://${req.headers.host}`;
  const groups = getChannels();

  let txtContent = [];

  if (!groups || groups.length === 0) {
    txtContent.push('提示,#genre#');
    txtContent.push(`无数据,${baseUrl}/${config.fallbackFileName}`);
  } else {
    groups.forEach(g => {
      if(Array.isArray(g.channels) && g.channels.length > 0) {
        txtContent.push(`${g.group},#genre#`);
        g.channels.forEach(ch => {
          txtContent.push(`${ch.name},${baseUrl}/jptv.php?id=${ch.id}`);
        });
      }
    });
  }

  res.status(200).send(txtContent.join('\n'));
}
