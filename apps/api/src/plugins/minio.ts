import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import * as Minio from "minio";
import { config } from "../config.js";

const minioPlugin: FastifyPluginAsync = async (fastify) => {
  const minioClient = new Minio.Client({
    endPoint: config.MINIO_ENDPOINT,
    port: config.MINIO_PORT,
    useSSL: config.MINIO_USE_SSL,
    accessKey: config.MINIO_ROOT_USER,
    secretKey: config.MINIO_ROOT_PASSWORD,
  });

  fastify.decorate("minio", minioClient);

  fastify.addHook("onReady", async () => {
    const bucketExists = await minioClient.bucketExists(config.MINIO_BUCKET);
    if (!bucketExists) {
      await minioClient.makeBucket(config.MINIO_BUCKET);
      fastify.log.info(`Created MinIO bucket: ${config.MINIO_BUCKET}`);
    }
  });
};

export default fp(minioPlugin, { name: "minio" });
