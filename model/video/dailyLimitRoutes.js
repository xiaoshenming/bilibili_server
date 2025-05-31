const express = require('express');
const router = express.Router();
const authorize = require("../auth/authUtils"); // 您的授权中间件
const { checkDailyDownloadLimit } = require('./videoUtils');
const redis = require('../../config/redis');

/**
 * @api {get} /api/video/daily-limit-status
 * @description 查询用户当前的每日下载申请限制状态
 * @access Protected - 需要用户登录
 */
router.get('/daily-limit-status', authorize(['1', '2', '3', '4']), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const userRole = req.user.role;
    
    // 获取今日申请次数
    const today = new Date().toISOString().split('T')[0];
    const redisKey = `download_requests:${userId}:${today}`;
    const currentCount = parseInt(await redis.get(redisKey) || 0);
    
    // 检查限制状态
    const limitStatus = await checkDailyDownloadLimit(userId, userRole, redis);
    
    // 根据权限等级设置每日限制
    const dailyLimits = {
      '1': 1,    // 1级权限：每天1个
      '2': 10,   // 2级权限：每天10个
      '3': 100,  // 3级权限：每天100个
      '4': -1    // 4级权限：无限制
    };
    
    const totalLimit = dailyLimits[userRole] || 1;
    const roleNames = { '1': '1级', '2': '2级', '3': '3级', '4': '4级' };
    
    res.status(200).json({
      code: 200,
      message: '获取每日限制状态成功',
      data: {
        userRole: userRole,
        roleName: roleNames[userRole],
        totalLimit: totalLimit === -1 ? '无限制' : totalLimit,
        usedCount: currentCount,
        remaining: limitStatus.remaining === -1 ? '无限制' : limitStatus.remaining,
        canApply: limitStatus.allowed,
        resetTime: '每日00:00重置'
      }
    });
  } catch (error) {
    console.error('获取每日限制状态失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取每日限制状态失败',
      data: null
    });
  }
});

module.exports = router;