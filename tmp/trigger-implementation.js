const http = require('http');

const uuid = '8db29115-e0b5-487a-82dd-8f99d957fb1e';
const data = JSON.stringify({});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: `/api/tasks/${uuid}/implementation/run`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  },
};

const req = http.request(options, (res) => {
  let responseBody = '';
  res.on('data', (chunk) => {
    responseBody += chunk;
  });
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log('Response:', responseBody);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
