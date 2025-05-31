# 视频下载权限每日限制功能

## 功能概述

本功能实现了基于用户权限等级的视频下载申请每日限制，使用Redis来跟踪和管理每日申请次数。

## 权限等级限制

| 权限等级 | 每日申请限制 | 说明 |
|---------|-------------|------|
| 1级权限 | 1个视频 | 普通用户 |
| 2级权限 | 10个视频 | 高级用户 |
| 3级权限 | 100个视频 | VIP用户 |
| 4级权限 | 无限制 | 管理员/超级管理员 |

## 重要规则

1. **自己的视频不受限制**：用户申请自己上传或处理的视频下载权限时，不计入每日限制
2. **每日重置**：每天00:00自动重置申请次数
3. **Redis存储**：使用Redis存储每日申请计数，键格式：`download_requests:{userId}:{YYYY-MM-DD}`
4. **自动过期**：Redis键会在次日00:00自动过期

## API接口

### 1. 申请视频下载权限

**接口地址**：`POST /api/video/add-download-permission`

**请求头**：
```
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体**：
```json
{
  "bvid": "BV1234567890"
}
```

**响应示例**：

成功响应：
```json
{
  "code": 200,
  "message": "成功添加下载权限",
  "data": {
    "success": true,
    "message": "成功添加下载权限",
    "videoTitle": "视频标题",
    "bvid": "BV1234567890"
  }
}
```

达到限制时的响应：
```json
{
  "code": 500,
  "message": "您的1级权限每日只能申请1个视频下载权限，今日已达上限。明日00:00重置。",
  "data": null
}
```

### 2. 查询每日限制状态

**接口地址**：`GET /api/video/daily-limit-status`

**请求头**：
```
Authorization: Bearer {token}
```

**响应示例**：
```json
{
  "code": 200,
  "message": "获取每日限制状态成功",
  "data": {
    "userRole": "1",
    "roleName": "1级",
    "totalLimit": 1,
    "usedCount": 0,
    "remaining": 1,
    "canApply": true,
    "resetTime": "每日00:00重置"
  }
}
```

## 测试步骤

### 1. 测试不同权限等级的限制

1. 使用1级权限用户登录，申请2个不同的视频下载权限
2. 第一个应该成功，第二个应该被拒绝
3. 使用2级权限用户登录，可以申请10个视频
4. 使用4级权限用户登录，应该可以无限申请

### 2. 测试自己视频不受限制

1. 使用1级权限用户上传一个视频
2. 申请自己视频的下载权限，不应该计入每日限制
3. 再申请其他人的视频，仍然有完整的每日限制

### 3. 测试每日重置

1. 用完当日限制后，等待到次日00:00
2. 或者手动删除Redis中的计数键进行测试
3. 验证限制是否重置

### 4. 测试Redis键过期

使用Redis客户端查看键的TTL：
```bash
redis-cli
TTL download_requests:1:2024-01-01
```

## 技术实现细节

### Redis键设计
- **键格式**：`download_requests:{userId}:{YYYY-MM-DD}`
- **值**：申请次数（整数）
- **过期时间**：到次日00:00的秒数

### 核心函数

1. `checkDailyDownloadLimit(userId, userRole, redis)`：检查用户是否还能申请
2. `incrementDailyDownloadCount(userId, redis)`：增加申请计数
3. `addVideoDownloader(userId, bvid)`：主要的申请逻辑

### 数据库查询优化

- 检查用户权限：`SELECT role FROM user WHERE id = ?`
- 检查视频所有权：`SELECT relation_type FROM user_videos WHERE user_id = ? AND video_id = ? AND relation_type IN ('uploader', 'processor')`

## 注意事项

1. 确保Redis服务正常运行
2. 确保用户表中的role字段正确设置
3. 时区问题：当前使用系统时区，如需要可调整为特定时区
4. 性能考虑：Redis操作是异步的，在高并发情况下需要考虑原子性