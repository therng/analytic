const { createClient } = require('redis');
async function test() {
  const client = createClient({ url: 'redis://:9717@localhost:6379' });
  await client.connect();
  try {
    await client.xGroupCreate('teststream', 'worker-v2', '0', { MKSTREAM: true });
    console.log("Success");
  } catch (e) {
    console.error("Error:", e.message);
  }
  await client.disconnect();
}
test();
