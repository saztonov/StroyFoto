import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

const supabasePlugin: FastifyPluginAsync = async (fastify) => {
  const supabase = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
  );

  fastify.decorate("supabase", supabase);
};

export default fp(supabasePlugin, { name: "supabase" });
