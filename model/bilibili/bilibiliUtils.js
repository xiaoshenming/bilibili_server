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
    console.log('开始处理登录成功，URL:', loginUrl);
    
    let cookieObj = {};
    let cookieString = '';
    
    // 方法1: 从URL参数中解析cookie（适用于crossDomain类型的URL）
    try {
      const urlObj = new URL(loginUrl);
      const urlParams = urlObj.searchParams;
      
      // 检查URL参数中是否包含cookie信息
      if (urlParams.has('DedeUserID') && urlParams.has('bili_jct')) {
        cookieObj.DedeUserID = urlParams.get('DedeUserID');
        cookieObj.bili_jct = urlParams.get('bili_jct');
        cookieObj.SESSDATA = urlParams.get('SESSDATA') || '';
        cookieObj.DedeUserID__ckMd5 = urlParams.get('DedeUserID__ckMd5') || '';
        
        cookieString = `DedeUserID=${cookieObj.DedeUserID}; bili_jct=${cookieObj.bili_jct}; SESSDATA=${cookieObj.SESSDATA}; DedeUserID__ckMd5=${cookieObj.DedeUserID__ckMd5}; `;
        console.log('从URL参数中解析到cookie:', cookieObj);
      }
    } catch (urlError) {
      console.log('URL解析失败，尝试其他方法:', urlError.message);
    }
    
    // 方法2: 如果URL解析失败，尝试访问登录URL获取cookie
    if (!cookieObj.DedeUserID || !cookieObj.bili_jct) {
      console.log('尝试通过HTTP请求获取cookie');
      
      try {
        const response = await axios.get(loginUrl, {
          headers: {
            ...BILIBILI_HEADERS,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          maxRedirects: 10,
          timeout: 10000,
          validateStatus: function (status) {
            return status >= 200 && status < 400;
          }
        });
        
        const cookies = response.headers['set-cookie'];
        console.log('HTTP响应headers:', response.headers);
        console.log('HTTP响应cookie:', cookies);
        
        if (cookies && cookies.length > 0) {
          cookies.forEach(cookie => {
            const parts = cookie.split(';')[0].split('=');
            if (parts.length === 2) {
              cookieObj[parts[0]] = parts[1];
              cookieString += `${parts[0]}=${parts[1]}; `;
            }
          });
        }
        
        // 检查响应体是否包含cookie信息
        if (response.data && typeof response.data === 'object') {
          console.log('HTTP响应数据:', response.data);
          
          // 检查是否有cookie_info字段
          if (response.data.cookie_info && response.data.cookie_info.cookies) {
            response.data.cookie_info.cookies.forEach(cookie => {
              cookieObj[cookie.name] = cookie.value;
              cookieString += `${cookie.name}=${cookie.value}; `;
            });
          }
        }
      } catch (httpError) {
        console.log('HTTP请求失败:', httpError.message);
      }
    }
    
    // 方法3: 尝试解析URL中的所有参数
    if (!cookieObj.DedeUserID || !cookieObj.bili_jct) {
      console.log('尝试解析URL中的所有参数');
      
      // 使用更强的正则表达式解析URL参数
      const paramRegex = /[?&]([^=&]+)=([^&]*)/g;
      let match;
      
      while ((match = paramRegex.exec(loginUrl)) !== null) {
        const key = decodeURIComponent(match[1]);
        const value = decodeURIComponent(match[2]);
        
        if (['DedeUserID', 'bili_jct', 'SESSDATA', 'DedeUserID__ckMd5', 'sid'].includes(key)) {
          cookieObj[key] = value;
          cookieString += `${key}=${value}; `;
        }
      }
    }
    
    const dedeuserid = cookieObj.DedeUserID;
    const bili_jct = cookieObj.bili_jct;
    const sessdata = cookieObj.SESSDATA;
    
    console.log('最终解析的cookie:', { dedeuserid, bili_jct, sessdata, cookieString });
    
    if (!dedeuserid || !bili_jct) {
      throw new Error(`登录cookie不完整: DedeUserID=${dedeuserid}, bili_jct=${bili_jct}, SESSDATA=${sessdata}`);
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
    console.log(`🔍 开始获取B站用户信息: dedeuserid=${dedeuserid}`);
    console.log(`🍪 使用的Cookie: ${cookieString}`);
    
    // 方法1: 尝试使用用户空间信息API
    try {
      const response = await axios.get(
        `https://api.bilibili.com/x/space/acc/info?mid=${dedeuserid}`,
        {
          headers: {
            ...BILIBILI_HEADERS,
            'Cookie': cookieString,
            'Referer': 'https://space.bilibili.com/',
            'Origin': 'https://space.bilibili.com'
          },
          timeout: 10000
        }
      );
      
      console.log(`📡 API响应状态: ${response.status}`);
      console.log(`📡 API响应数据:`, response.data);
      
      if (response.data && response.data.code === 0 && response.data.data) {
        const data = response.data.data;
        const userInfo = {
          nickname: data.name || '未知用户',
          avatar: data.face || ''
        };
        console.log(`✅ 成功获取用户信息:`, userInfo);
        return userInfo;
      } else {
        console.log(`⚠️ API返回错误: code=${response.data?.code}, message=${response.data?.message}`);
      }
    } catch (apiError) {
      console.log(`❌ 用户空间API请求失败:`, apiError.message);
    }
    
    // 方法2: 尝试使用导航栏用户信息API
    try {
      console.log(`🔄 尝试使用导航栏API获取用户信息`);
      const navResponse = await axios.get(
        'https://api.bilibili.com/x/web-interface/nav',
        {
          headers: {
            ...BILIBILI_HEADERS,
            'Cookie': cookieString,
            'Referer': 'https://www.bilibili.com/',
            'Origin': 'https://www.bilibili.com'
          },
          timeout: 10000
        }
      );
      
      console.log(`📡 导航API响应:`, navResponse.data);
      
      if (navResponse.data && navResponse.data.code === 0 && navResponse.data.data) {
        const data = navResponse.data.data;
        const userInfo = {
          nickname: data.uname || '未知用户',
          avatar: data.face || ''
        };
        console.log(`✅ 通过导航API获取用户信息:`, userInfo);
        return userInfo;
      }
    } catch (navError) {
      console.log(`❌ 导航API请求失败:`, navError.message);
    }
    
    // 方法3: 使用dedeuserid作为默认用户名
    console.log(`⚠️ 所有API都失败，使用dedeuserid作为用户名`);
    return {
      nickname: `用户${dedeuserid}`,
      avatar: ''
    };
    
  } catch (error) {
    console.error('获取B站用户信息失败:', error);
    return {
      nickname: `用户${dedeuserid || '未知'}`,
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
 * @param {string|number} accountIdentifier - 账号标识符（可以是主键ID或dedeuserid）
 */
async function deleteBilibiliAccount(userId, accountIdentifier) {
  try {
    console.log('删除账号参数:', { userId, accountIdentifier, userIdType: typeof userId, accountIdentifierType: typeof accountIdentifier });
    
    // 先尝试通过主键ID查询
    let [existingAccount] = await db.promise().query(
      'SELECT * FROM bilibili_accounts WHERE id = ?',
      [accountIdentifier]
    );
    
    // 如果通过主键ID没找到，尝试通过dedeuserid查询
    if (existingAccount.length === 0) {
      [existingAccount] = await db.promise().query(
        'SELECT * FROM bilibili_accounts WHERE dedeuserid = ?',
        [accountIdentifier]
      );
    }
    
    console.log('查询到的账号:', existingAccount);
    
    if (existingAccount.length === 0) {
      throw new Error(`账号 ${accountIdentifier} 不存在`);
    }
    
    const account = existingAccount[0];
    
    if (account.user_id != userId) {
      throw new Error(`无权限删除账号，账号属于用户ID ${account.user_id}，当前用户ID ${userId}`);
    }
    
    // 使用主键ID进行删除
    const [result] = await db.promise().query(
      'DELETE FROM bilibili_accounts WHERE id = ? AND user_id = ?',
      [account.id, userId]
    );
    
    console.log('删除结果:', result);
    
    // 检查是否真正删除了数据
    if (result.affectedRows === 0) {
      throw new Error('删除操作未影响任何记录');
    }
    
    return result;
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

/**
 * 获取B站视频信息和下载链接
 * @param {string} bvid - 视频BVID
 * @param {string} cookieString - Cookie字符串
 * @returns {Object} 视频信息和下载链接
 */
async function getBilibiliVideoInfo(bvid, cookieString) {
  try {
    // 获取视频基本信息
    const videoInfoResponse = await axios.get(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      {
        headers: {
          ...BILIBILI_HEADERS,
          'Cookie': cookieString
        }
      }
    );

    if (videoInfoResponse.data.code !== 0) {
      throw new Error(`获取视频信息失败: ${videoInfoResponse.data.message}`);
    }

    const videoData = videoInfoResponse.data.data;
    const cid = videoData.cid;

    // 获取视频下载链接
    const playUrlResponse = await axios.get(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=16&fourk=1`,
      {
        headers: {
          ...BILIBILI_HEADERS,
          'Cookie': cookieString,
          'Referer': `https://www.bilibili.com/video/${bvid}`
        }
      }
    );

    if (playUrlResponse.data.code !== 0) {
      throw new Error(`获取下载链接失败: ${playUrlResponse.data.message}`);
    }

    const playData = playUrlResponse.data.data;
    
    // 提取视频和音频链接
    let videoUrl = null;
    let audioUrl = null;
    
    if (playData.dash) {
      // DASH格式
      if (playData.dash.video && playData.dash.video.length > 0) {
        videoUrl = playData.dash.video[0].baseUrl || playData.dash.video[0].base_url;
      }
      if (playData.dash.audio && playData.dash.audio.length > 0) {
        audioUrl = playData.dash.audio[0].baseUrl || playData.dash.audio[0].base_url;
      }
    } else if (playData.durl && playData.durl.length > 0) {
      // FLV格式
      videoUrl = playData.durl[0].url;
    }

    // 返回完整的视频信息，包含所有可用字段
    return {
      // 基本信息
      aid: videoData.aid,
      bvid: videoData.bvid,
      cid: videoData.cid,
      title: videoData.title,
      description: videoData.desc,
      pic: videoData.pic,
      
      // 时间信息
      duration: videoData.duration,
      pubdate: videoData.pubdate,
      ctime: videoData.ctime,
      
      // 分区信息
      tid: videoData.tid,
      tname: videoData.tname,
      copyright: videoData.copyright,
      
      // UP主信息
      owner: {
        mid: videoData.owner.mid,
        name: videoData.owner.name,
        face: videoData.owner.face
      },
      
      // 统计信息
      stat: {
        view: videoData.stat.view,
        danmaku: videoData.stat.danmaku,
        reply: videoData.stat.reply,
        favorite: videoData.stat.favorite,
        coin: videoData.stat.coin,
        share: videoData.stat.share,
        like: videoData.stat.like,
        now_rank: videoData.stat.now_rank || 0,
        his_rank: videoData.stat.his_rank || 0,
        evaluation: videoData.stat.evaluation || ''
      },
      
      // 视频属性
      videos: videoData.videos, // 分P数量
      pages: videoData.pages || [],
      subtitle: videoData.subtitle || {},
      
      // 权限和状态
      state: videoData.state,
      attribute: videoData.attribute,
      
      // 下载相关
      downloadUrls: {
        video: videoUrl,
        audio: audioUrl
      },
      quality: playData.quality || 80,
      format: playData.format || 'mp4',
      
      // 其他信息
      mission_id: videoData.mission_id || null,
      redirect_url: videoData.redirect_url || null,
      
      // 标签信息
      tag: videoData.tag || [],
      
      // 荣誉信息
      honor_reply: videoData.honor_reply || {},
      
      // 用户权限
      user_garb: videoData.user_garb || {},
      
      // 互动信息
      elec: videoData.elec || null,
      
      // 合集信息
      ugc_season: videoData.ugc_season || null
    };
  } catch (error) {
    console.error('获取B站视频信息失败:', error);
    throw error;
  }
}

module.exports = {
  generateBilibiliQRCode,
  getBilibiliLoginStatus,
  getUserBilibiliAccounts,
  getActiveBilibiliAccount,
  toggleBilibiliAccountStatus,
  deleteBilibiliAccount,
  validateBilibiliCookie,
  getBilibiliVideoInfo
};