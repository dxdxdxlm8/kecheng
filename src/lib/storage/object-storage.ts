import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * 通用 S3 兼容对象存储实现（替代 coze-coding-dev-sdk 的 S3Storage）。
 *
 * 适用于：MinIO、Cloudflare R2、腾讯云 COS、阿里云 OSS、AWS S3
 * 以及其它实现了 S3 协议的服务。
 */
export interface StorageConfig {
  /** 例如 https://cos.ap-guangzhou.myqcloud.com 或 http://127.0.0.1:9000 */
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** 公开访问域名；填写后预签名链接直接走该域名，不再签名 */
  publicBaseUrl?: string | null;
  /** 是否使用 path-style（bucket 放路径里）。自建/内网服务通常开启，公有云可关闭 */
  forcePathStyle?: boolean | null;
}

export function isStorageConfigured(config: StorageConfig | null | undefined): boolean {
  return !!config && !!config.endpoint?.trim() && !!config.bucket?.trim();
}

function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint.trim(),
    region: config.region?.trim() || 'us-east-1',
    credentials: {
      accessKeyId: (config.accessKey ?? '').trim(),
      secretAccessKey: (config.secretKey ?? '').trim(),
    },
    forcePathStyle: config.forcePathStyle !== false,
  });
}

export interface UploadFileParams {
  fileContent: Buffer | Uint8Array;
  fileName: string;
  contentType?: string;
}

/** 上传文件，返回对象 key */
export async function uploadFile(params: UploadFileParams, config: StorageConfig): Promise<string> {
  if (!isStorageConfigured(config)) {
    throw new Error('未配置对象存储，无法上传文件');
  }

  const client = createS3Client(config);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket.trim(),
        Key: params.fileName,
        Body: params.fileContent,
        ContentType: params.contentType || 'application/octet-stream',
      })
    );
    return params.fileName;
  } finally {
    client.destroy();
  }
}

export interface PresignParams {
  key: string;
  expireTime?: number;
}

/** 生成可访问链接（公开桶走 publicBaseUrl，私有桶走预签名） */
export async function generatePresignedUrl(
  params: PresignParams,
  config: StorageConfig
): Promise<string> {
  if (!isStorageConfigured(config)) {
    throw new Error('未配置对象存储，无法生成访问链接');
  }

  const publicBase = config.publicBaseUrl?.trim().replace(/\/+$/, '');
  const key = params.key.replace(/^\/+/, '');
  if (publicBase) {
    return `${publicBase}/${key}`;
  }

  const client = createS3Client(config);
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: config.bucket.trim(), Key: key }),
      { expiresIn: params.expireTime && params.expireTime > 0 ? params.expireTime : 3600 }
    );
  } finally {
    client.destroy();
  }
}

/** 连通性自检：写入一个探针文件并生成可访问链接 */
export async function testStorageConnection(config: StorageConfig): Promise<{ ok: true; url: string }> {
  if (!isStorageConfigured(config)) {
    throw new Error('未配置对象存储');
  }
  const key = `healthcheck/${Date.now()}.txt`;
  await uploadFile(
    { fileContent: Buffer.from('classroom-agent-ok'), fileName: key, contentType: 'text/plain' },
    config
  );
  const url = await generatePresignedUrl({ key, expireTime: 300 }, config);
  return { ok: true, url };
}
