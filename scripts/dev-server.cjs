// Adapt common preview flags to Eleventy without replacing its watch server.
const { parseArgs } = require('node:util');

async function main() {
  const { values } = parseArgs({ options: {
    port: { type: 'string', default: '9000' },
    host: { type: 'string', default: '0.0.0.0' },
    strictPort: { type: 'boolean', default: false },
  } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port');
  // The installed Eleventy server binds all interfaces; do not silently pretend
  // to restrict it to another address when a caller asks for one.
  if (values.host !== '0.0.0.0') throw new Error('Eleventy preview supports --host 0.0.0.0 only');
  const { default: Eleventy } = await import('@11ty/eleventy');
  const server = new Eleventy(undefined, undefined, {
    source: 'cli',
    runMode: 'serve',
    config: config => config.setServerOptions({ portReassignmentRetryCount: values.strictPort ? 0 : 10 }),
  });
  await server.init();
  await server.watch();
  await server.serve(port);
  process.once('SIGINT', async () => { await server.stopWatch(); });
  process.once('SIGTERM', async () => { await server.stopWatch(); });
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
