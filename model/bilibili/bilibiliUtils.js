const db = require("../../config/db");
const redis = require("../../config/redis");
const axios = require("axios");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");

// B站请求头
const BILIBILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
  'Accept-Encoding': 'gzip, deflate',
  'Referer': 'https://www.bilibili.com/',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Priority': 'u=1',
  'TE': 'trailers'
};

/**
 * 生成B站登录二维码
 * @param {number} userId - 用户ID
 * @returns {Object} 包含二维码key和图片base64的对象
 */
async function generateBilibiliQRCode(userId) {
  try {
    // 调用B站API生成二维码
    const response = await axios.get(
      'https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main_web',
      { headers: BILIBILI_HEADERS }
    );

    if (response.data && response.data.code === 0) {
      const { url, qrcode_key } = response.data.data;
      
      // 生成唯一的会话ID
      const sessionId = uuidv4();
      
      // 将二维码信息存储到Redis，设置10分钟过期
      await redis.setex(`bilibili_qr_${sessionId}`, 600, JSON.stringify({
        userId,
        qrcode_key,
        url,
        status: 'waiting',
        created_at: new Date().toISOString()
      }));

      // 生成二维码图片
      const qrCodeDataURL = await QRCode.toDataURL(url);
      
      // 启动轮询检查登录状态
      pollBilibiliLoginStatus(sessionId, qrcode_key);
      
      return {
        sessionId,
        qrcode_key,
        qrCodeImage: qrCodeDataURL,
        status: 'waiting'
      };
    } else {
      throw new Error('生成二维码失败');
    }
  } catch (error) {
    console.error('生成B站二维码失败:', error);
    throw new Error('生成二维码失败: ' + error.message);
  }
}

/**
 * 轮询检查B站登录状态
 * @param {string} sessionId - 会话ID
 * @param {string} qrcode_key - 二维码key
 */
async function pollBilibiliLoginStatus(sessionId, qrcode_key) {
  const maxAttempts = 120; // 最多轮询2分钟
  let attempts = 0;
  
  const poll = async () => {
    try {
      attempts++;
      
      // 检查会话是否还存在
      const sessionData = await redis.get(`bilibili_qr_${sessionId}`);
      if (!sessionData) {
        console.log(`会话 ${sessionId} 已过期或不存在`);
        return;
      }
      
      const session = JSON.parse(sessionData);
      
      // 调用B站API检查登录状态
      const response = await axios.get(
        `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcode_key}&source=navUserCenterLogin`,
        { headers: BILIBILI_HEADERS }
      );
      
      if (response.data && response.data.data) {
        const { code, url, message } = response.data.data;
        
        if (code === 0 && url) {
          // 登录成功，获取cookie
          await handleSuccessfulLogin(sessionId, session.userId, url);
          return;
        } else if (code === 86038) {
          // 二维码已过期
          await updateSessionStatus(sessionId, 'expired', '二维码已过期');
          return;
        } else if (code === 86101) {
          // 未扫码
          await updateSessionStatus(sessionId, 'waiting', '等待扫码');
        } else if (code === 86090) {
          // 已扫码，等待确认
          await updateSessionStatus(sessionId, 'scanned', '已扫码，等待确认');
        }
      }
      
      // 继续轮询
      if (attempts < maxAttempts) {
        setTimeout(poll, 1000); // 1秒后再次检查
      } else {
        await updateSessionStatus(sessionId, 'timeout', '登录超时');
      }
    } catch (error) {
      console.error('轮询B站登录状态失败:', error);
      if (attempts < maxAttempts) {
        setTimeout(poll, 2000); // 出错时2秒后重试
      }
    }
  };
  
  poll();
}

/**
 * 处理登录成功
 * @param {string} sessionId - 会话ID
 * @param {number} userId - 用户ID
 * @param {string} loginUrl - 登录URL
 */
async function handleSuccessfulLogin(sessionId, userId, loginUrl) {
  try {
    // 访问登录URL获取cookie
    const response = await axios.get(loginUrl, {
      headers: BILIBILI_HEADERS,
      maxRedirects: 5
    });
    
    const cookies = response.headers['set-cookie'];
    if (!cookies) {
      throw new Error('未获取到登录cookie');
    }
    
    // 解析cookie
    const cookieObj = {};
    let cookieString = '';
    
    cookies.forEach(cookie => {
      const parts = cookie.split(';')[0].split('=');
      if (parts.length === 2) {
        cookieObj[parts[0]] = parts[1];
        cookieString += `${parts[0]}=${parts[1]}; `;
      }
    });
    
    const dedeuserid = cookieObj.DedeUserID;
    const bili_jct = cookieObj.bili_jct;
    
    if (!dedeuserid || !bili_jct) {
      throw new Error('登录cookie不完整');
    }
    
    // 获取用户信息
    const userInfo = await getBilibiliUserInfo(dedeuserid, cookieString);
    
    // 保存到数据库
    await saveBilibiliAccount({
      userId,
      dedeuserid,
      bili_jct,
      cookieString: cookieString.trim(),
      nickname: userInfo.nickname,
      avatar: userInfo.avatar
    });
    
    // 更新会话状态
    await updateSessionStatus(sessionId, 'success', '登录成功', {
      dedeuserid,
      nickname: userInfo.nickname,
      avatar: userInfo.avatar
    });
    
  } catch (error) {
    console.error('处理登录成功失败:', error);
    await updateSessionStatus(sessionId, 'error', '登录处理失败: ' + error.message);
  }
}

/**
 * 获取B站用户信息
 * @param {string} dedeuserid - B站用户ID
 * @param {string} cookieString - Cookie字符串
 * @returns {Object} 用户信息
 */
async function getBilibiliUserInfo(dedeuserid, cookieString) {
  try {
    const response = await axios.get(
      `https://api.bilibili.com/x/space/acc/info?mid=${dedeuserid}`,
      {
        headers: {
          ...BILIBILI_HEADERS,
          'Cookie': cookieString
        }
      }
    );
    
    if (response.data && response.data.code === 0) {
      const data = response.data.data;
      return {
        nickname: data.name || '未知用户',
        avatar: data.face || ''
      };
    } else {
      return {
        nickname: '未知用户',
        avatar: ''
      };
    }
  } catch (error) {
    console.error('获取B站用户信息失败:', error);
    return {
      nickname: '未知用户',
      avatar: ''
    };
  }
}

/**
 * 保存B站账号信息到数据库
 * @param {Object} accountData - 账号数据
 */
async function saveBilibiliAccount(accountData) {
  const connection = await db.promise().getConnection();
  
  try {
    await connection.beginTransaction();
    
    // 检查是否已存在该B站账号
    const [existing] = await connection.query(
      'SELECT id FROM bilibili_accounts WHERE user_id = ? AND dedeuserid = ?',
      [accountData.userId, accountData.dedeuserid]
    );
    
    if (existing.length > 0) {
      // 更新现有记录
      await connection.query(
        `UPDATE bilibili_accounts SET 
         bili_jct = ?, cookie_string = ?, nickname = ?, avatar = ?, 
         is_active = 1, login_time = NOW(), updated_at = NOW()
         WHERE user_id = ? AND dedeuserid = ?`,
        [
          accountData.bili_jct,
          accountData.cookieString,
          accountData.nickname,
          accountData.avatar,
          accountData.userId,
          accountData.dedeuserid
        ]
      );
    } else {
      // 插入新记录
      await connection.query(
        `INSERT INTO bilibili_accounts 
         (user_id, dedeuserid, bili_jct, cookie_string, nickname, avatar, login_time)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          accountData.userId,
          accountData.dedeuserid,
          accountData.bili_jct,
          accountData.cookieString,
          accountData.nickname,
          accountData.avatar
        ]
      );
    }
    
    await connection.commit();
    console.log(`B站账号保存成功: 用户${accountData.userId} - ${accountData.nickname}`);
    
  } catch (error) {
    await connection.rollback();
    console.error('保存B站账号失败:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 更新会话状态
 * @param {string} sessionId - 会话ID
 * @param {string} status - 状态
 * @param {string} message - 消息
 * @param {Object} data - 额外数据
 */
async function updateSessionStatus(sessionId, status, message, data = {}) {
  try {
    const sessionData = await redis.get(`bilibili_qr_${sessionId}`);
    if (sessionData) {
      const session = JSON.parse(sessionData);
      session.status = status;
      session.message = message;
      session.data = data;
      session.updated_at = new Date().toISOString();
      
      await redis.setex(`bilibili_qr_${sessionId}`, 600, JSON.stringify(session));
    }
  } catch (error) {
    console.error('更新会话状态失败:', error);
  }
}

/**
 * 获取登录状态
 * @param {string} sessionId - 会话ID
 * @returns {Object} 登录状态
 */
async function getBilibiliLoginStatus(sessionId) {
  try {
    const sessionData = await redis.get(`bilibili_qr_${sessionId}`);
    if (!sessionData) {
      return { status: 'expired', message: '会话已过期' };
    }
    
    const session = JSON.parse(sessionData);
    return {
      status: session.status,
      message: session.message,
      data: session.data || {}
    };
  } catch (error) {
    console.error('获取登录状态失败:', error);
    return { status: 'error', message: '获取状态失败' };
  }
}

/**
 * 获取用户的B站账号列表
 * @param {number} userId - 用户ID
 * @returns {Array} B站账号列表
 */
async function getUserBilibiliAccounts(userId) {
  try {
    const [accounts] = await db.promise().query(
      `SELECT id, dedeuserid, nickname, avatar, is_active, login_time, created_at
       FROM bilibili_accounts 
       WHERE user_id = ? 
       ORDER BY login_time DESC`,
      [userId]
    );
    
    return accounts;
  } catch (error) {
    console.error('获取用户B站账号失败:', error);
    throw error;
  }
}

/**
 * 获取用户的活跃B站账号
 * @param {number} userId - 用户ID
 * @returns {Object|null} 活跃的B站账号
 */
async function getActiveBilibiliAccount(userId) {
  try {
    const [accounts] = await db.promise().query(
      `SELECT * FROM bilibili_accounts 
       WHERE user_id = ? AND is_active = 1 
       ORDER BY login_time DESC 
       LIMIT 1`,
      [userId]
    );
    
    return accounts.length > 0 ? accounts[0] : null;
  } catch (error) {
    console.error('获取活跃B站账号失败:', error);
    throw error;
  }
}

/**
 * 切换B站账号状态
 * @param {number} userId - 用户ID
 * @param {number} accountId - 账号ID
 * @param {boolean} isActive - 是否激活
 */
async function toggleBilibiliAccountStatus(userId, accountId, isActive) {
  try {
    await db.promise().query(
      'UPDATE bilibili_accounts SET is_active = ? WHERE id = ? AND user_id = ?',
      [isActive ? 1 : 0, accountId, userId]
    );
  } catch (error) {
    console.error('切换B站账号状态失败:', error);
    throw error;
  }
}

/**
 * 删除B站账号
 * @param {number} userId - 用户ID
 * @param {number} accountId - 账号ID
 */
async function deleteBilibiliAccount(userId, accountId) {
  try {
    await db.promise().query(
      'DELETE FROM bilibili_accounts WHERE id = ? AND user_id = ?',
      [accountId, userId]
    );
  } catch (error) {
    console.error('删除B站账号失败:', error);
    throw error;
  }
}

/**
 * 验证B站Cookie是否有效
 * @param {string} cookieString - Cookie字符串
 * @returns {boolean} 是否有效
 */
async function validateBilibiliCookie(cookieString) {
  try {
    const response = await axios.get(
      'https://api.bilibili.com/x/web-interface/nav',
      {
        headers: {
          ...BILIBILI_HEADERS,
          'Cookie': cookieString
        }
      }
    );
    
    return response.data && response.data.code === 0 && response.data.data.isLogin;
  } catch (error) {
    console.error('验证B站Cookie失败:', error);
    return false;
  }
}

module.exports = {
  generateBilibiliQRCode,
  getBilibiliLoginStatus,
  getUserBilibiliAccounts,
  getActiveBilibiliAccount,
  toggleBilibiliAccountStatus,
  deleteBilibiliAccount,
  validateBilibiliCookie
};