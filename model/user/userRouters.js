// model/user/userRouter.js
const express = require("express");
const router = express.Router();
const userUtils = require("./userUtils");
const authorize = require("../auth/authUtils"); // 您的授权中间件

// --- 公开路由 ---

// 用户注册 (PC/邮箱)
router.post("/register", async (req, res) => {
  try {
    // req.body: { name, email, password, code (可选的验证码) }
    const result = await userUtils.registerUser(req.body);
    res.status(201).json({ code: 201, message: result.message, data: null });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: error.message || "注册失败",
      data: null,
    });
  }
});

// PC 端登录
router.post("/pc/login", async (req, res) => {
  try {
    // req.body: { account (邮箱或用户名), password }
    const result = await userUtils.loginPC(req.body);
    res.json({ code: 200, message: "登录成功", data: result });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: error.message || "登录失败",
      data: null,
    });
  }
});

// 微信小程序登录
router.post("/mobile/login/wxMiniprogram", async (req, res) => {
  try {
    // req.body: { code (来自 wx.login) }
    const result = await userUtils.loginWxMiniprogram(req.body);
    res.json({ code: 200, message: "登录成功", data: result });
  } catch (error) {
    const statusCode = error.code === 211 ? 211 : 400; // 处理特定的 211 错误码
    res.status(statusCode).json({
      code: statusCode,
      message: error.message,
      data: { openid: error.openid },
    });
  }
});

// 【新增】鸿蒙端登录接口
router.post("/harmony/login", async (req, res) => {
  try {
    // 调用为鸿蒙定制的登录工具函数
    const result = await userUtils.loginHarmony(req.body);
    res.json({ code: 200, message: "登录成功", data: result });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: error.message || "登录失败",
      data: null,
    });
  }
});


// 微信小程序绑定账户
router.post("/mobile/bind/wxMiniprogram", async (req, res) => {
  try {
    // req.body: { code (wx.login), email, verificationCode (验证码) }
    const result = await userUtils.bindWxMiniprogram(req.body);
    res.json({ code: 200, message: result.message, data: null });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: error.message || "绑定失败",
      data: null,
    });
  }
});

// 微信小程序注册新账户
router.post("/mobile/register/wxMiniprogram", async (req, res) => {
  try {
    // req.body: { code (wx.login), name (可选) }
    const result = await userUtils.registerWxMiniprogram(req.body);
    res.json({ code: 200, message: result.message, data: result }); // 包含 token
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: error.message || "注册失败",
      data: null,
    });
  }
});

// 发送验证码接口 (例如：用于注册、绑定、重置密码等)
router.post("/send-verification-code", async (req, res) => {
  try {
    const { email, type } = req.body; // type: 'register', 'bind', 'reset_password' 等
    if (!email || !type) {
      return res.status(400).json({
        code: 400,
        message: "邮箱和类型为必填项。",
        data: null,
      });
    }
    const result = await userUtils.sendVerificationCode(email, type);
    res.json({ code: 200, message: result.message, data: null });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message || "发送验证码失败。",
      data: null,
    });
  }
});

// --- 受保护的路由 (需要身份验证) ---
// 角色: '1' (用户), '2' (管理员), '3' (超级管理员)

// 用户登出
// 所有已认证用户都可以登出
router.post("/logout", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const token = req.headers.authorization.split(" ")[1];
    const deviceType = req.headers.devicetype || req.user.device; // 从请求头或 JWT 获取 deviceType
    const result = await userUtils.logoutUser({ token, deviceType });
    res.json({ code: 200, message: result.message, data: null });
  } catch (error) {
    // 即使服务器端登出失败 (例如 token 已失效)，客户端也应继续清除本地 token
    res.status(401).json({
      code: 401,
      message: error.message || "登出失败",
      data: null,
    });
  }
});

// 获取当前用户的登录状态和详细信息 (适配 Ant Design Pro 格式)
// 所有已认证用户都可以检查自己的状态
router.get("/status", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    // req.user 由 authorize 中间件从 JWT 中填充: {id, role, device, name, email}
    // req.user.id 是 loginverification.id
    const detailedUserInfo = await userUtils.getUserInfo(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        name: detailedUserInfo.name, // 来自 getUserInfo，通常是用户昵称或真实姓名
        avatar:
          detailedUserInfo.avatar || // 优先使用用户自己设置的头像
          "https://gw.alipayobjects.com/zos/antfincdn/XAosXuNZyF/BiazfanxmamNRoxxVxka.png", // 默认头像
        userid: req.user.id.toString(), // loginverification 表的 id，作为用户唯一标识符
        email: detailedUserInfo.email, // 来自 getUserInfo
        signature: detailedUserInfo.signature || "", // 个性签名，如果getUserInfo提供则使用，否则为空
        title: detailedUserInfo.title || "", // 职称，如果getUserInfo提供则使用，否则为空
        group: detailedUserInfo.group || "", // 所属组，如果getUserInfo提供则使用，否则为空
        tags: detailedUserInfo.tags || [], // 标签，如果getUserInfo提供则使用，否则为空数组
        notifyCount: detailedUserInfo.notifyCount || 0, // 通知数量
        unreadCount: detailedUserInfo.unreadCount || 0, // 未读消息数量
        country: detailedUserInfo.country || "中国", // 国家，优先从用户信息获取
        access: req.user.role, // 用户角色，来自 JWT
        address: detailedUserInfo.address || "", // 地址，如果getUserInfo提供则使用，否则为空
        phone: detailedUserInfo.phoneNumber || "", // 电话号码，来自 getUserInfo
      },
    });
  } catch (error) {
    console.error("获取当前用户信息错误:", error); // 打印实际错误信息到控制台
    res.status(500).json({
      success: false,
      message: "服务器错误，请稍后再试",
      // 如果需要，可以添加一个空的 data 字段或错误代码
      // data: null,
      // errorCode: 'INTERNAL_SERVER_ERROR'
    });
  }
});

// 获取当前用户的详细信息
// 所有已认证用户都可以获取自己的信息
router.get("/user", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    const result = await userUtils.getUserInfo(req.user.id); // req.user.id 是 loginverification.id
    res.json({
      code: 200,
      message: "用户信息获取成功。",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message || "获取用户信息失败。",
      data: null,
    });
  }
});

// 更新当前用户信息
// 所有已认证用户都可以更新自己的信息
router.put("/user", authorize(["1", "2", "3"]), async (req, res) => {
  try {
    // req.body: { type: "email"|"phoneNumber"|"name"|"avatar"|"password", data: "newValue" }
    const { type, data } = req.body;
    if (!type || data === undefined) {
      return res.status(400).json({
        code: 400,
        message: "更新操作需要 type 和 data。",
        data: null,
      });
    }
    const result = await userUtils.updateUserInfo(req.user.id, { type, data });
    res.json({ code: 200, message: result.message, data: null });
  } catch (error) {
    res.status(400).json({
      code: 400,
      message: error.message || "更新用户信息失败。",
      data: null,
    });
  }
});

// --- 管理员路由 (示例) ---

// 获取所有用户 (供管理员/超级管理员使用)
router.get("/admin/users", authorize(["2", "3"]), async (req, res) => {
  // 占位符：在 userUtils 中实现获取所有用户的逻辑 (带分页、筛选等)
  // 目前仅返回成功消息
  res.json({
    code: 200,
    message: "管理员：获取所有用户接口 (待实现逻辑)。",
    data: [],
  });
});

// 更新任意用户的角色或信息 (供超级管理员使用)
router.put(
  "/admin/user/:userIdToUpdate",
  authorize(["3"]),
  async (req, res) => {
    // 占位符：在 userUtils 中实现超级管理员更新特定用户详细信息的逻辑
    // req.params.userIdToUpdate 将是 loginverification.id
    // req.body 可能包含 { role, name, email, 等 }
    const { userIdToUpdate } = req.params;
    const updateData = req.body;
    res.json({
      code: 200,
      message: `超级管理员：更新用户 ${userIdToUpdate} 接口 (待实现逻辑)。`,
      data: updateData,
    });
  }
);

module.exports = router;
