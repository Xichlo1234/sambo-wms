import request from 'supertest';
import { createApp } from '../src/app';

export const app = createApp();

export async function login(username: string, password = 'Demo@2026') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'wms').send({ username, password });
  if (res.status !== 200) throw new Error(`Login ${username} failed: ${JSON.stringify(res.body)}`);
  const wrap = (m: 'get' | 'post' | 'put' | 'patch' | 'delete') => (url: string) => agent[m](url).set('X-Requested-With', 'wms');
  return { agent, get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), del: wrap('delete') };
}
export type Client = Awaited<ReturnType<typeof login>>;

export const today = () => new Date().toISOString().slice(0, 10);
