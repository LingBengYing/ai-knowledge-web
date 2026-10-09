import { startDevServer } from './dev-server.mjs';

const server = await startDevServer({
  port: Number(process.env.WIKI_WORKSPACE_PORT ?? 18090),
  backendOrigin: process.env.RAG_WEB_BACKEND_ORIGIN ?? 'http://127.0.0.1:18091',
  wikiEntry: true,
});
console.log(`Wiki workspace: http://127.0.0.1:${server.address().port}/`);
console.log('Real Java API required. The isolated integration launcher uses synthetic local providers, not cloud models.');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  server.close(() => { process.exitCode = 0; });
  server.closeAllConnections();
});
