import { FastifyRequest, FastifyReply } from 'fastify';

let authToken: string;

export function setAuthToken(token: string): void {
  authToken = token;
}

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers['authorization'];
  const query = (request.query as Record<string, string>)['token'];

  const token = header?.replace(/^Bearer\s+/i, '') || query;

  if (!authToken) return; // no token configured = dev mode

  if (token !== authToken) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing auth token' });
  }
}
