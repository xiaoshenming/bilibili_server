// model/user/userUtils.js
const db = require("../../config/db"); // 您的 db.js
const redis = require("../../config/redis"); // 您的 redis.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
// const { getOpenid } = require("../wx/getOpenid"); // 假设您有此工具函数
require("dotenv").config();

const secret = process.env.JWT_SECRET;

// 如果 getOpenid 不可用，则使用模拟函数，请替换为您的实际实现
const getOpenid = async (code) => {
  console.log(`模拟 getOpenid 调用，code: ${code}`);
  if (code === "validWxCode") {
    return { openid: `mock_openid_${Date.now()}` };
  } else if (code === "existingOpenidCode") {
    return { openid: "mock_openid_existing" };
  }
  throw new Error("模拟微信 code 无效");
};

/** 生成 JWT */
function generateJWT(loginUser, deviceType) {
  // loginUser 是 loginverification 表中的一个条目
  return jwt.sign(
    {
      id: loginUser.id,
      role: loginUser.role,
      device: deviceType,
      name: loginUser.name,
      email: loginUser.email,
    }, // 如果 JWT 中需要更多字段，请在此添加
    secret,
    { expiresIn: "7d" } // 例如：7 天
  );
}

/** 将 JWT 保存到 Redis (例如，活动会话为1小时，JWT 本身具有更长的有效期) */
async function saveJWTToRedis(loginVerificationId, token, deviceType) {
  await redis.set(
    `user_${loginVerificationId}_${deviceType}_token`,
    token,
    "EX",
    3600 * 24 * 7 // 匹配 JWT 有效期或更短，用于活动会话跟踪
  );
}

/** 从 Redis 中删除 JWT */
async function deleteJWTFromRedis(loginVerificationId, deviceType) {
  await redis.del(`user_${loginVerificationId}_${deviceType}_token`);
}

/** 用户注册 (邮箱/密码) */
async function registerUser({ name, email, password, code, role = "1" }) {
  if (!name || !email || !password) {
    throw new Error("姓名、邮箱和密码为必填项。");
  }
  if (code) {
    // 假设 code 用于邮箱验证
    const storedCode = await redis.get(`code_register_${email}`);
    if (storedCode !== code) {
      throw new Error("验证码不正确或已过期。");
    }
  }

  const connection = await db.promise().getConnection();
  await connection.beginTransaction();

  try {
    let [existingLogins] = await connection.query(
      "SELECT id FROM loginverification WHERE email = ?",
      [email]
    );
    if (existingLogins.length > 0) {
      throw new Error("此邮箱已被注册。");
    }

    // 创建用户个人资料条目
    const [userResult] = await connection.query(
      "INSERT INTO user (username, email) VALUES (?, ?)",
      [name, email]
    );
    const userId = userResult.insertId;

    // 哈希密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建登录验证条目
    await connection.query(
      "INSERT INTO loginverification (name, email, password, role, uid) VALUES (?, ?, ?, ?, ?)",
      [name, email, hashedPassword, role, userId]
    );

    await connection.commit();
    if (code) {
      await redis.del(`code_register_${email}`);
    }
    return { message: "注册成功。" };
  } catch (error) {
    await connection.rollback();
    console.error("registerUser 出错:", error);
    throw error;
  } finally {
    connection.release();
  }
}

/** PC 端登录 (邮箱/密码 或 用户名/密码) */
async function loginPC({ username, password }) {
  if (!username?.trim() || !password?.trim()) {
    throw new Error("账户和密码不能为空。");
  }

  const connection = db.promise();
  // 尝试使用邮箱或用户名登录 (假设 loginverification 中的 'name' 可以是用户名)
  const [results] = await connection.query(
    "SELECT * FROM loginverification WHERE email = ? OR name = ?", // 或者，如果用户名存储在其他地方，请进行调整
    [username, username]
  );

  if (results.length === 0) {
    throw new Error("账户未找到。");
  }

  const loginUser = results[0];
  if (!loginUser.password) {
    throw new Error("此账户未启用密码登录。");
  }

  const validPassword = await bcrypt.compare(password, loginUser.password);
  if (!validPassword) {
    throw new Error("密码错误。");
  }

  const token = generateJWT(loginUser, "pc");
  await saveJWTToRedis(loginUser.id, token, "pc");

  return {
    token,
    role: loginUser.role,
    name: loginUser.name,
    id: loginUser.id,
  };
}

/** 微信小程序登录 */
async function loginWxMiniprogram({ code }) {
  if (!code) throw new Error("微信 code 是必需的。");
  const { openid } = await getOpenid(code); // 实现 getOpenid 以从微信 API 获取

  const connection = db.promise();
  const [results] = await connection.query(
    "SELECT * FROM loginverification WHERE openid = ?",
    [openid]
  );

  if (results.length > 0) {
    const loginUser = results[0];
    const token = generateJWT(loginUser, "mobile");
    await saveJWTToRedis(loginUser.id, token, "mobile");
    return {
      token,
      role: loginUser.role,
      name: loginUser.name,
      id: loginUser.id,
    };
  } else {
    // 未通过 openid 找到用户，需要注册或绑定
    const error = new Error("微信账户未注册。请注册或绑定您的账户。");
    error.code = 211; // 自定义代码，用于前端指示新微信用户
    error.openid = openid; // 将 openid 返回以进行注册流程
    throw error;
  }
}

/** 微信小程序绑定 */
async function bindWxMiniprogram({ code, email, verificationCode }) {
  if (!code || !email || !verificationCode) {
    throw new Error("微信 code、邮箱和验证码是必需的。");
  }

  const { openid } = await getOpenid(code);
  const connection = await db.promise().getConnection();
  await connection.beginTransaction();

  try {
    const [openidResults] = await connection.query(
      "SELECT id FROM loginverification WHERE openid = ?",
      [openid]
    );
    if (openidResults.length > 0) {
      throw new Error("此微信账户已绑定到其他用户。");
    }

    // 可选：验证邮箱验证码
    const storedEmailCode = await redis.get(`code_bind_${email}`);
    if (storedEmailCode !== verificationCode) {
      throw new Error("验证码不正确或已过期。");
    }

    const [emailResults] = await connection.query(
      "SELECT id, uid FROM loginverification WHERE email = ?",
      [email]
    );
    if (emailResults.length === 0) {
      throw new Error("邮箱账户未找到。请先注册。");
    }
    const loginEntry = emailResults[0];

    // 使用 openid 更新 loginverification
    await connection.query(
      "UPDATE loginverification SET openid = ? WHERE id = ?",
      [openid, loginEntry.id]
    );

    // 可选地，如果 user 表存在且 uid 已链接，则更新 user 表的 openid
    if (loginEntry.uid) {
      await connection.query("UPDATE user SET openid = ? WHERE id = ?", [
        openid,
        loginEntry.uid,
      ]);
    }

    await connection.commit();
    await redis.del(`code_bind_${email}`);
    return { message: "微信账户绑定成功。" };
  } catch (error) {
    await connection.rollback();
    console.error("bindWxMiniprogram 出错:", error);
    throw error;
  } finally {
    connection.release();
  }
}

/** 微信小程序注册 (通过微信创建新用户) */
async function registerWxMiniprogram({
  code,
  name = "微信用户", // 默认名称
  role = "1",
}) {
  if (!code) throw new Error("微信 code 是必需的。");
  const { openid } = await getOpenid(code);

  const connection = await db.promise().getConnection();
  await connection.beginTransaction();
  try {
    const [existingLogins] = await connection.query(
      "SELECT id FROM loginverification WHERE openid = ?",
      [openid]
    );
    if (existingLogins.length > 0) {
      throw new Error("此微信账户已被注册。");
    }

    // 创建用户个人资料条目
    const [userResult] = await connection.query(
      "INSERT INTO user (username, openid) VALUES (?, ?)",
      [name, openid] // 使用提供的名称或默认值
    );
    const userId = userResult.insertId;

    // 创建登录验证条目
    const [loginResult] = await connection.query(
      "INSERT INTO loginverification (name, openid, role, uid) VALUES (?, ?, ?, ?)",
      [name, openid, role, userId]
    );
    const loginVerificationId = loginResult.insertId;

    await connection.commit();

    // 注册后自动登录用户
    const loginUser = { id: loginVerificationId, name, role, openid }; // 为 JWT 构建足够的信息
    const token = generateJWT(loginUser, "mobile");
    await saveJWTToRedis(loginUser.id, token, "mobile");

    return {
      message: "注册成功。",
      token,
      role: loginUser.role,
      name: loginUser.name,
      id: loginUser.id,
    };
  } catch (error) {
    await connection.rollback();
    console.error("registerWxMiniprogram 出错:", error);
    throw error;
  } finally {
    connection.release();
  }
}

/** 用户登出 */
async function logoutUser({ token, deviceType }) {
  try {
    const decoded = jwt.verify(token, secret); // 验证是一个好习惯
    await deleteJWTFromRedis(decoded.id, deviceType);
    return { message: "登出成功。" };
  } catch (error) {
    // 如果 token 无效/过期，它可能已从 Redis 中删除或无关紧要
    console.warn("登出警告 (token 可能无效或已过期):", error.message);
    // 仍然返回成功，因为目标是确保用户在客户端也已登出
    return { message: "登出已处理。" };
  }
}

/** 获取用户信息 */
async function getUserInfo(loginVerificationId) {
  // loginVerificationId 来自 JWT (decoded.id)
  const connection = db.promise();
  const [lvRows] = await connection.query(
    "SELECT * FROM loginverification WHERE id = ?",
    [loginVerificationId]
  );

  if (!lvRows || lvRows.length === 0) {
    throw new Error("登录会话未找到或用户不存在。");
  }
  const loginUser = lvRows[0];
  let userProfile = null;

  if (loginUser.uid) {
    const [userRows] = await connection.query(
      "SELECT * FROM user WHERE id = ?",
      [loginUser.uid]
    );
    if (userRows.length > 0) {
      userProfile = userRows[0];
    }
  }

  return {
    id: loginUser.id, // 这是 loginverification.id，JWT 中的那个
    role: loginUser.role,
    name: userProfile?.username || loginUser.name, // 首选个人资料用户名，备用登录名
    email: userProfile?.email || loginUser.email, // 首选个人资料邮箱
    avatar: userProfile?.avatar || null,
    phoneNumber: userProfile?.phoneNumber || loginUser.phoneNumber,
    uid: loginUser.uid, // user 表的 id
    // 根据需要添加 userProfile 或 loginUser 中的任何其他字段
  };
}

/** 更新用户信息 */
async function updateUserInfo(loginVerificationId, { type, data }) {
  // loginVerificationId 来自 req.user.id (JWT 的 id 声明)
  const validTypes = ["phoneNumber", "email", "name", "avatar", "password"];
  if (!validTypes.includes(type)) {
    throw new Error(`无效的更新类型。允许的类型: ${validTypes.join("、 ")}`);
  }

  // 基本验证 (可以更全面)
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data)) {
    throw new Error("邮箱格式无效。");
  }
  if (type === "phoneNumber" && data && !/^\+?[1-9]\d{1,14}$/.test(data)) {
    // 简单的国际格式
    throw new Error("电话号码格式无效。");
  }
  if (type === "name" && !data?.trim()) {
    throw new Error("姓名不能为空。");
  }

  const connection = await db.promise().getConnection();
  await connection.beginTransaction();
  try {
    const [lvRows] = await connection.query(
      "SELECT uid, email, phoneNumber FROM loginverification WHERE id = ?",
      [loginVerificationId]
    );
    if (lvRows.length === 0) {
      throw new Error("用户未找到。");
    }
    const loginUser = lvRows[0];

    // 处理 loginverification 表的更新
    if (type === "email") {
      if (data === loginUser.email) throw new Error("新邮箱与当前邮箱相同。");
      const [existing] = await connection.query(
        "SELECT id FROM loginverification WHERE email = ? AND id != ?",
        [data, loginVerificationId]
      );
      if (existing.length > 0) throw new Error("此邮箱已被其他账户使用。");
      await connection.query(
        "UPDATE loginverification SET email = ? WHERE id = ?",
        [data, loginVerificationId]
      );
    } else if (type === "phoneNumber") {
      if (data === loginUser.phoneNumber)
        throw new Error("新电话号码与当前电话号码相同。");
      const [existing] = await connection.query(
        "SELECT id FROM loginverification WHERE phoneNumber = ? AND id != ?",
        [data, loginVerificationId]
      );
      if (existing.length > 0) throw new Error("此电话号码已被其他账户使用。");
      await connection.query(
        "UPDATE loginverification SET phoneNumber = ? WHERE id = ?",
        [data, loginVerificationId]
      );
    } else if (type === "name" && !loginUser.uid) {
      // 如果没有单独的用户个人资料，则更新 loginverification 中的 name
      await connection.query(
        "UPDATE loginverification SET name = ? WHERE id = ?",
        [data, loginVerificationId]
      );
    } else if (type === "password") {
      if (!data || data.length < 6) throw new Error("密码长度至少为6个字符。");
      const hashedPassword = await bcrypt.hash(data, 10);
      await connection.query(
        "UPDATE loginverification SET password = ? WHERE id = ?",
        [hashedPassword, loginVerificationId]
      );
    }

    // 处理 user 表 (个人资料) 的更新
    if (loginUser.uid) {
      let userUpdateQuery = "";
      let userUpdateParams = [];
      if (type === "name") {
        userUpdateQuery = "UPDATE user SET username = ? WHERE id = ?";
        userUpdateParams = [data, loginUser.uid];
      } else if (type === "email") {
        // 如果不同，也更新个人资料邮箱
        userUpdateQuery = "UPDATE user SET email = ? WHERE id = ?";
        userUpdateParams = [data, loginUser.uid];
      } else if (type === "phoneNumber") {
        // 如果不同，也更新个人资料电话号码
        userUpdateQuery = "UPDATE user SET phoneNumber = ? WHERE id = ?";
        userUpdateParams = [data, loginUser.uid];
      } else if (type === "avatar") {
        userUpdateQuery = "UPDATE user SET avatar = ? WHERE id = ?";
        userUpdateParams = [data, loginUser.uid];
      }
      // 注意：密码通常不存储在 'user' 个人资料表中，而是存储在 'loginverification' 中

      if (userUpdateQuery) {
        await connection.query(userUpdateQuery, userUpdateParams);
      }
    }

    await connection.commit();
    return { message: "用户信息更新成功。" };
  } catch (error) {
    await connection.rollback();
    console.error("updateUserInfo 出错:", error);
    throw error;
  } finally {
    connection.release();
  }
}

// 【新增】鸿蒙端登录 (逻辑与PC端类似，但设备类型不同)
async function loginHarmony({ username, password }) {
  if (!username?.trim() || !password?.trim()) {
    throw new Error("账户和密码不能为空。");
  }

  const connection = db.promise();
  const [results] = await connection.query(
    "SELECT * FROM loginverification WHERE email = ? OR name = ?",
    [username, username]
  );

  if (results.length === 0) {
    throw new Error("账户未找到。");
  }

  const loginUser = results[0];
  if (!loginUser.password) {
    throw new Error("此账户未启用密码登录。");
  }

  const validPassword = await bcrypt.compare(password, loginUser.password);
  if (!validPassword) {
    throw new Error("密码错误。");
  }

  // 【关键区别】设备类型标记为 'harmony'
  const token = generateJWT(loginUser, "harmony");
  await saveJWTToRedis(loginUser.id, token, "harmony");

  return {
    token,
    role: loginUser.role,
    name: loginUser.name,
    id: loginUser.id,
  };
}

module.exports = {
  registerUser,
  loginPC,
  loginWxMiniprogram,
  bindWxMiniprogram,
  registerWxMiniprogram,
  logoutUser,
  getUserInfo,
  updateUserInfo,
  loginHarmony,
  // 用于发送验证码 (示例，根据需要实现)
  async sendVerificationCode(email, type = "register") {
    // type 可以是 'register', 'bind', 'reset_password' 等
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const key = `code_${type}_${email}`;
    await redis.set(key, code, "EX", 300); // 5 分钟有效期
    console.log(`邮箱 ${email} (${type}) 的验证码: ${code}`); // 替换为实际的邮件发送逻辑
    return { message: "验证码已发送。" };
  },
};


