import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import multer from 'multer';

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (Object.prototype.hasOwnProperty.call(extensions, file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens são permitidas (JPEG, PNG, WebP, GIF)'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

export class UploadService {
  static async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    const { AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, NEON_STORAGE_BUCKET } = process.env;
    if (!AWS_ENDPOINT_URL_S3 || !AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !NEON_STORAGE_BUCKET) {
      throw new Error('Configuração do armazenamento de imagens incompleta');
    }

    const endpoint = new URL(AWS_ENDPOINT_URL_S3);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Endpoint do armazenamento de imagens inválido');
    }

    const client = new S3Client({
      endpoint: endpoint.toString(),
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    const keys: string[] = [];

    try {
      for (const file of files) {
        const key = `products/${randomUUID()}.${extensions[file.mimetype]}`;
        keys.push(key);
        await client.send(new PutObjectCommand({
          Bucket: NEON_STORAGE_BUCKET,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'public, max-age=31536000, immutable',
        }));
      }

      const base = endpoint.toString().replace(/\/+$/, '');
      return keys.map((key) => `${base}/${encodeURIComponent(NEON_STORAGE_BUCKET)}/${key}`);
    } catch (error) {
      const cleanup = await Promise.allSettled(keys.map((key) =>
        client.send(new DeleteObjectCommand({ Bucket: NEON_STORAGE_BUCKET, Key: key }))
      ));
      for (const result of cleanup) {
        if (result.status === 'rejected') console.error('Erro ao limpar imagem após falha no upload:', result.reason);
      }
      throw error;
    } finally {
      client.destroy();
    }
  }
}
