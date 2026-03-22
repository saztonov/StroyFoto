import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

export interface R2Service {
  upload(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  download(objectKey: string): Promise<{ body: ReadableStream | NodeJS.ReadableStream; contentType: string; contentLength?: number } | null>;
  getPresignedGetUrl(objectKey: string, expiresIn: number): Promise<string>;
  getPresignedPutUrl(objectKey: string, contentType: string, expiresIn: number): Promise<string>;
  deleteObjects(objectKeys: string[]): Promise<void>;
  headObject(objectKey: string): Promise<{ contentLength?: number } | null>;
}

const r2Plugin: FastifyPluginAsync = async (fastify) => {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
  });

  const bucket = config.R2_BUCKET_NAME;

  const r2: R2Service = {
    async upload(objectKey, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async download(objectKey) {
      try {
        const result = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
        );
        if (!result.Body) return null;
        return {
          body: result.Body as unknown as ReadableStream | NodeJS.ReadableStream,
          contentType: result.ContentType ?? "application/octet-stream",
          contentLength: result.ContentLength,
        };
      } catch (err: unknown) {
        if (err instanceof Error && "name" in err && err.name === "NoSuchKey") {
          return null;
        }
        throw err;
      }
    },

    async getPresignedGetUrl(objectKey, expiresIn) {
      return getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
        { expiresIn },
      );
    },

    async getPresignedPutUrl(objectKey, contentType, expiresIn) {
      return getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: contentType }),
        { expiresIn },
      );
    },

    async deleteObjects(objectKeys) {
      if (objectKeys.length === 0) return;
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: objectKeys.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    },

    async headObject(objectKey) {
      try {
        const result = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
        );
        return { contentLength: result.ContentLength };
      } catch (err: unknown) {
        if (err instanceof Error && "name" in err && err.name === "NotFound") {
          return null;
        }
        throw err;
      }
    },
  };

  fastify.decorate("r2", r2);
};

export default fp(r2Plugin, { name: "r2" });
