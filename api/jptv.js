import { getChannels, getFastestUrl } from '../utils/helpers.js';

export default async function handler(req, res) {
  const { id } = req.query;

  // 1. 获取数据
  const channelsData = getChannels();

  // 2. 查找对应 ID 的频道
  const target = channelsData
    .flatMap(g => g.channels)
    .find(c => c.id === id);

  // 3. 频道不存在或无 URL，直接 404
  if (!target || !target.url) {
    return res.status(404).send('Channel Not Found');
  }

  // 确保 url 是数组
  const urls = Array.isArray(target.url) ? target.url : [target.url];
  const validUrls = urls.filter(u => u && u.startsWith('http'));

  if (validUrls.length === 0) {
    return res.status(404).send('No valid stream source');
  }

  // 4. 设置基础响应头
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 302 临时重定向，允许客户端缓存 60秒，避免频繁请求服务器
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');

  // --- ⚡ 性能优化核心 ---

  // 情况 A: 只有一个源 -> 无需测速，直接重定向 (极速模式)
  if (validUrls.length === 1) {
    return res.redirect(302, validUrls[0]);
  }

  // 情况 B: 多个源 -> 触发竞速 (Promise.any)
  const winner = await getFastestUrl(validUrls);

  if (winner) {
    return res.redirect(302, winner);
  }

  // 情况 C: 竞速全失败 -> 404 (根据要求不显示测试卡)
  return res.status(404).send('All streams are down');
}