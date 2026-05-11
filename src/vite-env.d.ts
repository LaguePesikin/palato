/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 自定义图片根 URL（不含难度子目录），优先级高于 COS 拼接 */
  readonly VITE_IMAGE_CDN_BASE?: string
  /** 腾讯云 COS 存储桶名称（含 APPID 后缀） */
  readonly VITE_COS_BUCKET?: string
  /** 腾讯云 COS 地域，如 ap-beijing、ap-guangzhou */
  readonly VITE_COS_REGION?: string
  /** 远程题目图扩展名，默认 png */
  readonly VITE_GAME_IMAGE_EXT?: string
  /** hell 难度对应的远端目录名，默认 extreme */
  readonly VITE_COS_HELL_FOLDER?: string
}
