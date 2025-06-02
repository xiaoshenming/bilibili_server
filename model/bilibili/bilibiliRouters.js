const express = require("express");
const router = express.Router();
const bilibiliUtils = require("./bilibiliUtils");
const authorize = require("../auth/authUtils"); // 授权中间件
const axios = require("axios");

// B站请求头
const BILIBILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
  'Accept-Encoding': 'gzip, deflate',
  'Referer': 'https://www.bilibili.com/',
  'Connection': 'keep-alive'
};

// --- B站登录相关接口 ---

/**
 * 生成B站登录二维码
 * POST /api/bilibili/generate-qrcode
 * 需要用户登录
 */
router.post("/generate-qrcode", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id; // 从JWT中获取用户ID
    
    const result = await bilibiliUtils.generateBilibiliQRCode(userId);
    
    res.json({
      code: 200,
      message: "二维码生成成功",
      data: result
    });
  } catch (error) {
    console.error("生成B站二维码失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "生成二维码失败",
      data: null
    });
  }
});

/**
 * 获取B站登录状态
 * GET /api/bilibili/login-status/:sessionId
 * 需要用户登录
 */
router.get("/login-status/:sessionId", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const status = await bilibiliUtils.getBilibiliLoginStatus(sessionId);
    
    res.json({
      code: 200,
      message: "获取状态成功",
      data: status
    });
  } catch (error) {
    console.error("获取B站登录状态失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "获取状态失败",
      data: null
    });
  }
});

/**
 * 获取哔哩哔哩登录鉴权信息（专为鸿蒙端设计）
 * GET /api/bilibili/auth-info
 * 需要用户登录
 * 返回当前用户的活跃B站账号的完整鉴权信息
 */
router.get("/auth-info", authorize(["1", "2", "3", "4"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    
    // 获取用户的活跃B站账号
    const activeAccount = await bilibiliUtils.getActiveBilibiliAccount(userId);
    
    if (!activeAccount) {
      return res.json({
        code: 404,
        message: "未找到活跃的哔哩哔哩账号",
        data: null
      });
    }
    
    // 返回鸿蒙端需要的鉴权信息
    const authInfo = {
      dedeuserid: activeAccount.dedeuserid,
      bili_jct: activeAccount.bili_jct,
      cookie_string: activeAccount.cookie_string,
      nickname: activeAccount.nickname,
      avatar: activeAccount.avatar,
      login_time: activeAccount.login_time,
      expire_time: activeAccount.expire_time,
      // 解析Cookie为对象格式，方便鸿蒙端使用
      cookies: parseCookieString(activeAccount.cookie_string)
    };
    
    res.json({
      code: 200,
      message: "获取鉴权信息成功",
      data: authInfo
    });
  } catch (error) {
    console.error("获取B站鉴权信息失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "获取鉴权信息失败",
      data: null
    });
  }
});

/**
 * 获取用户的B站账号列表
 * GET /api/bilibili/accounts
 * 需要用户登录
 */
router.get("/accounts", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    
    const accounts = await bilibiliUtils.getUserBilibiliAccounts(userId);
    
    res.json({
      code: 200,
      message: "获取账号列表成功",
      data: accounts
    });
  } catch (error) {
    console.error("获取B站账号列表失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "获取账号列表失败",
      data: null
    });
  }
});

/**
 * 切换B站账号状态
 * PUT /api/bilibili/accounts/:accountId/toggle
 * 需要用户登录
 */
router.put("/accounts/:accountId/toggle", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { accountId } = req.params;
    const { isActive } = req.body;
    
    await bilibiliUtils.toggleBilibiliAccountStatus(userId, accountId, isActive);
    
    res.json({
      code: 200,
      message: "账号状态更新成功",
      data: null
    });
  } catch (error) {
    console.error("切换B站账号状态失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "状态更新失败",
      data: null
    });
  }
});

/**
 * 删除B站账号
 * DELETE /api/bilibili/accounts/:accountId
 * 需要用户登录
 */
router.delete("/accounts/:accountId", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { accountId } = req.params;
    
    await bilibiliUtils.deleteBilibiliAccount(userId, accountId);
    
    res.json({
      code: 200,
      message: "账号删除成功",
      data: null
    });
  } catch (error) {
    console.error("删除B站账号失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "删除账号失败",
      data: null
    });
  }
});

// --- B站视频解析相关接口 ---

/**
 * 解析B站视频信息
 * GET /api/bilibili/parse-video
 * 需要用户登录，使用用户的B站账号
 */
router.get("/parse-video", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { input } = req.query;
    
    if (!input) {
      return res.status(400).json({
        code: 400,
        message: "输入不能为空",
        data: null
      });
    }
    
    // 获取用户的活跃B站账号
    const bilibiliAccount = await bilibiliUtils.getActiveBilibiliAccount(userId);
    if (!bilibiliAccount) {
      return res.status(400).json({
        code: 400,
        message: "请先登录B站账号",
        data: null
      });
    }
    
    // 提取BVID
    const bvid = extractBvid(input);
    if (!bvid) {
      return res.status(400).json({
        code: 400,
        message: "无法解析BVID",
        data: null
      });
    }
    
    // 获取视频信息
    const videoInfo = await getVideoInfo(bvid, bilibiliAccount.cookie_string);
    if (!videoInfo) {
      return res.status(400).json({
        code: 400,
        message: "未能解析视频信息",
        data: null
      });
    }
    
    // 获取播放信息
    const playInfo = await getPlayInfo(bvid, videoInfo.cid, bilibiliAccount.cookie_string);
    if (!playInfo) {
      return res.status(500).json({
        code: 500,
        message: "无法获取播放信息",
        data: null
      });
    }
    
    res.json({
      code: 200,
      message: "解析成功",
      data: {
        bvid: videoInfo.bvid,
        cid: videoInfo.cid,
        title: videoInfo.title,
        desc: videoInfo.desc,
        type: videoInfo.tname,
        play_info: playInfo
      }
    });
    
  } catch (error) {
    console.error("解析B站视频失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "解析视频失败",
      data: null
    });
  }
});

/**
 * 解析B站视频详细信息（包含下载链接）
 * GET /api/bilibili/parse-videos
 * 需要用户登录，使用用户的B站账号
 */
router.get("/parse-videos", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { input } = req.query;
    
    if (!input) {
      return res.status(400).json({
        code: 400,
        message: "输入不能为空",
        data: null
      });
    }
    
    // 获取用户的活跃B站账号
    const bilibiliAccount = await bilibiliUtils.getActiveBilibiliAccount(userId);
    if (!bilibiliAccount) {
      return res.status(400).json({
        code: 400,
        message: "请先登录B站账号",
        data: null
      });
    }
    
    // 提取BVID
    const bvid = extractBvid(input);
    if (!bvid) {
      return res.status(400).json({
        code: 400,
        message: "无法解析BVID",
        data: null
      });
    }
    
    // 获取视频信息
    const videoInfo = await getVideoInfo(bvid, bilibiliAccount.cookie_string);
    if (!videoInfo) {
      return res.status(400).json({
        code: 400,
        message: "未能解析视频信息",
        data: null
      });
    }
    
    // 获取播放信息
    const playInfo = await getPlayInfo(bvid, videoInfo.cid, bilibiliAccount.cookie_string);
    if (!playInfo) {
      return res.status(500).json({
        code: 500,
        message: "无法获取播放信息",
        data: null
      });
    }
    
    res.json({
      code: 200,
      message: "解析成功",
      data: {
        videoUrl: playInfo.dash?.video?.[0]?.backupUrl?.[0] || playInfo.dash?.video?.[0]?.baseUrl,
        audioUrl: playInfo.dash?.audio?.[0]?.backupUrl?.[0] || playInfo.dash?.audio?.[0]?.baseUrl,
        bvid: videoInfo.bvid,
        aid: videoInfo.aid,
        cid: videoInfo.cid,
        tname: videoInfo.tname,
        pic: videoInfo.pic,
        title: videoInfo.title,
        desc: videoInfo.desc,
        duration: videoInfo.duration,
        pubdate: videoInfo.pubdate,
        name: videoInfo.owner?.name,
        face: videoInfo.owner?.face,
        view: videoInfo.stat?.view,
        danmaku: videoInfo.stat?.danmaku,
        reply: videoInfo.stat?.reply,
        favorite: videoInfo.stat?.favorite,
        coin: videoInfo.stat?.coin,
        share: videoInfo.stat?.share,
        like: videoInfo.stat?.like
      }
    });
    
  } catch (error) {
    console.error("解析B站视频详情失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "解析视频失败",
      data: null
    });
  }
});

/**
 * 下载B站视频
 * GET /api/bilibili/download
 * 需要用户登录，使用用户的B站账号
 */
router.get("/download", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const { bvid, cid, quality = 80 } = req.query;
    
    if (!bvid || !cid) {
      return res.status(400).json({
        code: 400,
        message: "缺少必要参数 bvid 或 cid",
        data: null
      });
    }
    
    // 获取用户的活跃B站账号
    const bilibiliAccount = await bilibiliUtils.getActiveBilibiliAccount(userId);
    if (!bilibiliAccount) {
      return res.status(400).json({
        code: 400,
        message: "请先登录B站账号",
        data: null
      });
    }
    
    // 获取播放信息
    const playInfo = await getPlayInfo(bvid, cid, bilibiliAccount.cookie_string);
    if (!playInfo) {
      return res.status(500).json({
        code: 500,
        message: "无法获取播放信息",
        data: null
      });
    }
    
    let videoUrl = null;
    const audioUrl = playInfo.dash?.audio?.[0]?.baseUrl;
    
    // 根据清晰度选择视频URL
    for (const video of playInfo.dash?.video || []) {
      if (video.id == quality) {
        videoUrl = video.baseUrl;
        break;
      }
    }
    
    // 如果没找到指定清晰度，使用第一个
    if (!videoUrl && playInfo.dash?.video?.length > 0) {
      videoUrl = playInfo.dash.video[0].baseUrl;
    }
    
    if (!videoUrl || !audioUrl) {
      return res.status(500).json({
        code: 500,
        message: "未找到视频或音频下载地址",
        data: null
      });
    }
    
    res.json({
      code: 200,
      message: "获取下载链接成功",
      data: {
        videoUrl,
        audioUrl,
        bvid,
        cid,
        quality
      }
    });
    
  } catch (error) {
    console.error("获取下载链接失败:", error);
    res.status(500).json({
      code: 500,
      message: error.message || "获取下载链接失败",
      data: null
    });
  }
});

// --- 辅助函数 ---

/**
 * 提取BVID
 * @param {string} input - 用户输入
 * @returns {string|null} BVID
 */
function extractBvid(input) {
  if (input.startsWith("https://www.bilibili.com/video/")) {
    const startIdx = input.indexOf("BV");
    const endIdx = input.indexOf("?", startIdx);
    if (endIdx === -1) {
      return input.substring(startIdx);
    }
    return input.substring(startIdx, endIdx);
  } else if (input.startsWith("BV")) {
    return input;
  }
  return null;
}

/**
 * 获取视频信息
 * @param {string} bvid - BVID
 * @param {string} cookieString - Cookie字符串
 * @returns {Object|null} 视频信息
 */
async function getVideoInfo(bvid, cookieString) {
  try {
    const response = await axios.get(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      {
        headers: {
          ...BILIBILI_HEADERS,
          'Cookie': cookieString
        }
      }
    );
    
    if (response.data && response.data.code === 0) {
      return response.data.data;
    }
    return null;
  } catch (error) {
    console.error('获取视频信息失败:', error);
    return null;
  }
}

/**
 * 获取播放信息
 * @param {string} bvid - BVID
 * @param {string} cid - CID
 * @param {string} cookieString - Cookie字符串
 * @returns {Object|null} 播放信息
 */
async function getPlayInfo(bvid, cid, cookieString) {
  try {
    const response = await axios.get(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=4048&fnver=0&fourk=1`,
      {
        headers: {
          ...BILIBILI_HEADERS,
          'Cookie': cookieString
        }
      }
    );
    
    if (response.data && response.data.code === 0) {
      return response.data.data;
    }
    return null;
  } catch (error) {
    console.error('获取播放信息失败:', error);
    return null;
  }
}

/**
 * 解析Cookie字符串为对象格式
 * @param {string} cookieString - Cookie字符串
 * @returns {Object} Cookie对象
 */
function parseCookieString(cookieString) {
  if (!cookieString) return {};
  
  const cookies = {};
  cookieString.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length === 2) {
      cookies[parts[0]] = parts[1];
    }
  });
  
  return cookies;
}

module.exports = router;