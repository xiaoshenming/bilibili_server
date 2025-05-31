/*
 Navicat Premium Dump SQL

 Source Server         : 10.3.36.15
 Source Server Type    : MySQL
 Source Server Version : 80036 (8.0.36)
 Source Host           : 10.3.36.15:3306
 Source Schema         : blibliapi

 Target Server Type    : MySQL
 Target Server Version : 80036 (8.0.36)
 File Encoding         : 65001

 Date: 01/06/2025 00:37:14
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for bilibili_accounts
-- ----------------------------
DROP TABLE IF EXISTS `bilibili_accounts`;
CREATE TABLE `bilibili_accounts`  (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` int NOT NULL COMMENT '关联的用户ID，外键到user表',
  `dedeuserid` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'B站用户ID',
  `bili_jct` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'B站CSRF Token',
  `cookie_string` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'B站完整Cookie字符串',
  `nickname` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'B站昵称',
  `avatar` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'B站头像URL',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否激活状态：1-激活，0-未激活',
  `login_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '登录时间',
  `expire_time` timestamp NULL DEFAULT NULL COMMENT 'Cookie过期时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `user_dedeuserid`(`user_id` ASC, `dedeuserid` ASC) USING BTREE,
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE,
  INDEX `idx_dedeuserid`(`dedeuserid` ASC) USING BTREE,
  INDEX `idx_is_active`(`is_active` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'B站账号登录信息表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of bilibili_accounts
-- ----------------------------
INSERT INTO `bilibili_accounts` VALUES (8, 8, '424572043', 'd792c619a142a7355230185154c04f93', 'DedeUserID=424572043; bili_jct=d792c619a142a7355230185154c04f93; SESSDATA=a2adc98f,1764252534,a9e45*52CjDtB3lfqm2nxlNid4uiaX5ChS8Ge7VOSVsPAiEuM6wypnV9XjdVEC14XCae7e7H_jQSVk9nREs0TG5KdjNFcjI1VnJZNnYtYjZ0Nm1vZzZmWkh3MnB2OEZQM1BNZERKMXoweWFNNU5RUF9oN0YwN2hJOTg5Sk0wV2JUZHV6eUx6ZzNrTkNrN2pnIIEC; DedeUserID__ckMd5=4759cf6b6b604ad0;', 'Smal日月', 'https://i1.hdslb.com/bfs/face/5d3b08e9797122e0287348432b1a0334ba33f119.jpg', 1, '2025-05-31 14:08:54', NULL, '2025-05-31 14:08:54', '2025-05-31 14:08:54');

-- ----------------------------
-- Table structure for loginverification
-- ----------------------------
DROP TABLE IF EXISTS `loginverification`;
CREATE TABLE `loginverification`  (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'Primary key for login entries, used in JWT `id` claim',
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Name associated with login, e.g., from registration form',
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Email used for login and verification',
  `phoneNumber` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Phone number used for login',
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Hashed password, null if using social login primarily',
  `role` varchar(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1' COMMENT 'User role: 1 (user), 2 (admin), 3 (superadmin). Guest (0) is implicit.',
  `openid` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'WeChat OpenID, used for wx login',
  `uid` int NULL DEFAULT NULL COMMENT 'Foreign key to user.id, linking login credential to user profile',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `email`(`email` ASC) USING BTREE,
  UNIQUE INDEX `phoneNumber`(`phoneNumber` ASC) USING BTREE,
  UNIQUE INDEX `openid`(`openid` ASC) USING BTREE,
  INDEX `uid`(`uid` ASC) USING BTREE,
  INDEX `idx_lv_email`(`email` ASC) USING BTREE,
  INDEX `idx_lv_phoneNumber`(`phoneNumber` ASC) USING BTREE,
  INDEX `idx_lv_openid`(`openid` ASC) USING BTREE,
  CONSTRAINT `loginverification_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 12 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of loginverification
-- ----------------------------
INSERT INTO `loginverification` VALUES (3, 'admin0', 'admin0@bb.com', NULL, '$2a$10$FkYjq2BUcE/PfO59eIPTmefax3UhqmDcNmjPg/gy5iRGOBt9wRr9u', '0', NULL, 3, '2025-05-29 07:45:28', '2025-05-29 07:45:28');
INSERT INTO `loginverification` VALUES (4, 'admin1', 'admin1@bb.com', NULL, '$2a$10$uHU7aKOkFMwFJ3vZFyWLk.uBepKRuGert0Qmf.zCBtCvSnwMcHo7y', '1', NULL, 4, '2025-05-29 07:46:45', '2025-05-29 07:46:45');
INSERT INTO `loginverification` VALUES (5, 'admin2', 'admin2@bb.com', NULL, '$2a$10$VuF5p/9JkTZ64dIsymbvHuCwHJe.QueFeOQ5DKcDdcNdHzpNi6V1q', '2', NULL, 5, '2025-05-29 07:46:58', '2025-05-29 07:46:58');
INSERT INTO `loginverification` VALUES (6, 'admin3', 'admin3@bb.com', NULL, '$2a$10$u.COXkudYmOEehDSwuJEJ.R7t9yVQXFAQabe4z.rCeSltBWXClxpC', '3', NULL, 6, '2025-05-29 07:47:09', '2025-05-29 07:47:09');
INSERT INTO `loginverification` VALUES (7, 'admin4', 'admin4@bb.com', NULL, '$2a$10$RiiiCelIz60M60atW9yzUuyVa.jVCYP9P/JMIWud92jueNKSszmLG', '4', NULL, 7, '2025-05-29 07:47:20', '2025-05-29 07:47:20');
INSERT INTO `loginverification` VALUES (8, 'admin', 'admin@bb.com', NULL, '$2a$10$3tpUp0eDs3uPiwMURuSJkuIk2NpGCmlzjPBSzOjAh9yShCob4iw5C', '1', NULL, 8, '2025-05-29 08:22:38', '2025-05-29 08:22:38');
INSERT INTO `loginverification` VALUES (9, '莫建明', '1181584752@qq.com', NULL, '$2a$10$G06giU77zNKluboka54l2.j/zUPuOglw5zaGjCpEifKYlQPUrxPBm', '1', NULL, 9, '2025-05-31 05:37:28', '2025-05-31 05:37:28');
INSERT INTO `loginverification` VALUES (10, '周紫潞', '166331852@qq.com', NULL, '$2a$10$1fuJ2fttwd6C9wzhSa9epeewML3vH1GRoUfIvPb46GlclwE.M9OL.', '1', NULL, 10, '2025-05-31 05:40:40', '2025-05-31 05:40:40');
INSERT INTO `loginverification` VALUES (11, 'test1', 'test1@bb.com', NULL, '$2a$10$KcSkfxo6JfC4mNjMPUdotuge6otYdlhQp4puS7oljsHjDueFMy2ry', '1', NULL, 11, '2025-05-31 05:47:30', '2025-05-31 05:47:30');

-- ----------------------------
-- Table structure for user
-- ----------------------------
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Display name or nickname, can differ from login name',
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Profile email, can be same as login or different',
  `openid` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'WeChat OpenID, primarily for linking',
  `wechatId` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'WeChat UnionID or other WeChat identifier',
  `avatar` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'URL to user avatar',
  `phoneNumber` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Profile phone number',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `email`(`email` ASC) USING BTREE,
  UNIQUE INDEX `openid`(`openid` ASC) USING BTREE,
  INDEX `idx_user_email`(`email` ASC) USING BTREE,
  INDEX `idx_user_openid`(`openid` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 12 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of user
-- ----------------------------
INSERT INTO `user` VALUES (3, 'admin0', 'admin0@bb.com', NULL, NULL, NULL, NULL, '2025-05-29 07:45:27', '2025-05-29 07:45:27');
INSERT INTO `user` VALUES (4, 'admin1', 'admin1@bb.com', NULL, NULL, NULL, NULL, '2025-05-29 07:46:45', '2025-05-29 07:46:45');
INSERT INTO `user` VALUES (5, 'admin2', 'admin2@bb.com', NULL, NULL, NULL, NULL, '2025-05-29 07:46:58', '2025-05-29 07:46:58');
INSERT INTO `user` VALUES (6, 'admin3', 'admin3@bb.com', NULL, NULL, NULL, NULL, '2025-05-29 07:47:09', '2025-05-29 07:47:09');
INSERT INTO `user` VALUES (7, 'admin4', 'admin4@bb.com', NULL, NULL, NULL, NULL, '2025-05-29 07:47:20', '2025-05-29 07:47:20');
INSERT INTO `user` VALUES (8, 'admin', 'admin@bb.com', NULL, NULL, NULL, NULL, '2025-05-29 08:22:38', '2025-05-29 08:22:38');
INSERT INTO `user` VALUES (9, '莫建明', '1181584752@qq.com', NULL, NULL, NULL, NULL, '2025-05-31 05:37:27', '2025-05-31 05:37:27');
INSERT INTO `user` VALUES (10, '周紫潞', '166331852@qq.com', NULL, NULL, NULL, NULL, '2025-05-31 05:40:40', '2025-05-31 05:40:40');
INSERT INTO `user` VALUES (11, 'test1', 'test1@bb.com', NULL, NULL, NULL, NULL, '2025-05-31 05:47:30', '2025-05-31 05:47:30');

-- ----------------------------
-- Table structure for user_videos
-- ----------------------------
DROP TABLE IF EXISTS `user_videos`;
CREATE TABLE `user_videos`  (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` int NOT NULL COMMENT '用户ID，关联user表',
  `video_id` int NOT NULL COMMENT '视频ID，关联videos表',
  `relation_type` enum('owner','processor','downloader') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'processor' COMMENT '关系类型：owner=UP主，processor=处理者，downloader=下载者',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关联创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_video_type`(`user_id` ASC, `video_id` ASC, `relation_type` ASC) USING BTREE COMMENT '用户-视频-关系类型唯一约束',
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE,
  INDEX `idx_video_id`(`video_id` ASC) USING BTREE,
  INDEX `idx_relation_type`(`relation_type` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户视频关联表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of user_videos
-- ----------------------------

-- ----------------------------
-- Table structure for videos
-- ----------------------------
DROP TABLE IF EXISTS `videos`;
CREATE TABLE `videos`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `bvid` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `title` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `pic` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `view` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `danmaku` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `like` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `coin` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `favorite` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `share` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `current_viewers` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `quality` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `download_link` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `pubdate` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `aid` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `tname` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `desc` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `duration` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `name` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `face` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `reply` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL,
  `cid` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NULL DEFAULT NULL COMMENT 'cid',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `video_id`(`bvid`) USING BTREE
) ENGINE = MyISAM AUTO_INCREMENT = 100 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of videos
-- ----------------------------
INSERT INTO `videos` VALUES (98, 'BV1drjKziEhs', '修仙界血脉为尊，什么叫你是修仙界孟德尔？', 'http://i0.hdslb.com/bfs/archive/8154d992104ad3460bc76aa85deb84ec4ee0d15e.jpg', '710295', '288', '67987', '669', '7488', '2189', '0', '80', 'http://10.23.55.31:11111/api/video/download/BV1drjKziEhs.mp4', '1748138544', '114565987704303', '配音', '-', '103', '笔给你你来写_', 'https://i0.hdslb.com/bfs/face/8e8a57daeb8ee0b50e6fa4e66c4f18f849fc601c.jpg', '1185', '30137386126');
INSERT INTO `videos` VALUES (99, 'BV1zm2NYuETu', '别的小说老祖VS遮天老祖', 'http://i1.hdslb.com/bfs/archive/91b3a2931b46608982ed345325336da870e64164.jpg', '977222', '76', '24547', '131', '2909', '307', '0', '80', 'http://10.23.55.31:11111/api/video/download/BV1zm2NYuETu.mp4', '1728485974', '113278051224644', '综合', '', '29', '狗头小李27', 'https://i1.hdslb.com/bfs/face/2b5772c80e90056a4472e99a8baaa4c01d52e38c.jpg', '1770', '26218203191');

SET FOREIGN_KEY_CHECKS = 1;
