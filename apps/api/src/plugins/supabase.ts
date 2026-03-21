import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

const supabasePlugin: FastifyPluginAsync = async (fastify) => {
  const supabase = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Ensure storage bucket exists
  const bucketName = config.SUPABASE_STORAGE_BUCKET;
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === bucketName)) {
    await supabase.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    fastify.log.info(`Created storage bucket: ${bucketName}`);
  }

  fastify.decorate("supabase", supabase);
};

export default fp(supabasePlugin, { name: "supabase" });
