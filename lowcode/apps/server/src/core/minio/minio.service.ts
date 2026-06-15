import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Readable } from 'stream';
import * as Minio from 'minio';

export interface MinioUploadResult {
  etag: string;
  versionId: string | null;
}

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client | null = null;
  private _bucket: string = '';
  private _initialized = false;

  constructor() {
    this._bucket = process.env['MINIO_BUCKET'] ?? 'lowcode-dev';
  }

  get bucket(): string {
    return this._bucket;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async onModuleInit(): Promise<void> {
    const endpoint = process.env['MINIO_ENDPOINT'];
    const accessKey = process.env['MINIO_ACCESS_KEY'];
    const secretKey = process.env['MINIO_SECRET_KEY'];
    const useSSL = process.env['MINIO_USE_SSL'] === 'true';
    const portStr = process.env['MINIO_PORT'];

    if (!endpoint || !accessKey || !secretKey) {
      this.logger.warn(
        'MinIO configuration incomplete (MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY). ' +
        'File upload/download functionality will not be available.',
      );
      return;
    }

    const port = portStr ? parseInt(portStr, 10) : (useSSL ? 443 : 9000);
    await this.buildClient({ endpoint, port, accessKey, secretKey, bucket: this._bucket, useSSL });
  }

  /**
   * Re-initialize the MinIO client with new configuration.
   * Called by SystemService when minio config is saved via the admin UI.
   */
  async reinitialize(config: {
    endpoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    bucket: string;
    useSSL: boolean;
  }): Promise<void> {
    this._bucket = config.bucket;
    await this.buildClient(config);
  }

  private async buildClient(config: {
    endpoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    bucket: string;
    useSSL: boolean;
  }): Promise<void> {
    const { endpoint, port, accessKey, secretKey, bucket, useSSL } = config;
    try {
      this._initialized = false;
      this.client = new Minio.Client({
        endPoint: endpoint,
        port,
        useSSL,
        accessKey,
        secretKey,
      });

      const exists = await this.client.bucketExists(bucket);
      if (!exists) {
        await this.client.makeBucket(bucket, 'us-east-1');
        this.logger.log(`Bucket '${bucket}' created successfully`);
      } else {
        this.logger.log(`Bucket '${bucket}' already exists`);
      }

      this._initialized = true;
      this.logger.log(`Minio client ready at ${endpoint}:${port} (SSL: ${useSSL})`);
    } catch (error: any) {
      this.logger.warn(
        `Failed to initialize MinIO at ${endpoint}: ${error.message}. ` +
        `File upload/download functionality will not be available.`,
      );
      this.client = null;
    }
  }

  private ensureInitialized(): Minio.Client {
    if (!this.client || !this._initialized) {
      throw new ServiceUnavailableException({
        code: 5000,
        message: 'File storage service is not available. Check MinIO configuration.',
      });
    }
    return this.client;
  }

  /**
   * Upload a file to MinIO.
   */
  async uploadFile(
    objKey: string,
    stream: Readable | Buffer,
    size: number,
    contentType: string = 'application/octet-stream',
  ): Promise<MinioUploadResult> {
    const client = this.ensureInitialized();
    try {
      const metaData = { 'Content-Type': contentType };
      const result = await client.putObject(
        this._bucket,
        objKey,
        stream,
        size,
        metaData,
      );
      return { etag: result.etag, versionId: result.versionId ?? null };
    } catch (error: any) {
      this.logger.error(`Failed to upload file to MinIO key=${objKey}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 5000,
        message: `Failed to upload file to storage: ${error.message}`,
      });
    }
  }

  /**
   * Get a file stream from MinIO.
   */
  async getFileStream(objKey: string): Promise<{
    stream: Readable;
    contentType: string;
    size: number;
  }> {
    const client = this.ensureInitialized();
    try {
      const stat = await client.statObject(this._bucket, objKey);
      const stream = await client.getObject(this._bucket, objKey);
      return {
        stream,
        contentType: stat.metaData?.['content-type'] ?? 'application/octet-stream',
        size: stat.size,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get file stream from MinIO key=${objKey}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 5000,
        message: `Failed to retrieve file from storage: ${error.message}`,
      });
    }
  }

  /**
   * Delete a file from MinIO.
   */
  async deleteFile(objKey: string): Promise<void> {
    const client = this.ensureInitialized();
    try {
      await client.removeObject(this._bucket, objKey);
      this.logger.debug(`Deleted file from MinIO: ${objKey}`);
    } catch (error: any) {
      this.logger.error(`Failed to delete file from MinIO key=${objKey}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 5000,
        message: `Failed to delete file from storage: ${error.message}`,
      });
    }
  }

  /**
   * Generate a presigned GET URL for an object.
   */
  async getPresignedUrl(objKey: string, expires: number = 7 * 24 * 60 * 60): Promise<string> {
    const client = this.ensureInitialized();
    try {
      const url = await client.presignedGetObject(this._bucket, objKey, expires);
      return url;
    } catch (error: any) {
      this.logger.error(`Failed to generate presigned URL for key=${objKey}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 5000,
        message: `Failed to generate download URL: ${error.message}`,
      });
    }
  }
}
