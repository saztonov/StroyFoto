import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { config } from "../config.js";

const authPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.JWT_ACCESS_EXPIRES_IN,
    },
  });

  fastify.decorate("authenticate", async (request: FastifyRequest) => {
    await request.jwtVerify();
  });
};

export default fp(authPlugin, { name: "auth" });
