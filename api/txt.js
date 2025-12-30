import { getChannels } from '../utils/helpers.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  const baseUrl = `https://${req.headers.host}`;
  const groups = getChannels();

  let txtContent = [];

  if (groups && groups.length > 0) {
    groups.forEach(g => {
      if(Array.isArray(g.channels) && g.channels.length > 0) {
        txtContent.push(`${g.group},#genre#`);
        g.channels.forEach(ch => {
          if (ch.name && ch.url) {
            txtContent.push(`${ch.name},${baseUrl}/jptv.php?id=${ch.id}`);
          }
        });
        // 在每个分组结束后添加一个空行
        txtContent.push('');
      }
    });
  } else {
    txtContent.push('提示,#genre#');
    txtContent.push('无数据,http://0.0.0.0/');
  }

  res.status(200).send(txtContent.join('\n'));
}
